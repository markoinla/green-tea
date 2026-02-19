import { useState } from 'react'
import { X } from 'lucide-react'

interface McpServerAddFormProps {
  onAdd: (
    name: string,
    config: { command?: string; transport: 'stdio' | 'http'; args?: string[]; url?: string }
  ) => Promise<void>
  onCancel: () => void
}

export function McpServerAddForm({ onAdd, onCancel }: McpServerAddFormProps) {
  const [newName, setNewName] = useState('')
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')
  const [newTransport, setNewTransport] = useState<'stdio' | 'http'>('stdio')
  const [newUrl, setNewUrl] = useState('')

  const handleAdd = async () => {
    if (!newName.trim()) return
    if (newTransport === 'stdio' && !newCommand.trim()) return
    if (newTransport === 'http' && !newUrl.trim()) return
    const args = newArgs.trim() ? newArgs.trim().split(/\s+/) : undefined
    const url = newTransport === 'http' && newUrl.trim() ? newUrl.trim() : undefined
    const command = newCommand.trim() || undefined
    await onAdd(newName.trim(), { command, transport: newTransport, args, url })
    setNewName('')
    setNewCommand('')
    setNewArgs('')
    setNewUrl('')
    setNewTransport('stdio')
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Add MCP Server</h3>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          onClick={onCancel}
        >
          <X className="size-4" />
        </button>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Name</label>
        <input
          type="text"
          className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background text-foreground text-sm px-3"
          placeholder="my-server"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Transport</label>
        <select
          className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background text-foreground text-sm px-3"
          value={newTransport}
          onChange={(e) => setNewTransport(e.target.value as 'stdio' | 'http')}
        >
          <option value="stdio">stdio</option>
          <option value="http">HTTP</option>
        </select>
      </div>
      {newTransport === 'stdio' && (
        <>
          <div>
            <label className="text-xs text-muted-foreground">Command</label>
            <input
              type="text"
              className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background text-foreground text-sm px-3"
              placeholder="npx @modelcontextprotocol/server-filesystem"
              value={newCommand}
              onChange={(e) => setNewCommand(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Arguments</label>
            <input
              type="text"
              className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background text-foreground text-sm px-3"
              placeholder="space-separated args"
              value={newArgs}
              onChange={(e) => setNewArgs(e.target.value)}
            />
          </div>
        </>
      )}
      {newTransport === 'http' && (
        <div>
          <label className="text-xs text-muted-foreground">URL</label>
          <input
            type="text"
            className="mt-0.5 w-full h-8 rounded-lg border border-border bg-background text-foreground text-sm px-3"
            placeholder="https://mcp.example.com/mcp"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
          />
        </div>
      )}
      <button
        type="button"
        className="h-8 rounded-lg bg-accent text-accent-foreground px-3 text-sm disabled:opacity-50"
        disabled={
          !newName.trim() ||
          (newTransport === 'stdio' && !newCommand.trim()) ||
          (newTransport === 'http' && !newUrl.trim())
        }
        onClick={handleAdd}
      >
        Add Server
      </button>
    </div>
  )
}
