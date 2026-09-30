import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, opendir, readlink, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { RECLAIM_WORKTREE_NEEDS_CONFIRMATION, type AgentWorkingCopyOptions, type AgentWorkingCopySelection, type AgentWorktree } from '../../shared/agents'
import { nativeEnvironment } from './subscriptionCodex'

export type RunGit = (cwd: string, args: string[]) => Promise<string>
export const runWorktreeGit: RunGit = (cwd, args) => runWorktreeGitProcess(cwd, args)

/** The executable and deadline seam lets a real launcher/checkout tree exercise timeout recovery. */
export function runWorktreeGitProcess(cwd: string, args: string[], options: { executable?: string; prefix?: string[]; timeout?: number } = {}): Promise<string> {
  return new Promise((accept, reject) => {
    const child = spawn(options.executable ?? 'git', [...(options.prefix ?? ['-c', 'core.quotePath=false']), ...args], {
      cwd, windowsHide: true, shell: false, detached: process.platform !== 'win32',
      env: { ...nativeEnvironment(), LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' },
    })
    let timedOut = false
    let processError: Error | undefined
    let stopping: Promise<void> = Promise.resolve()
    const output: Buffer[] = [], errors: Buffer[] = []
    let bytes = 0
    const stop = (): void => {
      if (!child.pid) return
      stopping = process.platform === 'win32'
        ? new Promise<void>((done, fail) => { execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, error => error ? fail(error) : done()) })
        : new Promise<void>((done, fail) => { try { process.kill(-child.pid!, 'SIGKILL'); done() } catch (error) { fail(error) } })
      void stopping.catch(() => undefined)
    }
    const collect = (target: Buffer[], chunk: Buffer): void => {
      bytes += chunk.length
      if (bytes <= 2_000_000) target.push(chunk)
      else if (!processError) { processError = new Error('Git returned too much output. Nothing was removed.'); clearTimeout(timer); stop() }
    }
    child.stdout.on('data', (chunk: Buffer) => collect(output, chunk))
    child.stderr.on('data', (chunk: Buffer) => collect(errors, chunk))
    child.on('error', error => { processError = error })
    const timer = setTimeout(() => { timedOut = true; stop() }, options.timeout ?? (args[0] === 'worktree' && args[1] === 'add' ? 300_000 : 30_000))
    // close follows exit and closed pipes; the tree termination command must finish before cleanup can start.
    child.on('close', code => {
      clearTimeout(timer)
      void stopping.then(() => {
        if (timedOut || processError || code !== 0) {
          const unavailable = (processError as NodeJS.ErrnoException | undefined)?.code === 'ENOENT'
          reject(Object.assign(new Error(unavailable ? 'Git is unavailable. Install Git or explicitly choose a shared working copy.' : timedOut ? 'Git took too long.' : Buffer.concat(errors).toString('utf8').trim() || processError?.message || 'Git could not finish this action.'), { code: (processError as NodeJS.ErrnoException | undefined)?.code ?? code, timedOut }))
        } else accept(Buffer.concat(output).toString('utf8'))
      }, () => reject(new Error('Git took too long and its checkout processes could not be stopped. The folder was kept.')))
    })
  })
}

export async function existingWorkingDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('The working folder must be an absolute path.')
  // A project whose folder was moved or deleted says so in plain words rather than as the file system's error code.
  const canonical = await realpath(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') throw new Error(`The folder ${path} is not there any more. Move it back, or add the project again from where it is now.`)
    throw error
  })
  if (!(await stat(canonical)).isDirectory()) throw new Error('The working folder is not a directory.')
  return canonical
}
function pathKey(path: string): string { const key = resolve(path); return process.platform === 'win32' ? key.toLowerCase() : key }

// A host has separate thread and terminal services. They still share Git's registry,
// including when their projects start in different linked checkouts of one repository.
const registryOperations = new Map<string, Promise<void>>()
interface RegistryIdentity { readonly common: string; readonly key: string }
interface InspectionReads { readonly root: string; readonly common?: string; readonly listing?: string }
async function coordinateRegistry(identity: RegistryIdentity, run: () => Promise<string>): Promise<string> {
  const previous = registryOperations.get(identity.key) ?? Promise.resolve()
  const operation = previous.then(run)
  // A rejected command keeps its original error but cannot poison the next operation.
  const settled = operation.then(() => undefined, () => undefined)
  registryOperations.set(identity.key, settled)
  try { return await operation }
  finally { if (registryOperations.get(identity.key) === settled) registryOperations.delete(identity.key) }
}

function registeredWorktrees(output: string): Array<{ path: string; branch: string | undefined; locked: boolean; lockReason: string | undefined; prunable: boolean }> {
  return output.split('\0\0').filter(Boolean).map(record => {
    const fields = record.split('\0')
    return { path: fields.find(field => field.startsWith('worktree '))?.slice(9) ?? '', branch: fields.find(field => field.startsWith('branch '))?.slice(7),
      locked: fields.some(field => field === 'locked' || field.startsWith('locked ')), lockReason: fields.find(field => field.startsWith('locked '))?.slice(7), prunable: fields.some(field => field === 'prunable' || field.startsWith('prunable ')) }
  })
}

