import { useEffect, useRef, useState } from 'react'

interface DraftSubmission<T> {
  readonly token: number
  readonly submitted: T
  readonly editVersion: number
  readonly authorityVersion: number
}

/** A text field's edits and ordered save acknowledgements; parsing and save policy stay with its caller. */
export function useRevisionDraft<T extends string | number>(authoritative: T, display: string, onAccept?: () => void) {
  const [value, setValue] = useState(display)
  const current = useRef(value)
  const revision = useRef(0)
  const token = useRef(0)
  const authorityVersion = useRef(0)
  const pending = useRef<DraftSubmission<T>[]>([])
  const source = useRef({ authoritative, display, onAccept })
  source.current = { authoritative, display, onAccept }

  const replace = (next: string): void => {
    current.current = next
    setValue(next)
  }

  useEffect(() => {
    const submission = pending.current.find(item => item.submitted === authoritative)
    if (submission) {
      pending.current = pending.current.filter(item => item.token > submission.token)
      if (revision.current !== submission.editVersion) return
    } else {
      // External authority wins now, and an older pending acknowledgement cannot undo it later.
      revision.current += 1
      authorityVersion.current += 1
    }
    current.current = display
    setValue(display)
    source.current.onAccept?.()
  }, [authoritative, display])

  return {
    value,
    read: (): string => current.current,
    edit: (next: string): void => { revision.current += 1; replace(next) },
    reset: (): void => { replace(source.current.display) },
    begin: (submitted: T, skipUnchanged = false): DraftSubmission<T> | null => {
      if (skipUnchanged && (
        (submitted === source.current.authoritative && !pending.current.some(item => item.submitted !== submitted)) ||
        pending.current.some(item => item.editVersion === revision.current)
      )) return null
      const submission = { token: ++token.current, submitted, editVersion: revision.current, authorityVersion: authorityVersion.current }
      // Repeated commits of one unchanged edit still use the caller's save policy, but need only the latest receipt.
      pending.current = pending.current.filter(item => item.editVersion !== submission.editVersion)
      pending.current.push(submission)
      return submission
    },
    isLatest: (submission: DraftSubmission<T>): boolean => pending.current.at(-1)?.token === submission.token && authorityVersion.current === submission.authorityVersion,
    fail: (submission: DraftSubmission<T>, restore: boolean): void => {
      const latest = pending.current.at(-1)?.token === submission.token
      pending.current = pending.current.filter(item => item.token !== submission.token)
      if (restore && latest && revision.current === submission.editVersion) replace(source.current.display)
    },
  }
}