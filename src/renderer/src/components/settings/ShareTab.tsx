import { useState, useEffect } from 'react'
import { Key, Link2 } from 'lucide-react'
import type { Settings } from '@renderer/hooks/useSettings'

interface ShareTabProps {
  settings: Settings
  updateSetting: (key: keyof Settings, value: string | boolean) => void
}

export function ShareTab({ settings, updateSetting }: ShareTabProps) {
  // Local state committed on blur, mirroring the API-key field idiom in ModelsTab.
  const [token, setToken] = useState('')
  const [baseUrl, setBaseUrl] = useState('')

  useEffect(() => {
    setToken(settings['share.publishToken'])
    setBaseUrl(settings['share.baseUrl'])
  }, [settings])

  return (
    <div className="space-y-6">
      {/* Publish token (secret) */}
      <div>
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Key className="size-3.5 text-muted-foreground" />
          Publish token
        </label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Secret bearer token used to publish shared pages. Stored locally on this device — never
          committed or synced.
        </p>
        <input
          type="password"
          className="mt-1.5 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
          placeholder="Enter your publish token"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onBlur={() => updateSetting('share.publishToken', token)}
        />
      </div>

      {/* Share base URL */}
      <div>
        <label className="text-sm font-medium flex items-center gap-1.5">
          <Link2 className="size-3.5 text-muted-foreground" />
          Share base URL
        </label>
        <p className="text-xs text-muted-foreground mt-0.5">
          The host that serves published pages. Leave the default unless you self-host.
        </p>
        <input
          type="text"
          className="mt-1.5 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
          placeholder="https://share.greentea.app"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          onBlur={() => updateSetting('share.baseUrl', baseUrl)}
        />
      </div>
    </div>
  )
}
