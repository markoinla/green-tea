import { ipcMain } from 'electron'
import { renameSync, existsSync, statSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { readFile } from 'fs/promises'
import * as blocks from '../database/repositories/blocks'
import * as agentLogs from '../database/repositories/agent-logs'
import * as folders from '../database/repositories/folders'
import * as workspaces from '../database/repositories/workspaces'
import * as settings from '../database/repositories/settings'
import * as conversations from '../database/repositories/conversations'
import * as documents from '../vault/documents-service'
import { copyItemToWorkspace, type CopyToWorkspaceParams } from '../vault/copy-service'
import * as documentViewState from '../database/repositories/document-view-state'
import { MAX_ARTIFACT_BYTES, atomicWriteFile } from '../vault/note-store'
import { markSelfWrite } from '../vault/self-write'
import { readWorkspaceDoc, writeWorkspaceDoc, ensureWorkspaceDocs } from '../vault/workspace-docs'
import type { DocumentKind } from '../database/types'
import { patchHtmlText } from '../protocol/html-text-patch'
import { getWorkspaceVaultDir, ensureVaultDir } from '../vault/paths'
import { ensureWorkspaceRepo } from '../git/workspace-git'
import { deserializeMarkdown } from '../markdown/deserialize'
import { tiptapToMarkdown, type TTDoc } from '../markdown/tiptap-markdown'
import { restartThemeWatcher } from '../theme-watcher'
import { restartVaultWatcher } from '../vault/vault-watcher'
import { restartSettingsWatcher } from '../git/settings-watcher'
import { resetSession } from '../agent/session'
import { getDefaultWorkspaceDir } from '../agent/paths'
import type { IpcHandlerContext } from './context'

/**
 * Create-new seed: drop a single empty `index.md` into a fresh workspace folder
 * so it isn't bare (§2 residual default). Skipped if the folder already has any
 * indexable file (so re-creating over an existing folder doesn't clobber it).
 * The note carries no frontmatter — reindexWorkspace's readNote backfills
 * id/created/updated on first index.
 */
function ensureSeedNote(vaultDir: string): void {
  const hasFiles =
    existsSync(vaultDir) &&
    readdirSync(vaultDir, { withFileTypes: true }).some(
      (e) => e.isFile() && !e.name.startsWith('.')
    )
  if (hasFiles) return
  const indexPath = join(vaultDir, 'index.md')
  if (!existsSync(indexPath)) writeFileSync(indexPath, '# index\n', 'utf-8')
}

export function registerDbHandlers({ db, mainWindow }: IpcHandlerContext): void {
  // Workspaces
  ipcMain.handle('db:workspaces:list', () => {
    // description now lives in `README.md` at the workspace root, not
    // the (vestigial) DB column — surface the file content so the switcher shows the
    // current value with no renderer change.
    return workspaces
      .listWorkspaces(db)
      .map((ws) => ({ ...ws, description: readWorkspaceDoc(db, ws.id, 'description') }))
  })

  ipcMain.handle('db:workspaces:get', (_event, id: string) => {
    const ws = workspaces.getWorkspace(db, id)
    if (!ws) return ws
    return { ...ws, description: readWorkspaceDoc(db, ws.id, 'description') }
  })

  ipcMain.handle(
    'db:workspaces:create',
    (_event, data: { name: string; path?: string; mode?: 'new' | 'open' }) => {
      // Picker payload: `path` is the picked/default folder; `mode` is whether the
      // user is creating a fresh workspace folder or opening an existing one full
      // of notes. When `path` is omitted (legacy callers), default the folder to
      // `~/Documents/Green Tea/<sanitized-name>/`.
      const path = data.path ?? getDefaultWorkspaceDir(db, data.name)
      const mode = data.mode ?? 'new'
      // Reject equal/overlapping registrations against the one global DB.
      workspaces.assertNoOverlap(db, path)
      const workspace = workspaces.createWorkspace(db, { name: data.name, path })
      // One folder per workspace: the durable notes vault, also the agent's home.
      const vaultDir = getWorkspaceVaultDir(db, workspace.id)
      ensureVaultDir(vaultDir)
      // Seed the visible, indexed README.md / MEMORY.md
      // (empty) before the reindex below so they're picked up like any other note.
      ensureWorkspaceDocs(db, workspace.id)
      if (mode === 'open') {
        // Open-existing: recursively index whatever `.md`/`.html`/`.csv` already
        // lives in the chosen folder (dotfolders incl. `.greentea/` are skipped by
        // the vault walk). No reinvention — reindexWorkspace walks ws.path.
        documents.reindexWorkspace(db, workspace.id)
        mainWindow?.webContents.send('documents:changed')
        mainWindow?.webContents.send('folders:changed')
      } else {
        // Create-new: seed a single empty `index.md` so the folder isn't bare.
        ensureSeedNote(vaultDir)
        documents.reindexWorkspace(db, workspace.id)
        mainWindow?.webContents.send('documents:changed')
      }
      // A new workspace folder must be picked up by the (multi-root) watcher.
      restartVaultWatcher()
      // Initialize the per-workspace git repo (+ managed .gitignore). Idempotent
      // and serialized internally; fire-and-forget so workspace creation isn't
      // blocked on git init (commits self-heal via ensureRepo if this loses a race).
      ensureWorkspaceRepo(db, workspace.id).catch((err) =>
        console.error('[git] ensureRepo failed for new workspace', workspace.id, err)
      )
      mainWindow?.webContents.send('workspaces:changed')
      return workspace
    }
  )

  // Mark a workspace's folder as relocated (folder moved/recreated elsewhere on
  // disk). Repoints `ws.path`, rebuilds the index from the new location, and
  // re-aims the watcher. Used by the "unavailable" recovery flow.
  ipcMain.handle('db:workspaces:relocate', (_event, id: string, newPath: string) => {
    workspaces.assertNoOverlap(db, newPath)
    workspaces.setWorkspacePath(db, id, newPath)
    ensureVaultDir(getWorkspaceVaultDir(db, id))
    documents.reindexWorkspace(db, id)
    restartVaultWatcher()
    ensureWorkspaceRepo(db, id).catch((err) =>
      console.error('[git] ensureRepo failed for relocated workspace', id, err)
    )
    mainWindow?.webContents.send('workspaces:changed')
    mainWindow?.webContents.send('documents:changed')
    mainWindow?.webContents.send('folders:changed')
    return workspaces.getWorkspace(db, id)
  })

  // Per-workspace availability: a workspace whose `path` folder no longer exists
  // on disk is "unavailable" (moved/deleted out from under us). The UI offers
  // Relocate / Remove rather than erroring.
  ipcMain.handle('db:workspaces:availability', () => {
    return workspaces.listWorkspaces(db).map((w) => ({
      id: w.id,
      path: w.path,
      available: !documents.isWorkspaceUnavailable(db, w.id)
    }))
  })

  ipcMain.handle(
    'db:workspaces:update',
    (_event, id: string, data: { name?: string; description?: string }) => {
      if (data.name) {
        const oldWorkspace = workspaces.getWorkspace(db, id)
        if (oldWorkspace && data.name !== oldWorkspace.name) {
          // The workspace folder is now `ws.path`. Only auto-rename the folder when
          // it still lives at its default location (`<base>/<sanitized-name>/`);
          // arbitrary user-picked folders keep their path on rename. Repoint
          // `ws.path` to the new folder so resolution stays correct.
          const oldDir = oldWorkspace.path
          const defaultOldDir = getDefaultWorkspaceDir(db, oldWorkspace.name)
          if (workspaces.normalizePath(oldDir) === workspaces.normalizePath(defaultOldDir)) {
            const newDir = getDefaultWorkspaceDir(db, data.name)
            if (existsSync(oldDir) && !existsSync(newDir)) renameSync(oldDir, newDir)
            workspaces.setWorkspacePath(db, id, newDir)
          }
        }
      }
      // description now lives in `README.md`, not the DB column: route
      // it to the file (atomic + self-write so the watcher doesn't echo-loop) and
      // strip it so updateWorkspace only sees name/path/other fields.
      const { description, ...rest } = data
      if (description !== undefined) {
        writeWorkspaceDoc(db, id, 'description', description)
      }
      const workspace = workspaces.updateWorkspace(db, id, rest)
      // File paths in the index moved with the vault dir — rebuild from disk.
      documents.reindexWorkspace(db, id)
      mainWindow?.webContents.send('workspaces:changed')
      mainWindow?.webContents.send('documents:changed')
      return workspace
    }
  )

  ipcMain.handle('db:workspaces:delete', (_event, id: string) => {
    // De-register only (Obsidian "Remove"): drop the DB rows but leave the folder
    // and all its files on disk untouched. The user owns the folder; deleting the
    // workspace just stops Green Tea from tracking it.
    workspaces.deleteWorkspace(db, id)
    // The removed folder must no longer be watched.
    restartVaultWatcher()
    mainWindow?.webContents.send('workspaces:changed')
    mainWindow?.webContents.send('documents:changed')
    mainWindow?.webContents.send('folders:changed')
  })

  // Documents
  ipcMain.handle('db:documents:list', (_event, workspaceId?: string) => {
    return documents.listDocuments(db, workspaceId)
  })

  // Rebuild the index for a workspace from disk (the authoritative reconcile):
  // picks up notes/folders added, removed, or moved outside the app and prunes
  // anything stale. Exposed to the UI as a manual "Refresh" of the file tree.
  ipcMain.handle('db:documents:reindex', (_event, workspaceId: string) => {
    documents.reindexWorkspace(db, workspaceId)
    mainWindow?.webContents.send('documents:changed')
    mainWindow?.webContents.send('folders:changed')
  })

  // Copy or MOVE a single document or a whole folder subtree into a target
  // workspace/folder. Filesystem-only copy first (fresh ids, collision-safe names),
  // then reindex the TARGET workspace. For a move we additionally delete the source
  // via the canonical delete helpers (which clean the source's disk + DB rows) —
  // safe because the copy re-stamped notes with fresh ids, so the source id we
  // delete never matches the new target row. Finally broadcast so both source and
  // target trees/lists refresh live. Returns { createdCount } (files copied).
  ipcMain.handle('db:documents:copyToWorkspace', async (_event, params: CopyToWorkspaceParams) => {
    const result = copyItemToWorkspace(db, params)
    documents.reindexWorkspace(db, params.targetWorkspaceId)
    if (params.mode === 'move') {
      if (params.kind === 'document' && params.documentId) {
        await documents.deleteDocument(db, params.documentId)
      } else if (params.kind === 'folder' && params.folderId) {
        await documents.deleteFolder(db, params.folderId)
      }
    }
    mainWindow?.webContents.send('documents:changed')
    mainWindow?.webContents.send('folders:changed')
    return result
  })

  ipcMain.handle('db:documents:search', (_event, query: string) => {
    return documents.searchDocuments(db, query)
  })

  ipcMain.handle('db:documents:get', (_event, id: string) => {
    return documents.getDocument(db, id)
  })

  ipcMain.handle('db:documents:backlinks', (_event, id: string) => {
    return documents.getBacklinks(db, id)
  })

  ipcMain.handle('db:documents:outgoingLinks', (_event, id: string) => {
    return documents.getOutgoingLinks(db, id)
  })

  ipcMain.handle(
    'db:documents:create',
    (
      _event,
      data: { title: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ) => {
      const doc = documents.createDocument(db, data)
      mainWindow?.webContents.send('documents:changed')
      return doc
    }
  )

  // Create a standalone artifact (e.g. a `.excalidraw` canvas). Kept separate
  // from db:documents:create because artifacts carry no frontmatter/body — the
  // seed template + extension are resolved per-kind in createArtifact. Broadcasts
  // documents:changed so the tree picks up the new file.
  ipcMain.handle(
    'db:documents:createArtifact',
    (
      _event,
      data: {
        title: string
        kind: DocumentKind
        workspace_id?: string
        folder_id?: string | null
      }
    ) => {
      const doc = documents.createArtifact(db, data)
      mainWindow?.webContents.send('documents:changed')
      return doc
    }
  )

  ipcMain.handle(
    'db:documents:update',
    (
      _event,
      id: string,
      data: { title?: string; workspace_id?: string; content?: string; folder_id?: string | null }
    ) => {
      const doc = documents.updateDocument(db, id, data)
      const isContentOnly =
        data.content !== undefined &&
        data.title === undefined &&
        data.workspace_id === undefined &&
        data.folder_id === undefined
      // Content-only autosaves are NOT echoed back to the renderer: the editor
      // already holds this content, and re-broadcasting it forced a fragile
      // "is this my own echo?" guard. The vault watcher is the single source of
      // external content-change notifications (it drops the app's own writes via
      // a content-hash registry). Structural edits still refresh the sidebar.
      if (!isContentOnly) {
        mainWindow?.webContents.send('documents:changed')
      }
      return doc
    }
  )

  ipcMain.handle('db:documents:delete', async (_event, id: string) => {
    await documents.deleteDocument(db, id)
    mainWindow?.webContents.send('documents:changed')
  })

  // Raw artifact bytes by document id (read-only viewers, e.g. the CSV viewer).
  // The renderer CSP blocks `connect-src` for gt-file://, so artifact text is
  // delivered through this IPC read channel instead of a fetch. Notes are never
  // served (their bytes are the markdown editor's domain); only artifacts.
  ipcMain.handle('documents:readArtifact', async (_event, id: string): Promise<string> => {
    const doc = documents.getDocument(db, id)
    if (!doc || !doc.file_path) throw new Error(`Document not found: ${id}`)
    if (doc.kind === 'note') throw new Error(`Not an artifact: ${id}`)
    const stat = statSync(doc.file_path)
    if (stat.size > MAX_ARTIFACT_BYTES) {
      throw new Error(`Artifact too large: ${stat.size} bytes (max ${MAX_ARTIFACT_BYTES})`)
    }
    return readFile(doc.file_path, 'utf-8')
  })

  // Generic artifact write-back: persist editor-authored bytes for an EDITABLE
  // artifact (v1: the canvas). Modeled on patchHtmlText but generic — the
  // editable-spreadsheet kind will reuse this same channel.
  //
  // Notes are rejected (the markdown editor owns those). The write is ATOMIC
  // (temp file + rename) rather than a bare writeFileSync: autosave is frequent,
  // and a crash mid-write would otherwise corrupt the whole single-file scene.
  // markSelfWrite registers the exact bytes BEFORE the write so the vault watcher
  // recognizes its own save and stays silent. We deliberately do NOT broadcast
  // documents:content-changed — the writing viewer already holds the scene, so a
  // reload would be pointless (a genuine external edit still reloads via the
  // watcher).
  ipcMain.handle(
    'documents:writeArtifact',
    async (_event, id: string, contents: string): Promise<void> => {
      const doc = documents.getDocument(db, id)
      if (!doc || !doc.file_path) throw new Error(`Document not found: ${id}`)
      if (doc.kind === 'note') throw new Error(`Not an artifact: ${id}`)
      const bytes = Buffer.byteLength(contents, 'utf-8')
      if (bytes > MAX_ARTIFACT_BYTES) {
        throw new Error(`Artifact too large: ${bytes} bytes (max ${MAX_ARTIFACT_BYTES})`)
      }
      markSelfWrite(doc.file_path, contents)
      atomicWriteFile(doc.file_path, contents)
    }
  )

  // Table-schema sidecar (`<name>.csv.meta.json`) for a `csv` artifact: column
  // types/formats that the .csv text can't express. Stored beside the .csv so it
  // versions + syncs with the data. NOT a document (excluded from the index by its
  // unmapped extension), so it's addressed via its host doc id, never its own.
  // No markSelfWrite needed: the watcher never reports a non-indexed path, so
  // there's no echo to suppress; atomicWriteFile is for torn-write safety only.
  const metaPathFor = (csvPath: string): string => `${csvPath}.meta.json`

  ipcMain.handle('documents:readTableMeta', async (_event, id: string): Promise<string | null> => {
    const doc = documents.getDocument(db, id)
    if (!doc || !doc.file_path) throw new Error(`Document not found: ${id}`)
    if (doc.kind !== 'csv') throw new Error(`Not a table artifact: ${id}`)
    const metaPath = metaPathFor(doc.file_path)
    if (!existsSync(metaPath)) return null
    return readFile(metaPath, 'utf-8')
  })

  ipcMain.handle(
    'documents:writeTableMeta',
    async (_event, id: string, contents: string): Promise<void> => {
      const doc = documents.getDocument(db, id)
      if (!doc || !doc.file_path) throw new Error(`Document not found: ${id}`)
      if (doc.kind !== 'csv') throw new Error(`Not a table artifact: ${id}`)
      atomicWriteFile(metaPathFor(doc.file_path), contents)
    }
  )

  // Per-document table VIEW-STATE (column widths + sort) — local UI state stored in
  // SQLite, not on disk (so its churn never hits git/sync). Opaque JSON, keyed by
  // the host doc id; returns null when none saved.
  ipcMain.handle('documents:readViewState', (_event, id: string): string | null => {
    return documentViewState.getViewState(db, id)
  })

  ipcMain.handle('documents:writeViewState', (_event, id: string, viewState: string): void => {
    documentViewState.setViewState(db, id, viewState)
  })

  // Inline text edit-and-save for HTML artifacts. The sandboxed viewer's picker
  // bootstrap sends an edit-commit (child-index path + oldText + newHTML); we
  // re-apply it to the source .html on disk via the pure patcher. The oldText
  // guard inside patchHtmlText is the safety net against a wrong/drifted target —
  // thrown Errors propagate to the renderer, which surfaces them.
  //
  // We deliberately do NOT broadcast documents:content-changed here: the viewer's
  // live DOM already shows the edit (it was typed into a contenteditable), so a
  // reload would only flash and lose scroll. markSelfWrite registers the bytes so
  // the vault watcher recognizes its own write and stays silent too — a genuine
  // external edit (agent rewrite, another app) still reloads via the watcher.
  ipcMain.handle(
    'db:documents:patchHtmlText',
    async (
      _event,
      id: string,
      patch: { path: number[]; oldText: string; newHTML: string }
    ): Promise<void> => {
      const doc = documents.getDocument(db, id)
      if (!doc || !doc.file_path) throw new Error(`Document not found: ${id}`)
      if (doc.kind !== 'html') throw new Error(`Not an HTML artifact: ${id}`)
      const stat = statSync(doc.file_path)
      if (stat.size > MAX_ARTIFACT_BYTES) {
        throw new Error(`Artifact too large: ${stat.size} bytes (max ${MAX_ARTIFACT_BYTES})`)
      }
      const current = await readFile(doc.file_path, 'utf-8')
      const next = patchHtmlText(current, patch)
      markSelfWrite(doc.file_path, next)
      writeFileSync(doc.file_path, next, 'utf-8')
    }
  )

  // Field-merge frontmatter write (the single reserved-key chokepoint). The
  // renderer never writes whole-blob frontmatter; it sends only changed keys.
  ipcMain.handle(
    'db:documents:updateFrontmatter',
    (_event, id: string, changedKeys: Record<string, unknown>) => {
      const result = documents.updateFrontmatter(db, id, changedKeys)
      mainWindow?.webContents.send('documents:changed')
      return result
    }
  )

  // Per-workspace property type registry.
  ipcMain.handle('db:metadata:getTypes', (_event, workspaceId: string) => {
    return documents.getPropertyTypes(db, workspaceId)
  })

  ipcMain.handle(
    'db:metadata:setType',
    (_event, workspaceId: string, key: string, type: string) => {
      documents.setPropertyType(db, workspaceId, key, type as documents.PropertyTypeEntry['type'])
      mainWindow?.webContents.send('documents:changed')
    }
  )

  // Tag autocomplete for the Properties chip input — the workspace-global tag set
  // (deterministic display per fold group, §4.2).
  ipcMain.handle('db:metadata:tagSuggest', (_event, workspaceId: string, prefix?: string) => {
    return documents.tagSuggest(db, workspaceId, prefix ?? '')
  })

  // Existing property names for "+ Add property" name autocomplete.
  ipcMain.handle('db:metadata:nameSuggest', (_event, workspaceId: string, prefix?: string) => {
    return documents.propertyNameSuggest(db, workspaceId, prefix ?? '')
  })

  // Human retrieval (Phase 4): notes in the workspace whose property `key` equals
  // `valueFold` (case-insensitive, NFC-folded). Returns the same Document[] shape
  // the left-sidebar list already renders — no new view system.
  ipcMain.handle(
    'db:metadata:listByProperty',
    (_event, workspaceId: string, key: string, valueFold: string) => {
      return documents.listByProperty(db, workspaceId, key, valueFold)
    }
  )

  // Folders
  ipcMain.handle('db:folders:list', (_event, workspaceId?: string) => {
    return folders.listFolders(db, workspaceId)
  })

  ipcMain.handle('db:folders:create', (_event, data: { name: string; workspace_id?: string }) => {
    if (!data.workspace_id) throw new Error('workspace_id is required to create a folder')
    const folder = documents.createFolder(db, { name: data.name, workspace_id: data.workspace_id })
    mainWindow?.webContents.send('folders:changed')
    return folders.getFolder(db, folder.id)
  })

  ipcMain.handle(
    'db:folders:update',
    (_event, id: string, data: { name?: string; collapsed?: number }) => {
      // Renaming a folder renames its subdirectory (and moves its notes).
      const renamed = data.name !== undefined
      if (renamed) documents.renameFolder(db, id, data.name!)
      const folder = folders.updateFolder(db, id, data)
      mainWindow?.webContents.send('folders:changed')
      // Only a rename touches notes on disk. A collapse toggle must NOT broadcast
      // documents:changed — doing so flips useDocuments to loading and flashes the
      // note list's "Loading…" placeholder on every expand/collapse.
      if (renamed) mainWindow?.webContents.send('documents:changed')
      return folder
    }
  )

  ipcMain.handle('db:folders:delete', async (_event, id: string) => {
    await documents.deleteFolder(db, id)
    mainWindow?.webContents.send('folders:changed')
    mainWindow?.webContents.send('documents:changed')
  })

  // Blocks
  ipcMain.handle('db:blocks:get-tree', (_event, documentId: string) => {
    return blocks.getBlockTree(db, documentId)
  })

  ipcMain.handle('db:blocks:get', (_event, id: string) => {
    return blocks.getBlock(db, id)
  })

  ipcMain.handle(
    'db:blocks:create',
    (
      _event,
      data: {
        document_id: string
        parent_block_id?: string
        type?: string
        content?: string
        position?: number
      }
    ) => {
      return blocks.createBlock(db, data)
    }
  )

  ipcMain.handle(
    'db:blocks:update',
    (
      _event,
      id: string,
      data: { type?: string; content?: string; collapsed?: number; position?: number }
    ) => {
      return blocks.updateBlock(db, id, data)
    }
  )

  ipcMain.handle('db:blocks:delete', (_event, id: string) => {
    return blocks.deleteBlock(db, id)
  })

  ipcMain.handle(
    'db:blocks:move',
    (_event, id: string, data: { parent_block_id?: string; position: number }) => {
      return blocks.moveBlock(db, id, data)
    }
  )

  // Markdown
  ipcMain.handle('md:serialize', (_event, documentId: string) => {
    // Serialize from the document's TipTap content mirror (the file-backed source
    // of truth), not the legacy `blocks` table — vault documents never populate
    // `blocks`, so getBlockTree would yield an empty (blank) result. The title is
    // not part of the body, so prepend it as a heading for a complete export.
    const doc = documents.getDocument(db, documentId)
    if (!doc || !doc.content) return ''
    const body = tiptapToMarkdown(JSON.parse(doc.content) as TTDoc).trim()
    return doc.title ? `# ${doc.title}\n\n${body}`.trim() : body
  })

  ipcMain.handle('md:deserialize', (_event, markdown: string) => {
    return deserializeMarkdown(markdown)
  })

  // Settings
  ipcMain.handle('db:settings:get', (_event, key: string) => {
    return settings.getSetting(db, key)
  })

  ipcMain.handle('db:settings:set', (_event, key: string, value: string) => {
    settings.setSetting(db, key, value)
    mainWindow?.webContents.send('settings:changed')
    if (key === 'agentBaseDir') {
      restartThemeWatcher()
      restartVaultWatcher()
      restartSettingsWatcher()
    }
  })

  ipcMain.handle('db:settings:get-all', () => {
    return settings.getAllSettings(db)
  })

  // Open-tab state — stored as a settings row (key `openTabs:${workspaceId}`) but
  // on a DEDICATED channel that does NOT broadcast `settings:changed`. Routing it
  // through `db:settings:set` would re-trigger a full theme reload on every
  // debounced, per-keystroke tab write.
  ipcMain.handle('tabs:get', (_event, workspaceId: string) => {
    const raw = settings.getSetting(db, `openTabs:${workspaceId}`)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'tabs:set',
    (_event, workspaceId: string, state: { openDocIds: string[]; activeDocId: string | null }) => {
      settings.setSetting(db, `openTabs:${workspaceId}`, JSON.stringify(state))
    }
  )

  ipcMain.handle(
    'db:settings:test-api-key',
    async (
      _event,
      provider: string,
      apiKey: string
    ): Promise<{ success: boolean; error?: string }> => {
      if (!apiKey) return { success: false, error: 'No API key provided' }

      const endpoints: Record<string, { url: string; header: string }> = {
        anthropic: {
          url: 'https://api.anthropic.com/v1/models',
          header: 'x-api-key'
        },
        together: {
          url: 'https://api.together.xyz/v1/models?limit=1',
          header: 'Authorization'
        },
        openrouter: {
          url: 'https://openrouter.ai/api/v1/models?limit=1',
          header: 'Authorization'
        },
        zenlayer: {
          url: 'https://gateway.theturbo.ai/v1/models',
          header: 'Authorization'
        }
      }

      const config = endpoints[provider]
      if (!config) return { success: false, error: `Unknown provider: ${provider}` }

      try {
        const headers: Record<string, string> = {}
        if (config.header === 'x-api-key') {
          headers['x-api-key'] = apiKey
          headers['anthropic-version'] = '2023-06-01'
        } else {
          headers['Authorization'] = `Bearer ${apiKey}`
        }

        const res = await fetch(config.url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(10000)
        })

        if (res.ok) return { success: true }
        if (res.status === 401 || res.status === 403) {
          return { success: false, error: 'Invalid API key' }
        }
        return { success: false, error: `API returned status ${res.status}` }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { success: false, error: message }
      }
    }
  )

  // Agent logs
  ipcMain.handle(
    'db:agent-logs:list',
    (_event, filter?: { document_id?: string; status?: string }) => {
      return agentLogs.listAgentLogs(db, filter)
    }
  )

  // Conversations
  ipcMain.handle('db:conversations:list', (_event, workspaceId: string) => {
    return conversations.listConversations(db, workspaceId)
  })

  ipcMain.handle('db:conversations:get', (_event, id: string) => {
    return conversations.getConversation(db, id)
  })

  ipcMain.handle(
    'db:conversations:create',
    (_event, data: { workspace_id: string; title?: string }) => {
      const count = conversations.countConversations(db, data.workspace_id)
      if (count >= 3) throw new Error('Maximum of 3 conversations per workspace')
      const conversation = conversations.createConversation(db, data)
      mainWindow?.webContents.send('conversations:changed')
      return conversation
    }
  )

  ipcMain.handle('db:conversations:update-title', (_event, id: string, title: string) => {
    const conversation = conversations.updateConversationTitle(db, id, title)
    mainWindow?.webContents.send('conversations:changed')
    return conversation
  })

  ipcMain.handle('db:conversations:delete', async (_event, id: string) => {
    await resetSession(id)
    conversations.deleteConversation(db, id)
    mainWindow?.webContents.send('conversations:changed')
  })

  ipcMain.handle('db:conversations:count', (_event, workspaceId: string) => {
    return conversations.countConversations(db, workspaceId)
  })

  ipcMain.handle('db:conversation-messages:list', (_event, conversationId: string) => {
    return conversations.listConversationMessages(db, conversationId)
  })

  ipcMain.handle(
    'db:conversation-messages:add',
    (
      _event,
      data: {
        conversation_id: string
        role: 'user' | 'assistant'
        content: string
        thinking?: string
        tool_name?: string
        tool_args?: string
        tool_call_id?: string
        tool_result?: string
        tool_is_error?: boolean
        patch_log_id?: string
        patch_diff?: string
        patch_document_id?: string
        images?: string
        files?: string
      }
    ) => {
      return conversations.addConversationMessage(db, data)
    }
  )

  ipcMain.handle(
    'db:conversation-messages:update',
    (
      _event,
      id: string,
      data: {
        content?: string
        thinking?: string
        tool_result?: string
        tool_is_error?: boolean
      }
    ) => {
      conversations.updateConversationMessage(db, id, data)
    }
  )
}
