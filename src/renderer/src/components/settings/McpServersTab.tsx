import { useState } from 'react'
import { Plus, Loader2 } from 'lucide-react'
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog'
import { McpServerAddForm } from './McpServerAddForm'
import { McpServerDetail } from './McpServerDetail'
import { useMcpServers } from '@renderer/hooks/useMcpServers'

const STATUS_COLORS: Record<string, string> = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500',
  error: 'bg-red-500',
  disconnected: 'bg-foreground/20'
}

export function McpServersTab() {
  const {
    config,
    statuses,
    loading,
    testing,
    error,
    authenticating,
    addServer,
    removeServer,
    updateServer,
    testConnection,
    authenticate,
    clearAuth
  } = useMcpServers()

  const [selectedServer, setSelectedServer] = useState<string | null>(null)
  const [serverToDelete, setServerToDelete] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const serverNames = Object.keys(config.mcpServers)

  // Detail view for a selected server
  if (selectedServer && config.mcpServers[selectedServer]) {
    return (
      <McpServerDetail
        name={selectedServer}
        config={config.mcpServers[selectedServer]}
        status={statuses.find((s) => s.name === selectedServer)}
        error={error}
        testing={testing}
        authenticating={authenticating}
        onBack={() => setSelectedServer(null)}
        onUpdate={updateServer}
        onRemove={removeServer}
        onTest={testConnection}
        onAuthenticate={authenticate}
        onClearAuth={clearAuth}
      />
    )
  }

  // List view
  return (
    <div className="space-y-4">
      <ConfirmDeleteDialog
        open={!!serverToDelete}
        onOpenChange={(open) => !open && setServerToDelete(null)}
        title="Remove MCP server"
        itemName={serverToDelete}
        description="Are you sure you want to remove"
        onConfirm={() => {
          if (serverToDelete) removeServer(serverToDelete)
          setServerToDelete(null)
        }}
      />

      {showAddForm ? (
        <McpServerAddForm
          onAdd={async (name, cfg) => {
            await addServer(name, cfg)
            setShowAddForm(false)
          }}
          onCancel={() => setShowAddForm(false)}
        />
      ) : (
        <button
          type="button"
          className="w-full h-9 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 inline-flex items-center justify-center gap-2"
          onClick={() => setShowAddForm(true)}
        >
          <Plus className="size-4" />
          Add MCP Server
        </button>
      )}

      <p className="text-xs text-muted-foreground">
        MCP servers provide external tools to the AI agent. Configure at ~/Documents/Green
        Tea/mcp.json or add servers below.
      </p>

      {error && <p className="text-xs text-red-500">{error}</p>}

      {serverNames.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {serverNames.map((name) => {
            const serverConfig = config.mcpServers[name]
            const status = statuses.find((s) => s.name === name)
            return (
              <button
                key={name}
                type="button"
                className={`rounded-lg border border-border bg-muted p-3 text-left hover:border-foreground/20 transition-colors ${serverConfig.enabled === false ? 'opacity-60' : ''}`}
                onClick={() => setSelectedServer(name)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`size-1.5 rounded-full shrink-0 ${STATUS_COLORS[status?.status || 'disconnected']}`}
                  />
                  <p className="text-sm font-medium truncate">{name}</p>
                  {status && status.toolCount > 0 && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {status.toolCount} tools
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {serverConfig.transport === 'http' ? serverConfig.url : serverConfig.command}
                </p>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-6">
          No MCP servers configured yet.
        </p>
      )}
    </div>
  )
}
