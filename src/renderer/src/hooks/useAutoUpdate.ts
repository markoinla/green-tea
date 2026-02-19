import { useState, useEffect, useCallback } from 'react'

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }

export function useAutoUpdate() {
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.api.app.getVersion().then(setVersion)
    window.api.app.getUpdateStatus().then(setStatus)
    const unsub = window.api.app.onUpdateStatus(setStatus)
    return unsub
  }, [])

  // Reset dismissed when a new download completes (so "Restart" banner shows)
  useEffect(() => {
    if (status.state === 'downloaded') {
      setDismissed(false)
    }
  }, [status.state])

  const checkForUpdates = useCallback(() => {
    window.api.app.checkForUpdates()
  }, [])

  const downloadUpdate = useCallback(() => {
    window.api.app.downloadUpdate()
  }, [])

  const quitAndInstall = useCallback(() => {
    window.api.app.quitAndInstall()
  }, [])

  const dismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  return { status, version, checkForUpdates, downloadUpdate, quitAndInstall, dismissed, dismiss }
}
