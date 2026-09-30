interface QuitEvent { preventDefault(): void }
interface QuitApp { prependListener(event: 'before-quit', listener: (event: QuitEvent) => void): unknown; quit(): void; exit(): void }
/** Give accepted writes and owned child processes ten seconds to settle before forcing exit. */
export function registerQuitDrain(app: QuitApp, drain: () => Promise<void>, failed: () => void): void {
  let pending: Promise<void> | undefined
  let complete = false
  // Intercept quit before bootstrap disposes the native windows and tray.
  app.prependListener('before-quit', event => {
    if (complete) return
    event.preventDefault()
    if (pending) return
    let timedOut = false
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<void>(resolve => {
      timer = setTimeout(() => { timedOut = true; resolve() }, 10_000)
    })
    pending = Promise.race([Promise.resolve().then(drain), timeout]).catch(() => failed()).finally(() => {
      clearTimeout(timer)
      complete = true
      if (timedOut) app.exit()
      else app.quit()
    })
  })
}
