import { useState, useEffect, useCallback, useMemo } from 'react'
import { FileText } from 'lucide-react'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem
} from '@renderer/components/ui/command'
import type { Document } from '../../../../main/database/types'

type SearchResult = Document & { workspace_name: string }

interface CommandMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedWorkspaceId: string | null
  onSelectDoc: (docId: string) => void
  onSelectWorkspace: (workspaceId: string) => void
}

export function CommandMenu({
  open,
  onOpenChange,
  selectedWorkspaceId,
  onSelectDoc,
  onSelectWorkspace
}: CommandMenuProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])

  const search = useCallback(async (q: string) => {
    const docs = await window.api.documents.search(q.trim())
    setResults(docs)
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      return
    }
    search('')
  }, [open, search])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => search(query), 150)
    return () => clearTimeout(timer)
  }, [query, search, open])

  const { currentDocs, otherByWorkspace } = useMemo(() => {
    const current: SearchResult[] = []
    const others = new Map<string, { workspaceName: string; docs: SearchResult[] }>()

    for (const doc of results) {
      if (doc.workspace_id === selectedWorkspaceId) {
        current.push(doc)
      } else {
        const existing = others.get(doc.workspace_id)
        if (existing) {
          existing.docs.push(doc)
        } else {
          others.set(doc.workspace_id, {
            workspaceName: doc.workspace_name,
            docs: [doc]
          })
        }
      }
    }

    return { currentDocs: current, otherByWorkspace: others }
  }, [results, selectedWorkspaceId])

  const handleSelect = (doc: SearchResult) => {
    if (doc.workspace_id !== selectedWorkspaceId) {
      onSelectWorkspace(doc.workspace_id)
    }
    setTimeout(() => onSelectDoc(doc.id), doc.workspace_id !== selectedWorkspaceId ? 50 : 0)
    onOpenChange(false)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search documents across all workspaces"
      showCloseButton={false}
    >
      <CommandInput placeholder="Search documents..." value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No documents found.</CommandEmpty>

        {currentDocs.length > 0 && (
          <CommandGroup heading="This Workspace">
            {currentDocs.map((doc) => (
              <CommandItem
                key={doc.id}
                value={`${doc.title} ${doc.workspace_name}`}
                onSelect={() => handleSelect(doc)}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {[...otherByWorkspace.entries()].map(([wsId, { workspaceName, docs }]) => (
          <CommandGroup key={wsId} heading={workspaceName}>
            {docs.map((doc) => (
              <CommandItem
                key={doc.id}
                value={`${doc.title} ${doc.workspace_name}`}
                onSelect={() => handleSelect(doc)}
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
