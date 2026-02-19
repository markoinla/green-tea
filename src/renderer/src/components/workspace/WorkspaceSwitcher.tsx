import { useState, useRef, useEffect, useCallback } from 'react'
import {
  ChevronDown,
  Plus,
  Pencil,
  Check,
  X,
  Trash2,
  MoreHorizontal,
  Type,
  SquarePen,
  FolderPlus
} from 'lucide-react'
import { useWorkspaces } from '@renderer/hooks/useWorkspaces'
import { useWorkspace } from '@renderer/hooks/useWorkspace'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
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
  onNewFolder?: () => void
}

export function WorkspaceSwitcher({
  selectedWorkspaceId,
  onSelectWorkspace,
  onNewDocument,
  onNewFolder
}: WorkspaceSwitcherProps) {
  const { workspaces, createWorkspace, deleteWorkspace, updateWorkspace } = useWorkspaces()
  const { workspace } = useWorkspace(selectedWorkspaceId)
  const [isOpen, setIsOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [showDescription, setShowDescription] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showRename, setShowRename] = useState(false)
  const [renameName, setRenameName] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
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
        setIsCreating(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClick)
    }
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  useEffect(() => {
    if (isCreating && createInputRef.current) {
      createInputRef.current.focus()
    }
  }, [isCreating])

  const handleCreate = async () => {
    const trimmed = newName.trim()
    if (!trimmed) return
    const ws = await createWorkspace({ name: trimmed })
    onSelectWorkspace(ws.id)
    setNewName('')
    setIsCreating(false)
    setIsOpen(false)
  }

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate()
    } else if (e.key === 'Escape') {
      setIsCreating(false)
      setNewName('')
    }
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
            <button
              onClick={onNewDocument}
              className="h-7 w-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              title="New Document"
            >
              <SquarePen className="h-3.5 w-3.5" />
            </button>
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
                Delete
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
            {isCreating ? (
              <div className="px-3 py-1.5 flex items-center gap-1.5">
                <input
                  ref={createInputRef}
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={handleCreateKeyDown}
                  placeholder="Workspace name"
                  className="flex-1 bg-sidebar-accent/50 text-sidebar-foreground text-sm px-2 py-1 rounded border border-sidebar-border outline-none min-w-0"
                />
                <button
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                  className="h-7 px-2 rounded text-xs font-medium bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setIsCreating(false)
                    setNewName('')
                  }}
                  className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsCreating(true)}
                className="w-full text-left px-3 py-1.5 text-sm text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors flex items-center gap-2"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Workspace</span>
              </button>
            )}
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
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete{' '}
              <span className="font-medium text-foreground">{workspace?.name}</span> and all its
              documents, folders, and chat history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
