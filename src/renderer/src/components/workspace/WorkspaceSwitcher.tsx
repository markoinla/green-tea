import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  Plus,
  Pencil,
  Check,
  Trash2,
  MoreHorizontal,
  Type,
  SquarePen,
  FileText,
  Shapes,
  Table2,
  FolderPlus,
  Folder,
  Leaf
} from 'lucide-react'
import { useWorkspaces } from '@renderer/hooks/useWorkspaces'
import { useWorkspace } from '@renderer/hooks/useWorkspace'
import {
  creatablePluginKinds,
  getPluginViewersVersion,
  subscribePluginViewers
} from '@renderer/components/artifacts/registry'
import type { DocumentKind } from '../../../../main/database/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@renderer/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Button } from '@renderer/components/ui/button'

interface WorkspaceSwitcherProps {
  selectedWorkspaceId: string | null
  onSelectWorkspace: (id: string) => void
  onNewDocument?: () => void
  onNewCanvas?: () => void
  onNewTable?: () => void
  onNewArtifactKind?: (kind: DocumentKind, folderId?: string) => void
  onNewFolder?: () => void
}

export function WorkspaceSwitcher({
  selectedWorkspaceId,
  onSelectWorkspace,
  onNewDocument,
  onNewCanvas,
  onNewTable,
  onNewArtifactKind,
  onNewFolder
}: WorkspaceSwitcherProps) {
  // Re-render when the plugin-viewer store changes so creatable plugin kinds
  // appear/disappear in the New menu as plugins load/enable/disable.
  useSyncExternalStore(subscribePluginViewers, getPluginViewersVersion)
  const pluginKinds = creatablePluginKinds()
  const { workspaces, createWorkspace, deleteWorkspace, updateWorkspace } = useWorkspaces()
  const { workspace } = useWorkspace(selectedWorkspaceId)
  const [isOpen, setIsOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [showDescription, setShowDescription] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [renameName, setRenameName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const handleDelete = async () => {
    if (!selectedWorkspaceId) return
    const currentIndex = workspaces.findIndex((ws) => ws.id === selectedWorkspaceId)
    await deleteWorkspace(selectedWorkspaceId)
    const remaining = workspaces.filter((ws) => ws.id !== selectedWorkspaceId)
    if (remaining.length > 0) {
      const nextIndex = Math.min(currentIndex, remaining.length - 1)
      onSelectWorkspace(remaining[nextIndex].id)
    }
    setShowDeleteConfirm(false)
  }

  const handleRename = async () => {
    const trimmed = renameName.trim()
    if (!trimmed || !selectedWorkspaceId) return
    await updateWorkspace(selectedWorkspaceId, { name: trimmed })
    setShowRename(false)
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const handleCreated = (id: string) => {
    onSelectWorkspace(id)
    setShowCreate(false)
    setIsOpen(false)
  }

  return (
    <div className="group-data-[collapsible=icon]:hidden">
      <div className="relative" ref={dropdownRef}>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1.5 rounded-md text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
          >
            <span className="truncate">{workspace?.name ?? 'Select Workspace'}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {onNewDocument && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                  title="New"
                >
                  <SquarePen className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="bottom">
                <DropdownMenuItem onSelect={onNewDocument}>
                  <FileText className="h-4 w-4" />
                  New Note
                </DropdownMenuItem>
                {onNewCanvas && (
                  <DropdownMenuItem onSelect={onNewCanvas}>
                    <Shapes className="h-4 w-4" />
                    New Canvas
                  </DropdownMenuItem>
                )}
                {onNewTable && (
                  <DropdownMenuItem onSelect={onNewTable}>
                    <Table2 className="h-4 w-4" />
                    New Table
                  </DropdownMenuItem>
                )}
                {onNewArtifactKind &&
                  pluginKinds.map((entry) => (
                    <DropdownMenuItem
                      key={entry.kind}
                      onSelect={() => onNewArtifactKind(entry.kind)}
                    >
                      <entry.icon className="h-4 w-4" />
                      {entry.label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {onNewFolder && (
            <button
              onClick={onNewFolder}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors group-data-[collapsible=icon]:hidden"
              title="New Folder"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                title="Workspace options"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom">
              <DropdownMenuItem
                onSelect={() => {
                  setRenameName(workspace?.name ?? '')
                  setShowRename(true)
                }}
              >
                <Type className="h-4 w-4" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setShowDescription(true)}>
                <Pencil className="h-4 w-4" />
                Edit Description
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={workspaces.length <= 1}
                onSelect={() => setShowDeleteConfirm(true)}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {isOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-sidebar border border-sidebar-border rounded-lg shadow-lg py-1 max-h-64 overflow-auto">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => {
                  onSelectWorkspace(ws.id)
                  setIsOpen(false)
                }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-sidebar-accent transition-colors flex items-center gap-2 ${
                  ws.id === selectedWorkspaceId
                    ? 'text-sidebar-foreground font-medium'
                    : 'text-muted-foreground'
                }`}
              >
                {ws.id === selectedWorkspaceId && <Check className="h-3.5 w-3.5 shrink-0" />}
                {ws.id !== selectedWorkspaceId && <span className="w-3.5" />}
                <span className="truncate">{ws.name}</span>
              </button>
            ))}
            <div className="border-t border-sidebar-border my-1" />
            <button
              onClick={() => {
                setIsOpen(false)
                setShowCreate(true)
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors flex items-center gap-2"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New workspace</span>
            </button>
          </div>
        )}
      </div>

      {workspace && (
        <>
          <WorkspaceDescriptionDialog
            open={showDescription}
            onOpenChange={setShowDescription}
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            description={workspace.description}
          />
          <WorkspaceRenameDialog
            open={showRename}
            onOpenChange={setShowRename}
            name={renameName}
            onNameChange={setRenameName}
            onSave={handleRename}
          />
        </>
      )}

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <span className="font-medium text-foreground">{workspace?.name}</span>{' '}
              from Green Tea and clears its chat history. The workspace folder and all its files
              stay on disk — nothing is deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateWorkspaceDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        createWorkspace={createWorkspace}
        onCreated={handleCreated}
      />
    </div>
  )
}

/**
 * Mirror of the main-process sanitizeWorkspaceName (agent/paths.ts) so the
 * "Use default" preview path matches the folder the handler will actually
 * resolve. Kept in sync by hand — the rules are simple and stable.
 */
function sanitizeWorkspaceName(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'default'
  )
}

/** Last path segment of an absolute folder path (POSIX or Windows separators). */
function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/** Join a parent dir and a leaf segment with a single separator. */
function joinPath(parent: string, leaf: string): string {
  return `${parent.replace(/[\\/]+$/, '')}/${leaf}`
}

/** Display label for the default base; the handler expands it server-side. */
const DEFAULT_BASE = '~/Documents/Green Tea'

/**
 * Obsidian-style add-workspace dialog. Starts on a two-action chooser
 * (create a new workspace folder, or open an existing folder of notes);
 * "Create" drills into a name + location step, "Open" goes straight to the
 * native folder picker. The backend create handler resolves the default
 * location when `path` is omitted and throws on overlap/duplicate.
 */
function CreateWorkspaceDialog({
  open,
  onOpenChange,
  createWorkspace,
  onCreated
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  createWorkspace: (data: {
    name: string
    path?: string
    mode?: 'new' | 'open'
  }) => Promise<{ id: string }>
  onCreated: (id: string) => void
}) {
  const [view, setView] = useState<'choose' | 'create'>('choose')
  const [name, setName] = useState('')
  // null parent => default base; the handler resolves it server-side.
  const [parent, setParent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setView('choose')
      setName('')
      setParent(null)
      setError(null)
      setBusy(false)
    }
  }, [open])

  const leaf = sanitizeWorkspaceName(name || 'workspace')
  const targetFolder = joinPath(parent ?? DEFAULT_BASE, leaf)
  const canCreate = name.trim().length > 0 && !busy

  const handleChooseParent = async () => {
    const picked = await window.api.dialog.pickFolder()
    if (!picked) return
    setParent(picked)
    setError(null)
  }

  const handleCreate = async () => {
    if (!canCreate) return
    setBusy(true)
    setError(null)
    try {
      const ws = await createWorkspace({
        name: name.trim(),
        // Omit `path` for the default base so the handler resolves it.
        path: parent ? joinPath(parent, leaf) : undefined,
        mode: 'new'
      })
      onCreated(ws.id)
    } catch (e) {
      // The create handler throws on overlap/duplicate; surface its message inline.
      setError(e instanceof Error ? e.message : 'Could not create workspace.')
      setBusy(false)
    }
  }

  const handleOpenExisting = async () => {
    const picked = await window.api.dialog.pickFolder()
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      const ws = await createWorkspace({ name: basename(picked), path: picked, mode: 'open' })
      onCreated(ws.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open folder.')
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {view === 'choose' ? (
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="items-center text-center">
            <div className="mx-auto mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
              <Leaf className="h-7 w-7 text-primary" />
            </div>
            <DialogTitle>Add a workspace</DialogTitle>
            <DialogDescription>A workspace is a folder of notes on disk.</DialogDescription>
          </DialogHeader>

          <div className="mt-2 divide-y divide-border rounded-lg border border-border">
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Create new workspace</p>
                <p className="text-sm text-muted-foreground">Create a new workspace folder.</p>
              </div>
              <Button onClick={() => setView('create')} disabled={busy}>
                Create
              </Button>
            </div>
            <div className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Open existing folder</p>
                <p className="text-sm text-muted-foreground">Choose an existing folder of notes.</p>
              </div>
              <Button variant="outline" onClick={handleOpenExisting} disabled={busy}>
                Open
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      ) : (
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new workspace</DialogTitle>
            <DialogDescription>Name it and choose where the folder lives.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ws-name">Name</Label>
              <Input
                id="ws-name"
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canCreate) handleCreate()
                }}
                placeholder="Workspace name"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Location</Label>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-sm text-muted-foreground">
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate" title={targetFolder}>
                    {targetFolder}
                  </span>
                </div>
                {parent && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setParent(null)}>
                    Default
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={handleChooseParent}>
                  Choose…
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                The workspace folder will be created here.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" onClick={() => setView('choose')} disabled={busy}>
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
            <Button onClick={handleCreate} disabled={!canCreate}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}

function WorkspaceDescriptionDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  description
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceName: string
  description: string
}) {
  const [value, setValue] = useState(description)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync external changes (e.g. agent updates)
  useEffect(() => {
    setValue(description)
  }, [description])

  const save = useCallback(
    (text: string) => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(async () => {
        await window.api.workspaces.update(workspaceId, { description: text })
      }, 500)
    },
    [workspaceId]
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    setValue(text)
    save(text)
  }

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px]">
        <DialogHeader>
          <DialogTitle>{workspaceName}</DialogTitle>
          <DialogDescription>
            Workspace description — acts as persistent context for the AI agent (like a CLAUDE.md).
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={value}
          onChange={handleChange}
          placeholder="Describe this workspace: what project is this for, key conventions, architecture notes, etc. The AI agent reads this for context and can update it as it works."
          className="w-full h-96 text-sm bg-muted/50 text-foreground rounded-md border border-border px-3 py-2 resize-y outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50 font-mono"
        />
      </DialogContent>
    </Dialog>
  )
}

function WorkspaceRenameDialog({
  open,
  onOpenChange,
  name,
  onNameChange,
  onSave
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onNameChange: (name: string) => void
  onSave: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename workspace</DialogTitle>
          <DialogDescription>Enter a new name for this workspace.</DialogDescription>
        </DialogHeader>
        <input
          autoFocus
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) onSave()
          }}
          placeholder="Workspace name"
          className="w-full bg-muted/50 text-foreground text-sm px-2.5 py-1.5 rounded-md border border-border outline-none focus:ring-1 focus:ring-ring"
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