/** Where a set of worktrees lives under Sotto's data folder, and how their branches are named. */
export interface WorktreeHome {
  readonly folder: string
  readonly branchPrefix: string
}
const THREAD_WORKTREE_HOME: WorktreeHome = { folder: 'thread-worktrees', branchPrefix: 'sotto/' }
export const TERMINAL_WORKTREE_HOME: WorktreeHome = { folder: 'terminal-worktrees', branchPrefix: 'sotto/terminal-' }

/** What reclaiming a worktree would touch, so the caller can name it before asking. */
export interface WorktreeReclaimFacts {
  readonly path: string
  readonly branch: string | undefined
  readonly dirty: boolean
  /** Ignored paths other than installed dependencies: build output, captures, anything a rule may not discard unasked. */
  readonly ignored: readonly string[]
  readonly repositories: readonly { path: string; changes: string[] }[]
  /** A link inside the folder that leads out of it. Removing the folder could follow it, so nothing is removed while one is there. */
  readonly outsideLink: string | undefined
}
export interface WorktreeReclaimOptions {
  /** The exact ignored paths displayed in the user's confirmation. */
  readonly confirmedIgnored?: readonly string[]
  /** The user's answer to the uncommitted-changes confirmation. */
  readonly withUncommittedChanges?: boolean
  /** A rule acting on its own: a folder with anything but dependencies in its ignored files is left alone. */
  readonly automatic?: boolean
}
const DEPENDENCY_FOLDER = /(^|\/)node_modules\/$/u

/**
 * Creates and inspects checkouts, and reclaims a folder only when asked (ADR-0019): the branch and
 * the thread are never removed, and `restore` puts the folder back. Allocation is persisted by
 * WorkspaceHost before ensure.
 */
export class ThreadWorktrees {
  constructor(private readonly directory: string, private readonly git: RunGit = runWorktreeGit, private readonly home: WorktreeHome = THREAD_WORKTREE_HOME) {}

  /** Identity belongs to this operation, never to a cached cwd or persisted worktree record. */
  private async registryIdentity(cwd: string, verifyRef?: string): Promise<RegistryIdentity> {
    const output = await this.git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir', ...(verifyRef ? ['--verify', verifyRef] : [])])
    // Restore already verifies its saved ref. Git can return common-dir in that same
    // invocation; only the final fixed-format object ID is removed from its output.
    const common = (verifyRef ? output.replace(/\r?\n[a-f0-9]{40}(?:[a-f0-9]{24})?\r?\n?$/u, '') : output).trim()
    return { common, key: pathKey(await realpath(common)) }
  }

  private async registry(cwd: string, args: string[], identity?: RegistryIdentity): Promise<string> {
    return coordinateRegistry(identity ?? await this.registryIdentity(cwd), () => this.git(cwd, args))
  }

