import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronLeft, FolderRoot, Folder as FolderIcon, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@renderer/components/ui/dialog'
import { Button } from '@renderer/components/ui/button'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from '@renderer/components/ui/command'
import { useWorkspaces } from '@renderer/hooks/useWorkspaces'
import type { Folder } from '../../../../../main/database/types'

// Bind to the frozen IPC contract via the ambient `window.api` signature. The
// preload exports this shape as `CopyToWorkspaceParams`, but its declaration in
// `index.d.ts` is shadowed by the sibling `index.ts` on a bare module import, so
// we derive it from the method's parameter type instead — same type, no drift.
type CopyToWorkspaceParams = Parameters<typeof window.api.documents.copyToWorkspace>[0]

/** The item the user chose to transfer, described enough to build the IPC params. */
export interface CopyToWorkspaceSource {
  kind: 'document' | 'folder'
  /** 'copy' duplicates the item; 'move' also removes the source. */
  mode: 'copy' | 'move'
  /** Present when kind === 'document'. */
  documentId?: string
  /** The workspace the source currently lives in (folder copies need it; also used
   *  to de-emphasize the current workspace in the target list). */
  sourceWorkspaceId?: string
  /** Present when kind === 'folder' — the folder DB `name` (a relative slash-path). */
  folderName?: string
  /** Present when kind === 'folder' — the folder DB id (a move deletes it). */
  folderId?: string
  /** Shown in the dialog header. */
  displayName: string
}

interface CopyToWorkspaceDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  source: CopyToWorkspaceSource | null
}

export function CopyToWorkspaceDialog({ open, onOpenChange, source }: CopyToWorkspaceDialogProps) {
  const { workspaces } = useWorkspaces()
  // Two-step flow: first pick the target workspace, then a destination folder.
  const [step, setStep] = useState<'workspace' | 'folder'>('workspace')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string | null>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [foldersLoading, setFoldersLoading] = useState(false)
  // Destination folder DB `name`; '' means the workspace root.
  const [selectedFolder, setSelectedFolder] = useState('')
  const [copying, setCopying] = useState(false)

  // Reset the picker each time the dialog (re)opens so a stale target/step never
  // leaks across invocations.
  useEffect(() => {
    if (open) {
      setStep('workspace')
      setTargetWorkspaceId(null)
      setFolders([])
      setSelectedFolder('')
      setCopying(false)
    }
  }, [open])

  const targetWorkspaceName = useMemo(
    () => workspaces.find((w) => w.id === targetWorkspaceId)?.name ?? 'workspace',
    [workspaces, targetWorkspaceId]
  )

  // Verb-forms driven by the operation, so one dialog serves both copy and move.
  const isMove = source?.mode === 'move'
  const verb = isMove ? 'Move' : 'Copy'
  const verbLower = isMove ? 'move' : 'copy'
  const verbActive = isMove ? 'Moving' : 'Copying'
  const verbPast = isMove ? 'Moved' : 'Copied'

  // Folders are flat rows whose `name` is a slash-path; sort them so the list is
  // stable and readable.
  const sortedFolders = useMemo(
    () => [...folders].sort((a, b) => a.name.localeCompare(b.name)),
    [folders]
  )

  const handlePickWorkspace = async (workspaceId: string): Promise<void> => {
    setTargetWorkspaceId(workspaceId)
    setSelectedFolder('')
    setStep('folder')
    setFoldersLoading(true)
    try {
      const result = await window.api.folders.list(workspaceId)
      setFolders(result)
    } catch {
      setFolders([])
    } finally {
      setFoldersLoading(false)
    }
  }

  const handleCopy = async (): Promise<void> => {
    if (!source || !targetWorkspaceId) return
    setCopying(true)
    try {
      const params: CopyToWorkspaceParams =
        source.kind === 'document'
          ? {
              kind: 'document',
              mode: source.mode,
              documentId: source.documentId,
              targetWorkspaceId,
              targetFolder: selectedFolder
            }
          : {
              kind: 'folder',
              mode: source.mode,
              sourceWorkspaceId: source.sourceWorkspaceId,
              folderName: source.folderName,
              folderId: source.folderId,
              targetWorkspaceId,
              targetFolder: selectedFolder
            }
      const { createdCount } = await window.api.documents.copyToWorkspace(params)
      toast.success(
        `${verbPast} ${createdCount} ${createdCount === 1 ? 'file' : 'files'} to ${targetWorkspaceName}`
      )
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${verbLower}`)
    } finally {
      setCopying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{verb} to workspace</DialogTitle>
          <DialogDescription>
            {step === 'workspace'
              ? `Choose a workspace to ${verbLower} "${source?.displayName ?? ''}" into.`
              : `Choose a destination folder in ${targetWorkspaceName}.`}
          </DialogDescription>
        </DialogHeader>

        {step === 'workspace' ? (
          <Command className="rounded-md border">
            <CommandInput placeholder="Search workspaces..." />
            <CommandList>
              <CommandEmpty>No workspaces found.</CommandEmpty>
              <CommandGroup>
                {workspaces.map((ws) => {
                  const isSource = ws.id === source?.sourceWorkspaceId
                  return (
                    <CommandItem
                      key={ws.id}
                      value={`${ws.name} ${ws.id}`}
                      onSelect={() => handlePickWorkspace(ws.id)}
                    >
                      <span className={isSource ? 'truncate text-muted-foreground' : 'truncate'}>
                        {ws.name}
                      </span>
                      {isSource && (
                        <span className="ml-auto text-xs text-muted-foreground">current</span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        ) : (
          <Command className="rounded-md border">
            <CommandInput placeholder="Search folders..." />
            <CommandList>
              {foldersLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading folders...
                </div>
              ) : (
                <>
                  <CommandEmpty>No folders found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__root__ Workspace root"
                      onSelect={() => setSelectedFolder('')}
                    >
                      <FolderRoot className="h-3.5 w-3.5" />
                      <span className="truncate">Workspace root</span>
                      {selectedFolder === '' && <Check className="ml-auto h-3.5 w-3.5" />}
                    </CommandItem>
                    {sortedFolders.map((folder) => (
                      <CommandItem
                        key={folder.id}
                        value={folder.name}
                        onSelect={() => setSelectedFolder(folder.name)}
                      >
                        <FolderIcon className="h-3.5 w-3.5" />
                        <span className="truncate">{folder.name}</span>
                        {selectedFolder === folder.name && (
                          <Check className="ml-auto h-3.5 w-3.5" />
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        )}

        <DialogFooter>
          {step === 'folder' && (
            <Button
              variant="outline"
              onClick={() => setStep('workspace')}
              disabled={copying}
              className="sm:mr-auto"
            >
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={copying}>
            Cancel
          </Button>
          <Button onClick={handleCopy} disabled={step !== 'folder' || foldersLoading || copying}>
            {copying && <Loader2 className="h-4 w-4 animate-spin" />}
            {copying ? `${verbActive}...` : verb}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
