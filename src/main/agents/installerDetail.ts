/** A home folder in a line the installer printed: `C:\Users\<name>\…`, `/home/<name>/…`, `/Users/<name>/…`, `/root/…`. */
const HOME_PATH = /[A-Za-z]:\\[^\s"']+|\/(?:home|Users|root)\/[^\s"']+/gu

/** The lines worth showing: not blank, and not npm's pointer to a log that sits in the home folder. */
function shownLines(output: string): string[] {
  return output.split(/\r?\n/u).map(line => line.trim()).filter(Boolean)
    .filter(line => !/complete log of this run/iu.test(line))
}
const redact = (line: string): string => line.replace(HOME_PATH, '…').trim()

/**
 * What the installer said, bounded and without the machine in it. npm's last line is usually where
 * it put its log ("A complete log of this run can be found in C:\Users\<name>\..."), which is a home
 * folder and a user name on their way to the card, to Settings and to the turn record on disk. That
 * line is dropped, and any absolute path left in the one shown is replaced by an ellipsis.
 */
export function installerDetail(stderr: string): string | undefined {
  const tail = shownLines(stderr).at(-1)
  if (tail === undefined) return undefined
  const redacted = redact(tail)
  return redacted ? redacted.slice(0, 200) : undefined
}

/**
 * The last few lines the installer printed, for "What mise printed" under a failed update's Details: the same lines
 * `installerDetail` would choose from, each without a home folder, at most eight of them and 1,200 characters.
 */
export function installerOutput(output: string, lines = 8): string | undefined {
  const shown = shownLines(output).slice(-lines).map(line => redact(line).slice(0, 300)).filter(Boolean)
  if (!shown.length) return undefined
  let text = shown.join('\n')
  while (text.length > 1200 && shown.length > 1) { shown.shift(); text = shown.join('\n') }
  return text.slice(0, 1200)
}