  /** Only the fresh token path this add started may be cleaned up after its own deadline. */
  private async addWorktree(repositoryRoot: string, path: string, branch: string, args: string[], identity: RegistryIdentity): Promise<void> {
    await coordinateRegistry(identity, async () => {
      try { return await this.git(repositoryRoot, args) }
      catch (error) {
        if (!(error instanceof Error) || !('timedOut' in error) || error.timedOut !== true) throw error
        try {
          const entries = registeredWorktrees(await this.git(repositoryRoot, ['worktree', 'list', '--porcelain', '-z']))
          const entry = entries.find(item => pathKey(item.path) === pathKey(path))
          if (entry && (entry.lockReason !== 'initializing' || (entry.branch && entry.branch !== `refs/heads/${branch}`))) throw new Error('The incomplete checkout is no longer initializing on its reserved branch.', { cause: error })
          if (entry) {
            const present = await lstat(path).then(() => true, (failure: NodeJS.ErrnoException) => { if (failure.code === 'ENOENT') return false; throw failure })
            if (present) {
              if (pathKey(await realpath(path)) !== pathKey(path) || !(await lstat(join(path, '.git'))).isFile()) throw new Error('The incomplete folder was replaced.', { cause: error })
              const common = (await this.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
              if (pathKey(common) !== pathKey(identity.common) || await this.outsideLink(path)) throw new Error('The incomplete folder was redirected.', { cause: error })
              await this.verifyIncompleteCheckout(path, branch)
            }
            await this.git(repositoryRoot, ['worktree', 'unlock', '--', path])
            await this.git(repositoryRoot, ['worktree', 'remove', '--force', '--', path])
          } else if (await lstat(path).then(() => true, (failure: NodeJS.ErrnoException) => { if (failure.code === 'ENOENT') return false; throw failure })) {
            throw new Error('The incomplete folder is not registered to this checkout.', { cause: error })
          }
        } catch (cleanupError) {
          throw new Error('Worktree setup took too long. The incomplete folder was kept because it could not be safely removed. Move any local files out and restore the checkout before retrying.', { cause: cleanupError })
        }
        throw new Error('Worktree setup took too long. Retry setup to continue on the same branch.', { cause: error })
      }
    })
  }

  /** A killed reset may not have written the index. Compare present files with the branch itself. */
  private async verifyIncompleteCheckout(path: string, branch: string): Promise<void> {
    const files: string[] = []
    const links = new Map<string, Buffer>()
    const visit = async (directory: string): Promise<void> => {
      const handle = await opendir(directory)
      for await (const entry of handle) {
        if (directory === path && entry.name === '.git') continue
        const full = join(directory, entry.name)
        if (entry.isDirectory()) await visit(full)
        else {
          const local = relative(path, full).split(sep).join('/')
          if (entry.isSymbolicLink()) links.set(local, await readlink(full, { encoding: 'buffer' }))
          else if (!entry.isFile()) throw new Error('The incomplete folder contains local files.')
          files.push(local)
        }
      }
    }
    await visit(path)
    // Bound each argument list on Windows. Hashing applies the checkout's normal clean filters.
    for (let offset = 0; offset < files.length; offset += 32) {
      const batch = files.slice(offset, offset + 32)
      // Read only these files, not the whole potentially huge branch tree. Paths are always literal.
      const tree = await this.git(path, ['--literal-pathspecs', 'ls-tree', '-r', '-z', '--full-tree', `refs/heads/${branch}`, '--', ...batch])
      const blobs = new Map(tree.split('\0').filter(Boolean).map(record => {
        const tab = record.indexOf('\t')
        const [mode, , hash] = record.slice(0, tab).split(' ')
        return [record.slice(tab + 1), { mode, hash: hash! }]
      }))
      if (batch.some(file => !blobs.has(file))) throw new Error('The incomplete folder contains local files.')
      for (const file of batch) {
        const target = links.get(file), blob = blobs.get(file)!
        if (target) {
          const hash = createHash(blob.hash.length === 64 ? 'sha256' : 'sha1').update(`blob ${target.length}\0`).update(target).digest('hex')
          if (blob.mode !== '120000' || hash !== blob.hash) throw new Error('The incomplete folder contains local changes.')
        } else if (blob.mode !== '100644' && blob.mode !== '100755' && blob.mode !== '120000') throw new Error('The incomplete folder contains local changes.')
      }
      const regular = batch.filter(file => !links.has(file))
      if (!regular.length) continue
      const hashes = (await this.git(path, ['hash-object', '--', ...regular])).trim().split(/\r?\n/u)
      if (hashes.length !== regular.length || regular.some((file, index) => hashes[index] !== blobs.get(file)!.hash)) throw new Error('The incomplete folder contains local changes.')
    }
  }

  /**
   * Start from origin, T3's way (ADR-0014, amended September 24, 2026): fetch the base when origin has it, fall back
   * to the local branch when origin does not, and skip the fetch for a project with no origin at all. Only a fetch
   * that fails for another reason, the connection or the credentials, stops setup. The answer is kept on the
   * worktree so the pane can say which happened.
   */
  private async resolveOriginBase(repositoryRoot: string, baseBranch: string): Promise<NonNullable<AgentWorktree['originBase']>> {
    // No origin is an answer; Git being unavailable is not, and the message runWorktreeGit gives it must reach the user.
    try { await this.git(repositoryRoot, ['remote', 'get-url', 'origin']) }
    catch (error) { if (error instanceof Error && /Git is unavailable/u.test(error.message)) throw error; return 'no-origin' }
    const failure = new Error(`The origin branch ${baseBranch} could not be fetched. Check the remote and connection, or choose a local branch under Start from.`)
    // --exit-code answers 2 for a remote that is reachable and has no such branch; anything else is a real failure.
    try { await this.git(repositoryRoot, ['ls-remote', '--exit-code', '--heads', 'origin', `refs/heads/${baseBranch}`]) }
    catch (error) { if ((error as { code?: unknown }).code === 2) return 'not-on-origin'; throw failure }
    try { await this.git(repositoryRoot, ['fetch', '--no-tags', 'origin', `refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`]) }
    catch { throw failure }
    return 'fetched'
  }

  /**
   * `checkoutBranch` names a branch that exists already, such as a pull request's head: the worktree checks it
   * out as it stands rather than cutting a new branch from a base.
   */
  async allocate(projectPath: string, mode: 'independent' | 'shared', selection: Partial<AgentWorkingCopySelection> & { readonly checkoutBranch?: string | undefined } = {}): Promise<AgentWorktree> {
    const cwd = await existingWorkingDirectory(projectPath)
    if (mode === 'shared') return { mode, status: 'ready', path: cwd }
    let repositoryRoot: string
    try { repositoryRoot = (await this.git(cwd, ['rev-parse', '--show-toplevel'])).trim() }
    catch (error) {
      if (error instanceof Error && /not a git repository/u.test(error.message)) return { mode: 'shared', status: 'ready', path: cwd }
      throw error
    }
    if (selection.existingWorktreePath) {
      const path = await existingWorkingDirectory(selection.existingWorktreePath)
      const identity = await this.registryIdentity(repositoryRoot)
      const entries = registeredWorktrees(await this.registry(repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], identity))
      const entry = entries.find(item => pathKey(item.path) === pathKey(path))
      if (!entry || entry.locked || entry.prunable) throw new Error('That folder is not an available worktree of this project. Refresh the worktree list and choose again.')
      const projectRelativePath = relative(await realpath(repositoryRoot), cwd).split(sep).join('/')
      return (await this.inspectWithin({ mode, status: 'ready', path, repositoryRoot: await realpath(repositoryRoot), projectRelativePath, reused: true }, identity)).worktree
    }
    const checkoutBranch = selection.checkoutBranch
    if (checkoutBranch) {
      await this.git(repositoryRoot, ['check-ref-format', `refs/heads/${checkoutBranch}`])
      let branchCommit: string
      try { branchCommit = (await this.git(repositoryRoot, ['rev-parse', '--verify', `refs/heads/${checkoutBranch}^{commit}`])).trim() }
      catch { throw new Error(`The branch ${checkoutBranch} is gone. Check the pull request out again from the branch picker.`) }
      const relativePath = relative(await realpath(repositoryRoot), cwd).split(sep).join('/')
      const token = randomUUID()
      return { mode, status: 'pending', path: join(await realpath(this.directory), this.home.folder, token), repositoryRoot: await realpath(repositoryRoot), branch: checkoutBranch, baseCommit: branchCommit, projectRelativePath: relativePath, checkoutBranch: true, temporaryBranch: false }
    }
    const baseBranch = selection.baseBranch ?? (selection.startFromOrigin ? (await this.git(repositoryRoot, ['branch', '--show-current'])).trim() || undefined : undefined)
    if (baseBranch) await this.git(repositoryRoot, ['check-ref-format', `refs/heads/${baseBranch}`])
    if (selection.startFromOrigin && !baseBranch) throw new Error('Choose a base branch before starting from origin.')
    const originBase = selection.startFromOrigin && baseBranch ? await this.resolveOriginBase(repositoryRoot, baseBranch) : undefined
    const base = baseBranch ? `${originBase === 'fetched' ? 'refs/remotes/origin/' : 'refs/heads/'}${baseBranch}` : 'HEAD'
    let baseCommit: string
    try { baseCommit = (await this.git(repositoryRoot, ['rev-parse', '--verify', `${base}^{commit}`])).trim() }
    catch { throw new Error(baseBranch ? `The base branch ${baseBranch} is unavailable. Choose an existing branch and retry.` : 'This Git repository has no commit to branch from. Make its first commit, or create the thread with Project folder.') }
    const projectRelativePath = relative(await realpath(repositoryRoot), cwd).split(sep).join('/')
    if (projectRelativePath) {
      try {
        if ((await this.git(repositoryRoot, ['cat-file', '-t', `${baseCommit}:${projectRelativePath}`])).trim() !== 'tree') throw new Error('Not a committed directory')
      } catch { throw new Error('The project subdirectory is not present in the committed source. Commit that folder or explicitly choose a shared working copy, then retry.') }
    }
    const token = randomUUID()
    return { mode, status: 'pending', ...(originBase ? { originBase } : {}), path: join(await realpath(this.directory), this.home.folder, token), repositoryRoot: await realpath(repositoryRoot), branch: `${this.home.branchPrefix}${this.home === THREAD_WORKTREE_HOME ? token.slice(0, 8) : token}`, baseCommit, projectRelativePath, baseBranch, startFromOrigin: selection.startFromOrigin, temporaryBranch: this.home === THREAD_WORKTREE_HOME }
  }


