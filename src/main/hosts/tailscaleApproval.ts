/**
 * Tailscale SSH in a tailnet policy's `check` mode holds a new connection until the user approves it in a
 * browser. It says so in an SSH banner, which OpenSSH prints on stderr:
 *
 *   # Tailscale SSH requires an additional check.
 *   # To authenticate, visit: https://login.tailscale.com/a/…
 *
 * Nothing here is logged: the approval URL goes to the Add host dialog and to the browser on the user's press.
 */

/** Tailscale's own approval pages, the only ones "Open approval page" opens. The same shape Phones accepts from `tailscale serve`. */
const APPROVAL_URL = /^https:\/\/login\.tailscale\.com\/[A-Za-z0-9/?=&%._~-]{1,2000}$/u
const CHECK = /Tailscale SSH requires an additional check/iu
const VISIT = /To authenticate, visit:\s*(\S+)/iu

/** Whether a URL is one of Tailscale's own approval pages: https, login.tailscale.com, nothing else in front. */
export function isTailscaleApprovalUrl(value: string): boolean {
  if (!APPROVAL_URL.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'login.tailscale.com' && url.port === '' && !url.username && !url.password
  } catch { return false }
}

/** A connection Tailscale SSH is holding for approval, and its approval page when it is Tailscale's own. */
export interface TailscaleHold { readonly url?: string }
/** Reads Tailscale SSH's check banner from what ssh printed on stderr so far, or undefined when there is none. */
export function tailscaleHold(stderr: string): TailscaleHold | undefined {
  if (!CHECK.test(stderr)) return undefined
  const url = VISIT.exec(stderr)?.[1]?.replace(/[.,;)]+$/u, '')
  return url && isTailscaleApprovalUrl(url) ? { url } : {}
}
