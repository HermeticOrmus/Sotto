import { z } from 'zod'

/** The Add project folder browser's read: one folder's subfolders on the host that will run the project. */
export const AGENT_HOST_FOLDERS = 'sotto:agents:host-folders'
/** The most subfolders one listing carries; a folder with more says it was cut short. */
export const HOST_FOLDERS_MAX = 1000

const folderPath = z.string().min(1).max(4_096)
const name = z.string().min(1).max(512)

/**
 * Which folder to list, as the host spells it. No path is the host's home folder; `null` is the top of the
 * machine, which is its drives on Windows and `/` elsewhere. Paths travel in the host's own format and are
 * only ever joined or split by the host, so a Windows desktop browses a Linux host without translating.
 */
export const hostFoldersRequestSchema = z.object({ path: folderPath.nullable().optional() }).strict()
export type HostFoldersRequest = z.infer<typeof hostFoldersRequestSchema>

/** The window's request names the host as well, which main resolves before anything reaches that host. */
export const hostFoldersClientRequestSchema = hostFoldersRequestSchema.extend({ hostId: z.string().min(1).max(512) }).strict()
export type HostFoldersClientRequest = z.infer<typeof hostFoldersClientRequestSchema>

/** One step of the path back to the top; `path` is null for the top of a Windows machine, its list of drives. */
export const hostFolderCrumbSchema = z.object({ name, path: folderPath.nullable() }).strict()
export type HostFolderCrumb = z.infer<typeof hostFolderCrumbSchema>

/** A subfolder: its name, its full path on the host, and whether it holds a Git repository. */
export const hostFolderSchema = z.object({ name, path: folderPath, git: z.boolean() }).strict()
export type HostFolder = z.infer<typeof hostFolderSchema>

/**
 * A listing, or why there is none. `unreadable` is a folder the host's account may not read, or one Sotto will not
 * open for a paired device (a network share); `missing` is one that is gone or is not a folder. Neither changed
 * anything. Folder names only: files are never listed, and nothing inside a file is read.
 */
export const hostFoldersResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('listed'),
    /** The folder listed, or null for the drives of a Windows host. */
    path: folderPath.nullable(),
    home: folderPath,
    /** How this host separates folders, for naming a new folder inside the one listed. */
    separator: z.enum(['/', '\\']),
    /** From the top of the machine down to the folder listed, which is the last. */
    crumbs: z.array(hostFolderCrumbSchema).min(1).max(256),
    folders: z.array(hostFolderSchema).max(HOST_FOLDERS_MAX),
    truncated: z.boolean(),
  }).strict(),
  z.object({ status: z.enum(['unreadable', 'missing']), path: folderPath.nullable() }).strict(),
])
export type HostFoldersResult = z.infer<typeof hostFoldersResultSchema>