  async options(projectPath: string): Promise<AgentWorkingCopyOptions> {
    const cwd = await existingWorkingDirectory(projectPath)
    let identity: RegistryIdentity
    try { identity = await this.registryIdentity(cwd) }
    catch (error) {
      if (error instanceof Error && /not a git repository|Git is unavailable/u.test(error.message)) return { isGit: false, currentBranch: null, branches: [], worktrees: [] }
      throw error
    }
    const [branch, branches, entries] = await Promise.all([
      this.git(cwd, ['branch', '--show-current']), this.git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
      this.registry(cwd, ['worktree', 'list', '--porcelain', '-z'], identity),
    ])
    return { isGit: true, currentBranch: branch.trim() || null, branches: branches.split(/\r?\n/u).filter(Boolean),
      worktrees: registeredWorktrees(entries).filter(entry => !entry.locked && !entry.prunable).map(entry => ({ path: entry.path, branch: entry.branch?.replace(/^refs\/heads\//u, '') ?? null })) }
  }

  /** Canonical checkout root, so a subdirectory and its root count as the same working copy. */
  async checkoutIdentity(directory: string): Promise<string> {
    const path = await existingWorkingDirectory(directory)
    try { return pathKey(await existingWorkingDirectory((await this.git(path, ['rev-parse', '--show-toplevel'])).trim())) }
    catch (error) {
      if (error instanceof Error && /not a git repository/u.test(error.message)) return pathKey(path)
      throw error
    }
  }

  /** Discover an established session's folder without moving it or creating anything. */
  async discover(directory: string, projectPath: string): Promise<AgentWorktree> {
    const path = await existingWorkingDirectory(directory)
    let root: string
    try { root = await existingWorkingDirectory((await this.git(path, ['rev-parse', '--show-toplevel'])).trim()) }
    catch (error) {
      if (error instanceof Error && /not a git repository|Git is unavailable/u.test(error.message)) return { mode: 'shared', status: 'ready', path }
      throw error
    }
    let projectRoot: string | undefined
    try { projectRoot = await this.checkoutIdentity(projectPath) } catch { /* The established folder still defines its session. */ }
    // Equal checkout roots already establish the shared-folder result; no registry scan is needed.
    if (pathKey(root) === projectRoot) return (await this.inspectWithin({ mode: 'shared', status: 'ready', path }, undefined, { root })).worktree
    const identity = await this.registryIdentity(root)
    const listing = await this.registry(root, ['worktree', 'list', '--porcelain', '-z'], identity)
    const entries = registeredWorktrees(listing)
    const registered = entries.find(entry => pathKey(entry.path) === pathKey(root))
    if (pathKey(root) !== projectRoot && registered && pathKey(entries[0]?.path ?? root) !== pathKey(root)) {
      // Carry this discovery's reads, not a cached binding. Inspection still obtains
      // the main checkout's common directory independently before allowing status.
      return (await this.inspectWithin({ mode: 'independent', status: 'ready', path: root, repositoryRoot: await existingWorkingDirectory(entries[0]!.path),
        projectRelativePath: relative(root, path).split(sep).join('/'), reused: true }, undefined, { root, common: identity.common, listing })).worktree
    }
    return (await this.inspectWithin({ mode: 'shared', status: 'ready', path }, undefined, { root })).worktree
  }

  async renameTemporaryBranch(metadata: AgentWorktree, name: string): Promise<AgentWorktree> {
    if (!metadata.temporaryBranch || metadata.reused || !metadata.branch) return metadata
    const { worktree: inspected, identity } = await this.inspectWithin(metadata)
    if (inspected.branch !== metadata.branch) return { ...inspected, temporaryBranch: false }
    const slug = name.replace(/^sotto\//u, '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 60).replace(/-$/u, '')
    if (!slug) return inspected
    const branch = `sotto/${slug}`
    await this.registry(inspected.path!, ['branch', '-m', metadata.branch, branch], identity)
    return { ...inspected, branch, temporaryBranch: false }
  }

  async workingDirectory(metadata: AgentWorktree): Promise<string> {
    if (!metadata.path) throw new Error('The working folder is not allocated.')
    const root = await existingWorkingDirectory(metadata.path)
    const requested = resolve(root, metadata.projectRelativePath ?? '.')
    const local = relative(root, requested)
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error('The project subdirectory is outside its allocated worktree.')
    const directory = await existingWorkingDirectory(requested)
    const actual = relative(root, directory)
    if (isAbsolute(actual) || actual === '..' || actual.startsWith(`..${sep}`)) throw new Error('The project subdirectory was redirected outside its allocated worktree.')
    return directory
  }

  async ensure(metadata: AgentWorktree): Promise<AgentWorktree> {
    if (!metadata.path) throw new Error('The working-copy allocation is missing.')
    if (metadata.mode === 'shared' || metadata.reused) return this.inspect(metadata)
    const { repositoryRoot, branch, baseCommit } = metadata
    if (!repositoryRoot || !baseCommit) throw new Error('The independent working-copy allocation is incomplete.')
    const allocationRoot = join(await realpath(this.directory), this.home.folder)
    if (pathKey(dirname(metadata.path)) !== pathKey(allocationRoot) || !/^[a-f0-9-]{36}$/u.test(basename(metadata.path))) throw new Error('The working-copy allocation is outside Sotto’s reserved folder.')
    await existingWorkingDirectory(repositoryRoot)
    const identity = await this.registryIdentity(repositoryRoot)
    // A checkout Sotto already made and then lost is recreated from its recorded branch (ADR-0014).
    if (metadata.status !== 'pending') await this.restore(metadata)
    const entries = registeredWorktrees(await this.registry(repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], identity))
    const registered = entries.find(entry => pathKey(entry.path) === pathKey(metadata.path!))
    if (registered) {
      if (registered.locked || registered.prunable) throw new Error('Git has locked this worktree or reports an incomplete checkout. Wait for setup to finish or restore the checkout, then retry.')
      const path = await existingWorkingDirectory(metadata.path)
      // A replaced symlink/junction is not the allocated checkout.
      if (pathKey(path) !== pathKey(metadata.path)) throw new Error('The reserved working folder was redirected. Nothing was changed.')
      // An existing checkout is reused on whatever branch it has (ADR-0014); inspect records it.
      return (await this.inspectWithin({ ...metadata, status: 'ready', error: undefined }, identity)).worktree
    }
    if (!branch) throw new Error('The independent working-copy allocation is incomplete.')
    if (await lstat(metadata.path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error })) throw new Error('The reserved working folder already exists but is not this thread’s Git worktree. Nothing was changed.')
    if (entries.some(entry => entry.branch === `refs/heads/${branch}`)) throw new Error('The reserved branch is already checked out in another folder. Nothing was changed.')
    // -b refuses any existing branch; never reset it with -B or force another checkout. A pull request's branch
    // exists already and is checked out as it stands, with no -b.
    await mkdir(allocationRoot, { recursive: true })
    if (pathKey(await realpath(allocationRoot)) !== pathKey(allocationRoot)) throw new Error('The reserved worktree parent folder was redirected. Nothing was changed.')
    await this.addWorktree(repositoryRoot, metadata.path, branch, metadata.checkoutBranch ? ['worktree', 'add', '--', metadata.path, branch] : ['worktree', 'add', '-b', branch, '--', metadata.path, baseCommit], identity)
    return (await this.inspectWithin({ ...metadata, status: 'ready', error: undefined }, identity)).worktree
  }

  /**
   * Puts back a checkout Sotto made and then lost, on the branch it recorded (ADR-0014). Best effort: a
   * folder that is still there, a thread with no recorded branch and a branch that no longer exists are
   * all returned unchanged, so the caller reports the real problem. Never resets a branch, never removes
   * a checkout, and never takes a branch another folder has.
   */
  async restore(metadata: AgentWorktree): Promise<AgentWorktree> {
    const { path, repositoryRoot, branch } = metadata
    if (metadata.mode !== 'independent' || !path || !repositoryRoot || !branch) return metadata
    if (await lstat(path).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return false; throw error })) return metadata
    let allocationRoot: string
    // Sotto's own data folder and the repository have to be there before anything is put back.
    try { allocationRoot = join(await realpath(this.directory), this.home.folder); await existingWorkingDirectory(repositoryRoot) }
    catch { return metadata }
    if (pathKey(dirname(path)) !== pathKey(allocationRoot) || !/^[a-f0-9-]{36}$/u.test(basename(path))) return metadata
    let identity: RegistryIdentity
    try { identity = await this.registryIdentity(repositoryRoot, `refs/heads/${branch}`) }
    catch { return metadata }
    const refuseAnotherFolder = async () => {
      const entries = registeredWorktrees(await this.registry(repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], identity))
      const occupant = entries.find(entry => entry.branch === `refs/heads/${branch}` && pathKey(entry.path) !== pathKey(path))
      if (occupant) throw new Error(`The branch ${branch} is checked out in ${occupant.path}, so this thread’s folder cannot be put back on it. Nothing was lost or changed. Close that folder’s checkout or move it to another branch, then retry.`)
      return entries
    }
    const entries = await refuseAnotherFolder()
    // Remove only this missing folder's registration. Other missing checkouts may be on unplugged drives.
    if (entries.some(entry => pathKey(entry.path) === pathKey(path))) await this.registry(repositoryRoot, ['worktree', 'remove', '--', path], identity)
    await refuseAnotherFolder()
    await mkdir(allocationRoot, { recursive: true })
    if (pathKey(await realpath(allocationRoot)) !== pathKey(allocationRoot)) throw new Error('The reserved worktree parent folder was redirected. Nothing was changed.')
    // No -b and no -B: the recorded branch is checked out as it stands, with its commits.
    try { await this.addWorktree(repositoryRoot, path, branch, ['worktree', 'add', '--', path, branch], identity) }
    catch (error) { throw new Error(`This thread’s working folder was missing and Sotto could not put it back on ${branch}. Nothing was lost; the branch still has its commits. ${error instanceof Error ? error.message : ''}`.trim(), { cause: error }) }
    return { ...metadata, status: 'ready', error: undefined, reclaimedAt: undefined }
  }

  /**
   * What reclaiming this thread's worktree would discard, read from the folder: uncommitted changes,
   * ignored files other than installed dependencies, and any link that leads out of the folder.
   */
  async reclaimFacts(metadata: AgentWorktree): Promise<WorktreeReclaimFacts> {
    return (await this.reclaimFactsWithin(metadata)).facts
  }

  private async reclaimFactsWithin(metadata: AgentWorktree): Promise<{ facts: WorktreeReclaimFacts; identity?: RegistryIdentity }> {
    const { worktree: inspected, identity } = await this.inspectWithin(metadata)
    const path = inspected.path!
    const listing = await this.git(path, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])
    const ignored: string[] = []
    const repositories: Array<{ path: string; changes: string[] }> = []
    const visit = async (entry: string, ignoredEntry = true): Promise<void> => {
      if (DEPENDENCY_FOLDER.test(entry)) return
      const full = join(path, entry)
      const info = await lstat(full)
      if (!info.isDirectory() || info.isSymbolicLink()) { if (ignoredEntry) ignored.push(entry); return }
      const names: string[] = []
      const handle = await opendir(full)
      for await (const child of handle) names.push(child.name)
      if (entry && names.includes('.git')) {
        if (ignoredEntry) ignored.push(entry)
        if (!repositories.some(repository => repository.path === entry)) {
          const status = await this.git(full, ['status', '--porcelain', '--untracked-files=all', '-z'])
          repositories.push({ path: entry, changes: status.split('\0').filter(Boolean) })
        }
        return
      }
      if (!names.length && ignoredEntry) ignored.push(entry)
      for (const name of names) {
        if (!entry && name === '.git') continue
        const child = (entry ? entry.replace(/\/$/u, '') + '/' : '') + name
        if (name === 'node_modules' && (await lstat(join(path, child))).isDirectory()) continue
        await visit(child, ignoredEntry)
      }
    }
    for (const entry of listing.split('\0').filter(Boolean)) await visit(entry)
    // Git omits nested .git entries even when their parent is not ignored. They still block removal.
    await visit('', false)
    ignored.sort()
    return { ...(identity ? { identity } : {}), facts: { path, branch: inspected.branch, dirty: inspected.dirty === true, ignored, repositories, outsideLink: await this.outsideLink(path) } }
  }

