import { useCallback, useState } from 'react'
import {
  ChevronRight,
  Plus,
  File,
  FolderUp,
  FolderOpen,
  ExternalLink,
  FileCode,
  ClipboardCopy,
  X,
  Ellipsis
} from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'
import { copyToClipboard } from '@renderer/lib/utils'
import { FileIcon } from './FileIcon'

interface WorkspaceFile {
  id: string
  file_name: string
  file_path: string
}

interface WorkspaceFilesSectionProps {
  files: WorkspaceFile[]
  addFiles: (paths: string[]) => void
  pickAndAddFiles: () => void
  pickAndAddFolder: () => void
  removeFile: (id: string) => void
  /** Open an HTML artifact in a Green Tea tab (instead of the OS app). */
  onOpenInApp: (file: WorkspaceFile) => void
}

/** HTML artifacts open in-app by default; everything else opens in the OS app. */
function isHtmlFile(fileName: string): boolean {
  return /\.html?$/i.test(fileName)
}

const FILES_COLLAPSED_KEY = 'greentea.sidebar.filesCollapsed'

export function WorkspaceFilesSection({
  files,
  addFiles,
  pickAndAddFiles,
  pickAndAddFolder,
  removeFile,
  onOpenInApp
}: WorkspaceFilesSectionProps) {
  // Persisted so the Files section's collapsed state survives refresh and
  // workspace switches (folder collapse is DB-backed; this is renderer-local).
  const [filesCollapsed, setFilesCollapsedState] = useState(
    () => localStorage.getItem(FILES_COLLAPSED_KEY) === '1'
  )
  const setFilesCollapsed = useCallback((collapsed: boolean) => {
    setFilesCollapsedState(collapsed)
    localStorage.setItem(FILES_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [])
  const [fileDragOver, setFileDragOver] = useState(false)

  return (
    <div className="border-t border-sidebar-border group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          type="button"
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider hover:text-foreground transition-colors"
          onClick={() => setFilesCollapsed(!filesCollapsed)}
        >
          <ChevronRight
            className={`h-3 w-3 transition-transform ${filesCollapsed ? '' : 'rotate-90'}`}
          />
          Context
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-0.5 rounded hover:bg-sidebar-accent text-muted-foreground hover:text-sidebar-foreground"
              title="Add files"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={pickAndAddFiles}>
              <File className="h-3.5 w-3.5 mr-2" />
              Add Files
            </DropdownMenuItem>
            <DropdownMenuItem onClick={pickAndAddFolder}>
              <FolderUp className="h-3.5 w-3.5 mr-2" />
              Add Folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!filesCollapsed && (
        <div
          className={`px-2 pb-2 max-h-40 overflow-y-auto transition-colors ${fileDragOver ? 'bg-sidebar-accent/50' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            e.stopPropagation()
            if (e.dataTransfer.types.includes('Files')) {
              e.dataTransfer.dropEffect = 'copy'
              setFileDragOver(true)
            }
          }}
          onDragLeave={(e) => {
            e.preventDefault()
            setFileDragOver(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setFileDragOver(false)
            const droppedFiles = Array.from(e.dataTransfer.files)
            const paths = droppedFiles.map((f) => window.api.getPathForFile(f)).filter(Boolean)
            if (paths.length > 0) {
              addFiles(paths)
            }
          }}
        >
          {files.length === 0 ? (
            <div
              className={`text-xs text-center py-3 rounded border border-dashed ${fileDragOver ? 'border-sidebar-ring text-sidebar-foreground' : 'border-sidebar-border text-muted-foreground'}`}
            >
              Drop files or folders here
            </div>
          ) : (
            <div className="space-y-0.5">
              <TooltipProvider delayDuration={1000}>
                {files.map((file) => {
                  const isHtml = isHtmlFile(file.file_name)
                  return (
                    <ContextMenu key={file.id}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <ContextMenuTrigger asChild>
                            <div
                              className={`flex items-center gap-1.5 px-1.5 py-1 rounded text-xs hover:bg-sidebar-accent group/file ${isHtml ? 'cursor-pointer' : 'cursor-default'}`}
                              onClick={
                                isHtml
                                  ? () => onOpenInApp(file)
                                  : () => window.api.shell.openPath(file.file_path)
                              }
                            >
                              <FileIcon fileName={file.file_name} />
                              <span className="truncate flex-1 text-sidebar-foreground">
                                {file.file_name}
                              </span>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <button
                                    type="button"
                                    className="shrink-0 p-0.5 rounded opacity-0 group-hover/file:opacity-100 hover:bg-background text-muted-foreground hover:text-foreground"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <Ellipsis className="h-3 w-3" />
                                  </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-44">
                                  {isHtml && (
                                    <DropdownMenuItem onClick={() => onOpenInApp(file)}>
                                      <FileCode className="h-3.5 w-3.5 mr-2" />
                                      Open in Green Tea
                                    </DropdownMenuItem>
                                  )}
                                  <DropdownMenuItem
                                    onClick={() => window.api.shell.openPath(file.file_path)}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                    Open File
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() =>
                                      window.api.shell.showItemInFolder(file.file_path)
                                    }
                                  >
                                    <FolderOpen className="h-3.5 w-3.5 mr-2" />
                                    Show in Folder
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => copyToClipboard(file.file_path, 'Path copied')}
                                  >
                                    <ClipboardCopy className="h-3.5 w-3.5 mr-2" />
                                    Copy Path
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => removeFile(file.id)}>
                                    <X className="h-3.5 w-3.5 mr-2" />
                                    Remove
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </ContextMenuTrigger>
                        </TooltipTrigger>
                        <TooltipContent side="right">{file.file_name}</TooltipContent>
                      </Tooltip>
                      <ContextMenuContent>
                        {isHtml && (
                          <ContextMenuItem onClick={() => onOpenInApp(file)}>
                            <FileCode className="h-3.5 w-3.5 mr-2" />
                            Open in Green Tea
                          </ContextMenuItem>
                        )}
                        <ContextMenuItem onClick={() => window.api.shell.openPath(file.file_path)}>
                          <ExternalLink className="h-3.5 w-3.5 mr-2" />
                          Open File
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => window.api.shell.showItemInFolder(file.file_path)}
                        >
                          <FolderOpen className="h-3.5 w-3.5 mr-2" />
                          Show in Folder
                        </ContextMenuItem>
                        <ContextMenuItem
                          onClick={() => copyToClipboard(file.file_path, 'Path copied')}
                        >
                          <ClipboardCopy className="h-3.5 w-3.5 mr-2" />
                          Copy Path
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => removeFile(file.id)}>
                          <X className="h-3.5 w-3.5 mr-2" />
                          Remove
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </TooltipProvider>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
