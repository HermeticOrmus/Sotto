import { z } from 'zod'
import { ThreadToolServer, type ScopedThreadTools, type ThreadMcpServer, type ThreadToolDefinition, type ThreadToolResult } from '../agents/threadToolServer'

/** The one name every client addresses the host setup tools by (ADR-0035). */
export const HOST_SETUP_MCP_SERVER = 'sotto_host_setup'
/** The host setup tools' own names. A tool takes no target: the device is fixed when its setup starts. */
export const HOST_SETUP_TOOL_NAMES = ['host_status', 'host_check', 'host_add'] as const
export type HostSetupToolName = typeof HOST_SETUP_TOOL_NAMES[number]
const inputs: Record<HostSetupToolName, z.ZodType> = {
  host_status: z.object({}).strict(),
  host_check: z.object({}).strict(),
  host_add: z.object({}).strict(),
}
const descriptions: Record<HostSetupToolName, string> = {
  host_status: 'Read what Sotto knows about the one device this thread is setting up: its name, SSH target and port, the host installation and data folders, and the last check or add with the step it stopped at, its reason code and Add host\'s sentence. Takes no arguments.',
  host_check: 'Run Add host\'s own checks on this thread\'s device: reach it over SSH, wait for a Tailscale approval if Tailscale asks, sign in, check the host installation, and start the host if it is installed and not running. It pairs nothing and saves nothing. Returns ok, or the step it stopped at with a reason code, Add host\'s sentence, and a command that fixes it where there is one. SSH questions and Tailscale approvals are answered by the user in Settings > Hosts, and the call waits for them, up to 5 minutes. Takes no arguments. Run it first, and again after each fix.',
  host_add: 'Add this thread\'s device as a host in Sotto. Sotto first asks the user in this thread whether to add it, and the call waits for their answer; never answer or approve it yourself. If they agree, Sotto connects, starts the host if needed and pairs this computer, and saves the host only once it answers. Returns added, declined, or the step it stopped at with a reason code. Takes no arguments. Call it once host_check gets as far as starting the host.',
}
export const hostSetupToolDefinitions: readonly ThreadToolDefinition[] = HOST_SETUP_TOOL_NAMES.map(name => ({
  name, description: descriptions[name], inputSchema: z.toJSONSchema(inputs[name], { io: 'input' }) as Record<string, unknown>,
}))
const INSTRUCTIONS = 'These tools set up the Sotto host on the one device this thread was started for, and nothing else. host_add asks the user in this thread and waits for their answer; never approve it yourself. If a call is interrupted or times out, read host_status before running it again.'

/** One tool's answer: what it found, and whether that is a failure the agent should act on. */
export interface HostSetupToolReply { readonly result: Record<string, unknown>; readonly isError?: boolean }
/** What the tools ask of the host setup, for the thread that called. */
export interface HostSetupToolHandlers {
  /** Whether this Sotto thread is setting up a host now; every other thread is refused. */
  admits(threadId: string): boolean
  run(threadId: string, tool: HostSetupToolName): Promise<HostSetupToolReply>
}

/**
 * `sotto_host_setup`: the loopback MCP server a host setup thread gets beside `sotto_browser` (ADR-0035). Only a
 * thread whose setup is running is given a token, and a token is revoked when that setup ends, so every other
 * thread's launch gets no server at all and a stopped setup's calls are refused.
 */
export class HostSetupToolServer implements ScopedThreadTools {
  readonly name = HOST_SETUP_MCP_SERVER
  readonly definitions = hostSetupToolDefinitions
  private readonly server: ThreadToolServer
  constructor(private readonly handlers: HostSetupToolHandlers) {
    this.server = new ThreadToolServer({ name: HOST_SETUP_MCP_SERVER, serverName: 'sotto-host-setup', instructions: INSTRUCTIONS,
      unavailable: 'This host setup tool is unavailable.', failed: 'The host setup tool could not finish. Read host_status before trying again.' },
    hostSetupToolDefinitions, (threadId, name, args) => this.invoke(threadId, name, args))
  }
  /** This thread's server while its setup runs; undefined for every other thread. */
  async mcpServer(threadId: string): Promise<ThreadMcpServer | undefined> {
    if (!this.handlers.admits(threadId)) return undefined
    return this.server.mcpServer(threadId)
  }
  call(threadId: string, name: string, args: unknown): Promise<ThreadToolResult> { return this.server.call(threadId, name, args) }
  revoke(threadId: string): void { this.server.revoke(threadId) }
  close(): Promise<void> { return this.server.close() }
  private async invoke(threadId: string, name: string, args: unknown): Promise<ThreadToolResult> {
    const text = (value: unknown, isError = false): ThreadToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) })
    if (!this.handlers.admits(threadId)) return text({ message: 'This thread is not setting up a host now. Nothing was checked or added.' }, true)
    const tool = HOST_SETUP_TOOL_NAMES.find(item => item === name)
    if (!tool) return text({ message: 'This host setup tool is unavailable.' }, true)
    if (!inputs[tool].safeParse(args).success) return text({ message: 'This tool takes no arguments. The device is fixed when the setup starts.' }, true)
    const reply = await this.handlers.run(threadId, tool)
    return text(reply.result, reply.isError === true)
  }
}