  /**
   * Removes this thread's own worktree folder and nothing else (ADR-0019). The branch keeps its
   * commits, the thread keeps its record, and `restore` puts the folder back on the next send. It
   * refuses a folder that is not the registered checkout, one with no branch to come back on, one
   * holding a link out of itself, and, for a rule acting alone, one with anything but dependencies
   * among its ignored files. Uncommitted work goes only after the user's answer.
   */
  async reclaim(metadata: AgentWorktree, options: WorktreeReclaimOptions = {}): Promise<AgentWorktree> {
    if (metadata.mode !== 'independent' || metadata.reused) throw new Error('Only a worktree Sotto made for this thread can be removed. A shared or reused folder stays.')
    const allocationRoot = join(await realpath(this.directory), this.home.folder)
    if (!metadata.path || pathKey(dirname(metadata.path)) !== pathKey(allocationRoot) || !/^[a-f0-9-]{36}$/u.test(basename(metadata.path))) throw new Error('This folder is outside Sotto’s reserved worktree folder. Nothing was changed.')
    const { facts, identity } = await this.reclaimFactsWithin(metadata)
    if (!facts.branch) throw new Error('This folder has no branch checked out, so Sotto could not put it back. Switch it to a branch first. Nothing was changed.')
    if (facts.outsideLink) throw new Error(`This folder contains a link to another folder (${facts.outsideLink}). Remove the link first so nothing outside the folder is touched. Nothing was changed.`)
    if (options.automatic && facts.ignored.length) throw new Error('This folder holds ignored files besides installed dependencies, so a rule leaves it alone.')
    if (facts.repositories.length) throw new Error('This folder holds a nested repository or worktree. Move it out before removing the folder. Nothing was changed.')
    if (!options.automatic && ((facts.ignored.length && !options.confirmedIgnored) || (options.confirmedIgnored && JSON.stringify([...options.confirmedIgnored].sort()) !== JSON.stringify(facts.ignored)))) throw new Error('The ignored items changed. Nothing was removed. Close this question and choose Remove worktree again to review them.')
    // A rule never answers the confirmation on the user's behalf.
    if (facts.dirty && (options.automatic || !options.withUncommittedChanges)) throw new Error(RECLAIM_WORKTREE_NEEDS_CONFIRMATION)
    // A linked worktree's .git is a file; a directory there is a repository of its own and is never removed.
    if (!(await lstat(join(facts.path, '.git'))).isFile()) throw new Error('This folder is a repository of its own, not a worktree. Nothing was changed.')
    await this.registry(metadata.repositoryRoot!, ['worktree', 'remove', ...(facts.dirty ? ['--force'] : []), '--', facts.path], identity)
    return { ...metadata, branch: facts.branch, status: 'ready', error: undefined, dirty: undefined, reclaimedAt: new Date().toISOString() }
  }

