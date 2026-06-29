// Shared "the app is genuinely quitting" flag. The macOS close interceptor in
// index.ts hides the window instead of destroying it unless this is set, so any
// path that must actually tear the app down (Cmd-Q, tray Quit, app-menu Quit,
// and crucially an auto-update restart) has to flip it first. Lives in its own
// module so both index.ts and auto-updater.ts can reach it without a cycle.
let quitting = false

export function isQuitting(): boolean {
  return quitting
}

export function markQuitting(): void {
  quitting = true
}
