import { Download, RefreshCw, X } from 'lucide-react'
import { useAutoUpdate } from '@renderer/hooks/useAutoUpdate'

export function UpdateBanner() {
  const { status, downloadUpdate, quitAndInstall, dismissed, dismiss } = useAutoUpdate()

  if (dismissed) return null
  if (
    status.state !== 'available' &&
    status.state !== 'downloading' &&
    status.state !== 'downloaded'
  ) {
    return null
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-accent/80 px-4 py-1.5 text-xs text-accent-foreground">
      {status.state === 'available' && (
        <>
          <span>Version {status.version} is available</span>
          <button
            onClick={downloadUpdate}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Download className="h-3 w-3" />
            Download
          </button>
        </>
      )}

      {status.state === 'downloading' && (
        <>
          <span>Downloading update... {status.percent}%</span>
          <div className="h-1.5 w-32 rounded-full bg-primary/20 overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${status.percent}%` }}
            />
          </div>
        </>
      )}

      {status.state === 'downloaded' && (
        <>
          <span>Update ready — restart to apply</span>
          <button
            onClick={quitAndInstall}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            Restart & Update
          </button>
        </>
      )}

      {status.state !== 'downloading' && (
        <button
          onClick={dismiss}
          className="ml-1 rounded-sm p-0.5 text-accent-foreground/60 hover:text-accent-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}