  /** The first link under `root` whose target is outside it, if any. Walks without following links. */
  private async outsideLink(root: string): Promise<string | undefined> {
    const canonicalRoot = await realpath(root)
    const pending = [root]
    while (pending.length) {
      const directory = pending.pop()!
      const handle = await opendir(directory)
      try {
        for await (const entry of handle) {
          const full = join(directory, entry.name)
          if (entry.isSymbolicLink()) {
            const target = resolve(directory, await readlink(full).catch(() => full))
            const canonical = await realpath(target).catch(() => target)
            const local = relative(canonicalRoot, canonical)
            if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) return relative(root, full)
          } else if (entry.isDirectory()) pending.push(full)
        }
      } finally { await handle.close().catch(() => undefined) }
    }
    return undefined
  }

  /**
   * Switches the thread's own worktree back to `branch`, which the user asked for by hand: Sotto never
   * switches a branch on its own (ADR-0014). The folder is verified first, the branch must already exist,
   * and uncommitted work is left where it is for Git to carry across or refuse.
   */
  async switchBranch(metadata: AgentWorktree, branch: string): Promise<AgentWorktree> {
    // The name came from Git itself; refuse anything that could read as an option or a path.
    if (!/^(?!-)(?!.*\.\.)[^\s:?*~^[\]\\]+$/u.test(branch)) throw new Error('That branch name cannot be restored. Switch it in the folder itself.')
    const inspection = await this.inspectWithin(metadata)
    const inspected = inspection.worktree
    let identity = inspection.identity
    if (inspected.branch === branch) return inspected
    try {
      if (identity) await this.git(inspected.path!, ['rev-parse', '--verify', `refs/heads/${branch}`])
      else identity = await this.registryIdentity(inspected.path!, `refs/heads/${branch}`)
    }
    catch { throw new Error(`The branch ${branch} no longer exists in this repository. Nothing was changed.`) }
    // --no-guess never creates a branch from a remote; a conflicting change makes Git refuse and nothing moves.
    await this.registry(inspected.path!, ['switch', '--no-guess', branch], identity)
    return this.inspect(inspected)
  }

  async inspect(metadata: AgentWorktree): Promise<AgentWorktree> {
    return (await this.inspectWithin(metadata)).worktree
  }

  private async inspectWithin(metadata: AgentWorktree, identity?: RegistryIdentity, observed?: InspectionReads): Promise<{ worktree: AgentWorktree; identity?: RegistryIdentity }> {
    if (!metadata.path) throw new Error('The working folder is not allocated. Retry setup.')
    const path = await existingWorkingDirectory(metadata.path)
    if (metadata.mode === 'shared') {
      let repositoryRoot = observed?.root
      try { repositoryRoot ??= (await this.git(path, ['rev-parse', '--show-toplevel'])).trim() }
      catch (error) {
        if (error instanceof Error && /not a git repository|Git is unavailable/u.test(error.message)) return { worktree: { ...metadata, branch: undefined, dirty: false, status: 'ready', error: undefined } }
        throw error
      }
      const branch = (await this.git(path, ['branch', '--show-current'])).trim() || undefined
      return { worktree: { ...metadata, repositoryRoot, branch, dirty: (await this.git(path, ['status', '--porcelain', '--untracked-files=normal'])).length > 0, status: 'ready', error: undefined } }
    }
    // Inspection never creates a replacement for a deleted checkout.
    if (!metadata.repositoryRoot) throw new Error('The worktree binding is incomplete.')
    identity ??= await this.registryIdentity(metadata.repositoryRoot)
    // These were already inspection's ownership reads. Run them beside the registry
    // read so moving expected-common discovery earlier adds no subprocess or Git phase.
    const [rootResult, commonResult, listing] = await Promise.allSettled([
      observed ? Promise.resolve(observed.root) : this.git(path, ['rev-parse', '--show-toplevel']),
      observed?.common === undefined ? this.git(path, ['rev-parse', '--path-format=absolute', '--git-common-dir']) : Promise.resolve(observed.common),
      observed?.listing === undefined ? this.registry(metadata.repositoryRoot, ['worktree', 'list', '--porcelain', '-z'], identity) : Promise.resolve(observed.listing),
    ])
    if (listing.status === 'rejected') throw listing.reason
    const entries = registeredWorktrees(listing.value)
    const registered = entries.find(entry => pathKey(entry.path) === pathKey(path))
    if (registered?.locked || registered?.prunable) throw new Error('Git has locked this worktree or reports an incomplete checkout. Restore the checkout before continuing.')
    if (pathKey(path) !== pathKey(metadata.path) || !registered) throw new Error('The working folder is no longer this thread’s Git worktree. Restore its checkout before continuing.')
    // The thread follows whatever its worktree has checked out (ADR-0014): Sotto records the branch it
    // sees, none for a detached HEAD, and never switches one itself.
    const branch = registered.branch?.startsWith('refs/heads/') ? registered.branch.slice('refs/heads/'.length) : undefined
    if (rootResult.status === 'rejected') throw rootResult.reason
    if (commonResult.status === 'rejected') throw commonResult.reason
    const root = rootResult.value, common = commonResult.value
    if (pathKey(root.trim()) !== pathKey(path) || pathKey(common.trim()) !== pathKey(identity.common)) throw new Error('The working folder no longer belongs to the original repository.')
    await this.workingDirectory(metadata)
    // A folder that is there was not reclaimed, whatever the record last said.
    return { identity, worktree: { ...metadata, branch, ...(metadata.temporaryBranch && branch !== metadata.branch ? { temporaryBranch: false } : {}), status: 'ready', error: undefined, reclaimedAt: undefined, dirty: (await this.git(path, ['status', '--porcelain', '--untracked-files=normal'])).length > 0 } }
  }
}
