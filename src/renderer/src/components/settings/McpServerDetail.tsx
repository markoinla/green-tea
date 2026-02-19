import { useState } from 'react'
import { ChevronLeft, Trash2, Loader2, Check, X, LogIn, LogOut, ShieldCheck } from 'lucide-react'
import { Switch } from '@renderer/components/ui/switch'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'

interface McpServerConfig {
  command?: string
  transport?: 'stdio' | 'http'
  args?: string[]
  env?: Record<string, string>
  url?: string
  enabled?: boolean
  idleTimeout?: number
}

interface McpServerStatus {
  name: string
  status: string
  toolCount: number
  error?: string
  authStatus?: string
}

interface McpServerDetailProps {
  name: string
  config: McpServerConfig
  status: McpServerStatus | undefined
  error: string | null
  testing: string | null
  authenticating: string | null
  onBack: () => void
  onUpdate: (name: string, config: McpServerConfig) => void
  onRemove: (name: string) => void
  onTest: (name: string) => Promise<{ success: boolean; toolCount?: number; error?: string }>
  onAuthenticate: (name: string) => void
  onClearAuth: (name: string) => void
}

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500',
  error: 'bg-red-500',
  disconnected: 'bg-foreground/20'
}

export function McpServerDetail({
  name,
  config: serverConfig,
  status,
  error,
  testing,
  authenticating,
  onBack,
  onUpdate,
  onRemove,
  onTest,
  onAuthenticate,
  onClearAuth
}: McpServerDetailProps) {
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{
    name: string
    success: boolean
    toolCount?: number
    error?: string
  } | null>(null)

  const handleTest = async () => {
    const result = await onTest(name)
    setTestResult({ name, ...result })
    setTimeout(() => setTestResult(null), 5000)
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={onBack}
      >
        <ChevronLeft className="size-4" />
        Back
      </button>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${STATUS_COLORS[status?.status || 'disconnected']}`}
            />
            <h3 className="text-base font-medium">{name}</h3>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={serverConfig.enabled !== false}
              onCheckedChange={(v) => onUpdate(name, { ...serverConfig, enabled: v })}
            />
            <button
              type="button"
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-red-500"
              onClick={() => setServerToDelete(name)}
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        </div>

        {(status?.error || error) && (
          <p className="text-xs text-red-500">Error: {status?.error || error}</p>
        )}

        {serverConfig.transport !== 'http' && (
          <>
            <div>
              <label className="text-sm font-medium">Command</label>
              <input
                type="text"
                className="mt-1 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
                value={serverConfig.command || ''}
                onChange={(e) => onUpdate(name, { ...serverConfig, command: e.target.value })}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Arguments</label>
              <input
                type="text"
                className="mt-1 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
                placeholder="space-separated args"
                defaultValue={(serverConfig.args || []).join(' ')}
                key={`args-${name}`}
                onBlur={(e) => {
                  const val = e.target.value.trim()
                  onUpdate(name, {
                    ...serverConfig,
                    args: val ? val.split(/\s+/) : undefined
                  })
                }}
              />
            </div>

            <div>
              <label className="text-sm font-medium">Environment</label>
              <textarea
                className="mt-1 w-full h-20 rounded-lg border border-border bg-background text-foreground text-sm px-3 py-2 resize-none font-mono"
                placeholder="KEY=value (one per line)"
                value={
                  serverConfig.env
                    ? Object.entries(serverConfig.env)
                        .map(([k, v]) => `${k}=${v}`)
                        .join('\n')
                    : ''
                }
                onChange={(e) => {
                  const env: Record<string, string> = {}
                  for (const line of e.target.value.split('\n')) {
                    const eq = line.indexOf('=')
                    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1)
                  }
                  onUpdate(name, {
                    ...serverConfig,
                    env: Object.keys(env).length > 0 ? env : undefined
                  })
                }}
              />
            </div>
          </>
        )}

        <div>
          <label className="text-sm font-medium">Transport</label>
          <select
            className="mt-1 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
            value={serverConfig.transport || 'stdio'}
            onChange={(e) =>
              onUpdate(name, {
                ...serverConfig,
                transport: e.target.value as 'stdio' | 'http'
              })
            }
          >
            <option value="stdio">stdio</option>
            <option value="http">HTTP</option>
          </select>
        </div>

        {serverConfig.transport === 'http' && (
          <div>
            <label className="text-sm font-medium">URL</label>
            <input
              type="text"
              className="mt-1 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
              placeholder="https://mcp.example.com/mcp"
              value={serverConfig.url || ''}
              onChange={(e) => onUpdate(name, { ...serverConfig, url: e.target.value })}
            />
          </div>
        )}

        {serverConfig.transport === 'http' && (
          <div>
            <label className="text-sm font-medium">Authentication</label>
            <div className="mt-1 flex items-center gap-2">
              {status?.authStatus === 'authenticated' ? (
                <>
                  <span className="inline-flex items-center gap-1 text-sm text-green-600">
                    <ShieldCheck className="size-4" />
                    Authenticated
                  </span>
                  <button
                    type="button"
                    className="h-8 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                    onClick={() => onClearAuth(name)}
                  >
                    <LogOut className="size-3.5" />
                    Sign Out
                  </button>
                  <button
                    type="button"
                    className="h-8 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground"
                    disabled={authenticating === name}
                    onClick={() => onAuthenticate(name)}
                  >
                    {authenticating === name ? 'Authenticating...' : 'Re-authenticate'}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-sm text-muted-foreground">Not authenticated</span>
                  <button
                    type="button"
                    className="h-8 rounded-lg bg-accent text-accent-foreground px-3 text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
                    disabled={authenticating === name}
                    onClick={() => onAuthenticate(name)}
                  >
                    {authenticating === name ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        Waiting for browser...
                      </>
                    ) : (
                      <>
                        <LogIn className="size-3.5" />
                        Authenticate
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="text-sm font-medium">Idle timeout (seconds)</label>
          <input
            type="number"
            className="mt-1 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
            placeholder="600"
            value={serverConfig.idleTimeout ?? ''}
            onChange={(e) =>
              onUpdate(name, {
                ...serverConfig,
                idleTimeout: e.target.value ? Number(e.target.value) : undefined
              })
            }
          />
        </div>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            className="h-9 rounded-lg bg-accent text-accent-foreground px-4 text-sm disabled:opacity-50"
            disabled={testing === name}
            onClick={handleTest}
          >
            {testing === name ? 'Testing...' : 'Test Connection'}
          </button>
          {testResult && testResult.name === name && (
            <span
              className={`inline-flex items-center gap-1 text-sm ${testResult.success ? 'text-green-600' : 'text-red-500'}`}
            >
              {testResult.success ? (
                <>
                  <Check className="size-4" />
                  Connected ({testResult.toolCount} tools)
                </>
              ) : (
                <>
                  <X className="size-4" />
                  {testResult.error}
                </>
              )}
            </span>
          )}
        </div>
      </div>

      <ConfirmDeleteDialog
        open={!!serverToDelete}
        onOpenChange={(open) => !open && setServerToDelete(null)}
        title="Remove MCP server"
        itemName={serverToDelete}
        description="Are you sure you want to remove"
        onConfirm={() => {
          if (serverToDelete) {
            onRemove(serverToDelete)
            onBack()
          }
          setServerToDelete(null)
        }}
      />
    </div>
  )
}
