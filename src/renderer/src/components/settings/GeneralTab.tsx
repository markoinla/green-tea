import { useState, useEffect, useRef } from 'react'
import { Sun, Moon, FolderOpen } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { useSettings } from '@renderer/hooks/useSettings'
import { useAutoUpdate } from '@renderer/hooks/useAutoUpdate'

export function GeneralTab() {
  const { settings, loading, updateSetting } = useSettings()
  const {
    status: updateStatus,
    version,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall
  } = useAutoUpdate()
  const [baseDirValue, setBaseDirValue] = useState('')
  const themeDataRef = useRef<{ lightBackground?: string; darkBackground?: string }>({})

  useEffect(() => {
    if (!loading) {
      setBaseDirValue(settings.agentBaseDir)
    }
  }, [loading, settings.agentBaseDir])

  useEffect(() => {
    window.api.theme.get().then((data) => {
      themeDataRef.current = data
    })
    const unsub = window.api.onThemeChanged((data) => {
      themeDataRef.current = data
    })
    return unsub
  }, [])

  function handleThemeChange(theme: 'light' | 'dark') {
    updateSetting('theme', theme)
    document.documentElement.classList.toggle('dark', theme === 'dark')
    const bg =
      theme === 'dark'
        ? themeDataRef.current.darkBackground || '#3b3f3c'
        : themeDataRef.current.lightBackground || '#ffffff'
    document.documentElement.style.setProperty('--background', bg)
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">General</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          App behavior, workspace, and updates.
        </p>
      </div>
      {/* Theme */}
      <div>
        <label className="text-sm font-medium">Theme</label>
        <div className="mt-1.5 flex gap-2">
          <button
            type="button"
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm ${
              settings.theme === 'light'
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
            onClick={() => handleThemeChange('light')}
          >
            <Sun className="size-4" />
            Light
          </button>
          <button
            type="button"
            className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm ${
              settings.theme === 'dark'
                ? 'bg-accent text-accent-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
            onClick={() => handleThemeChange('dark')}
          >
            <Moon className="size-4" />
            Dark
          </button>
        </div>
      </div>

      {/* Show Tool Results */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium">Show tool results</label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Display tool output and errors in the chat activity log
          </p>
        </div>
        <Switch
          checked={settings.showToolResults}
          onCheckedChange={(v) => updateSetting('showToolResults', v)}
        />
      </div>

      {/* Agent Base Directory */}
      <div>
        <label className="text-sm font-medium">Agent workspace</label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Base directory for agent file operations. Each workspace gets its own subfolder.
        </p>
        <div className="mt-1.5 flex gap-2">
          <input
            type="text"
            readOnly
            className="flex-1 h-9 rounded-lg border border-border bg-muted text-foreground text-sm px-3 cursor-default"
            value={baseDirValue}
          />
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-sm text-muted-foreground hover:text-foreground"
            onClick={async () => {
              const folder = await window.api.dialog.pickFolder()
              if (folder) {
                setBaseDirValue(folder)
                updateSetting('agentBaseDir', folder)
              }
            }}
          >
            <FolderOpen className="size-4" />
            Browse
          </button>
        </div>
      </div>

      {/* Version & Updates */}
      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">Version</label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {version ? `v${version}` : '...'}
              {updateStatus.state === 'checking' && ' — Checking for updates...'}
              {updateStatus.state === 'not-available' && ' — Up to date'}
              {updateStatus.state === 'available' && ` — v${updateStatus.version} available`}
              {updateStatus.state === 'downloading' && ` — Downloading ${updateStatus.percent}%`}
              {updateStatus.state === 'downloaded' && ' — Update ready'}
              {updateStatus.state === 'error' && (
                <span className="text-red-500"> — {updateStatus.message}</span>
              )}
            </p>
          </div>
          <div className="flex gap-2">
            {updateStatus.state === 'downloaded' ? (
              <button
                type="button"
                className="h-8 rounded-lg bg-accent text-accent-foreground px-3 text-xs"
                onClick={quitAndInstall}
              >
                Restart & Update
              </button>
            ) : updateStatus.state === 'available' ? (
              <button
                type="button"
                className="h-8 rounded-lg bg-accent text-accent-foreground px-3 text-xs"
                onClick={downloadUpdate}
              >
                Download v{updateStatus.version}
              </button>
            ) : (
              <button
                type="button"
                className="h-8 rounded-lg bg-muted text-muted-foreground px-3 text-xs hover:text-foreground disabled:opacity-50"
                disabled={updateStatus.state === 'checking' || updateStatus.state === 'downloading'}
                onClick={checkForUpdates}
              >
                Check for Updates
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
