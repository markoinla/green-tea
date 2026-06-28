---
id: 2adbf2a4-0777-4ee8-b28d-6b589d47f309
created: 2026-06-28T08:06:18.000Z
updated: 2026-06-28T08:06:18.000Z
---

# Excalidraw Canvas Artifact

> **v1 — user-first, editable.** A new `canvas` artifact kind (`.excalidraw`) that hosts
> [Excalidraw](https://github.com/excalidraw/excalidraw) as a full-pane viewer. Unlike the
> read-only CSV/PDF/image artifacts, the canvas is the **first editable artifact** — so it
> introduces one piece of genuinely new plumbing (a generic `documents:writeArtifact` IPC),
> while reusing the rest of the artifact stack (kind registry → path-based indexing →
> `readArtifact` load → live-reload via the vault watcher). The self-write feedback loop that
> editability would normally create is **already solved** by the existing `markSelfWrite`
> registry that notes and HTML inline-edits use.

## Overview

A canvas is a standalone artifact: its own `.excalidraw` file in the vault, opened as a full-pane
viewer like HTML/CSV — **not** an Excalidraw instance embedded inside a note (that would mean a
TipTap node-view persisting scene state into the note's JSON, a categorically larger build that
breaks the file-on-disk artifact model).

The viewer mounts the Excalidraw React component, loads the file's JSON as `initialData`, and
**autosaves** scene changes back to the same file on a debounce. Because the canvas is the first
artifact the app itself writes, it adds a generic write-back IPC; the editable-spreadsheet kind
will reuse the identical channel later.

**The agent is not a live co-editor in v1.** It can touch the `.excalidraw` file via its built-in
`bash`/`edit` tools when explicitly asked (it's plain JSON), and such an external write triggers a
live-reload in the open viewer — but the app never merges concurrent edits. The agent's
canvas-authoring is also left undocumented in the system prompt, because hand-written Excalidraw
*bindings* (arrows that stay attached, text labels inside shapes) and *layout* are unreliable;
mermaid-as-HTML remains the better path for agent-generated diagrams. The canvas's value is the
**user's** spatial/freehand thinking surface.

## Why Excalidraw (not tldraw)

The deciding factor is licensing, not capability. **Excalidraw is MIT** — free for commercial use,
no watermark, no license key. **tldraw is source-available** with a commercial watermark/license.
For a product Green Tea intends to ship and monetize, Excalidraw is the safe default. Excalidraw
`0.18.1` officially supports React 19 (`react: ^17 || ^18.2 || ^19.0.0`), so no `overrides` hack is
needed against the project's React 19.2.

---

## Decisions (resolved)

| Decision           | Choice                                                              | Why                                                                                                                |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Surface            | **Standalone artifact**, full-pane viewer                           | Matches HTML/CSV artifact model. Embedding-in-note is a much larger build and breaks file-on-disk identity.        |
| Library            | `@excalidraw/excalidraw@^0.18`                                      | MIT-licensed (tldraw is not); official React 19 support; drop-in controlled React component.                       |
| On-disk format     | single-file `.excalidraw`, **pretty-printed** JSON                  | Pretty-print so the agent can target individual `elements` with the `edit` tool instead of regex on one long line. |
| Images             | inline base64 in the `files` map (Excalidraw default)               | Keeps the canvas one self-contained file; flows through `readArtifact`/`writeArtifact` untouched.                  |
| Editability        | **editable** (autosave)                                             | First editable artifact. The whole point of a canvas.                                                              |
| Save policy        | debounced autosave (~800ms) **+ flush on unmount / hide / quit**    | `onChange` is high-frequency, not a "done" signal. Debounce for feel; flush so the tail isn't lost.                |
| Write-back         | new generic **`documents:writeArtifact(id, contents)`** IPC         | Modeled on `patchHtmlText`. Generic because the editable-spreadsheet kind needs the identical channel.             |
| Write durability   | **atomic write** (reuse `note-store` helper), **no broadcast**      | Autosave is frequent; a crash mid-`writeFileSync` would corrupt the *whole* scene. Viewer already has the bytes.   |
| Self-write loop    | reuse existing `markSelfWrite` registry                             | Already suppresses watcher echo for notes + HTML inline-edits. No new machinery.                                   |
| Load               | existing `documents:readArtifact` (`dataSource: 'read'`)            | Returns the file as utf-8 string = the JSON. No new read path.                                                     |
| External edits     | live-reload via `excalidrawAPI.updateScene()`, **deferred while interacting** | `updateScene` preserves viewport (a remount would jump). Don't yank the scene mid-stroke.                |
| Concurrent edits   | **last-writer-wins** (no merge / dirty-tracking)                    | True simultaneous user+agent edit is rare (agent edits when *asked*, not while user draws). Merge is a rabbit hole.|
| Creation           | dedicated `createArtifact` + `db:documents:createArtifact`, **not** overloaded onto note `createDocument` | Notes carry frontmatter + TipTap content; artifacts carry neither (`content = null`). Keep the paths separate. |
| Creation UI        | "New Canvas" beside "New Note"                                      | Standalone artifact ⇒ no slash-command (those make blocks *inside* a note).                                        |
| Bundle             | **lazy-load** the viewer + CSS                                      | Excalidraw is a large dep (~47MB unpacked); keep it out of the main editor bundle.                                 |
| Assets / offline   | **self-host fonts** via `EXCALIDRAW_ASSET_PATH`                     | Default fetches fonts from a CDN; a local-first desktop app must render offline. Test offline explicitly.          |
| Theme              | app theme → Excalidraw `theme` prop (**chrome only**)              | Scene/element colors are data baked into the file; never remap them on theme switch.                               |
| Sharing            | **excluded in v1**                                                  | Share path is HTML-native (`entryHtml` + assets); `.excalidraw` renders nothing in a browser without the lib.      |

---

## Changes

### 1. Register the `canvas` kind (main)

- **`src/main/vault/artifact-kinds.ts`** — add `excalidraw: 'canvas'` to `EXT_TO_KIND`.
  `isNoteKind('canvas')` is already false, so the canvas is routed as an artifact everywhere:
  `content = null`, path-based identity, rejected by all `notes_*` tools. No other indexing changes.
- **`src/main/database/types.ts`** — extend the `DocumentKind` union with `'canvas'`.

### 2. Generic artifact write-back IPC (main) — the one genuinely new piece

- **`src/main/ipc/register-db-handlers.ts`** — add `documents:writeArtifact(id, contents: string)`,
  modeled on the existing `db:documents:patchHtmlText` handler:
  - Look up the doc; reject `kind === 'note'` (notes are the markdown editor's domain) and enforce
    `MAX_ARTIFACT_BYTES`.
  - **Atomic write** (temp file + `renameSync`) reusing the crash-safe helper in
    `note-store.ts` (~line 204–214) — **not** the bare `writeFileSync` that `patchHtmlText` uses,
    because autosave is frequent and a partial write would corrupt the entire single-file scene.
  - `markSelfWrite(filePath, next)` **before** the write so the vault watcher recognises its own
    bytes and stays silent.
  - **Do not** broadcast `documents:content-changed` — the writing viewer already holds the scene;
    a broadcast would only cause a pointless reload.
- **`src/preload/index.ts`** — expose `writeArtifact` on `window.api`.
- Leave the renderer registry's `dataSource` enum (`'read' | 'gt-file'`) **unchanged**; the canvas
  viewer imports the write IPC directly. Model "editable" in the registry only when the second
  editable kind (spreadsheet) actually lands — not before.

### 3. Canvas creation (main)

- **`src/main/vault/documents-service.ts`** — add `createArtifact` (parallel to `createDocument`,
  not a branch inside it). Mirrors the indexing (`upsertRow` + `reindexDerived`) but:
  - `uniqueArtifactPath(dir, slugifyTitle(title), '.excalidraw')` for the path.
  - Writes the empty-scene template via the same atomic-write + `markSelfWrite` path as #2.
  - **No frontmatter**, `content: null`, kind derived via `kindForRow`.
- **`src/main/ipc/register-db-handlers.ts`** + **`src/preload/index.ts`** — `db:documents:createArtifact`
  handler + `window.api` method; broadcast `documents:changed` so the tree updates.
- **Empty template** (pretty-printed, valid for Excalidraw load):
  ```json
  {
    "type": "excalidraw",
    "version": 2,
    "source": "green-tea",
    "elements": [],
    "appState": { "viewBackgroundColor": "#ffffff" },
    "files": {}
  }
  ```

### 4. Canvas viewer component (renderer)

- **New: `src/renderer/src/components/editor/CanvasViewer.tsx`** — props mirror the other viewers
  (`gtFileId`, `fileName`, `watchDocId`).
  - **Lazy-load** Excalidraw: `const Excalidraw = lazy(() => import('@excalidraw/excalidraw'))`,
    wrapped in `<Suspense>`. Import `@excalidraw/excalidraw/index.css`.
  - Load: `window.api.readArtifact(gtFileId)` → `JSON.parse` → feed `elements`/`appState`/`files`
    into `initialData`. Graceful fallback to an error state on malformed JSON.
  - Capture the imperative API via the `excalidrawAPI` ref.
  - **Autosave:** on `onChange`, debounce ~800ms, then `serializeAsJSON(...)` (pretty-printed) →
    `window.api.writeArtifact(gtFileId, json)`. **Flush** the pending save on unmount and on
    `window` `pagehide`/`blur` so the tail isn't dropped.
  - **External reload:** subscribe to `window.api.onDocumentContentChanged`; when
    `data.id === watchDocId`, re-read and apply via `excalidrawAPI.updateScene(...)` (preserves
    viewport). **Defer** the reload while the user is actively interacting (pointer down / recent
    `onChange`) to avoid interrupting a stroke. Our own saves never arrive here (suppressed by
    `markSelfWrite`).
  - **Theme:** pass the app theme into the `theme` prop (chrome only); never remap scene colors.
  - **Asset path:** set `window.EXCALIDRAW_ASSET_PATH` to the locally-bundled assets so fonts render
    offline.

### 5. Register the viewer (renderer)

- **`src/renderer/src/components/artifacts/registry.tsx`** — add
  `canvas: { Viewer: CanvasArtifactViewer, icon: <PencilRuler or Shapes>, dataSource: 'read' }`,
  wrapping `CanvasViewer` the way `CsvArtifactViewer` wraps `CsvViewer` (pass `doc.id` as both
  `gtFileId` and `watchDocId`).

### 6. "New Canvas" entry point (renderer)

- **`src/renderer/src/components/layout/left-sidebar/NotesList.tsx`** and
  **`.../FolderMenuItem.tsx`** — add a "New Canvas" action beside "New Note" (second menu item or a
  split/dropdown on the New button). It calls `window.api.createArtifact(...)`, then selects the
  returned doc; `viewerForKind('canvas')` opens the canvas viewer automatically.

### 7. Build / assets

- **electron-vite config** — ensure Excalidraw's font/asset files are copied into the build and that
  `EXCALIDRAW_ASSET_PATH` resolves to them at runtime. **Verify rendering with the network
  disabled.**

### 8. Dependencies

- Add `@excalidraw/excalidraw@^0.18`.

---

## Out of scope (future)

- **Sharing / publish** — `.excalidraw` can't ride the HTML-native share path. **Fast-follow:**
  export the scene to a static **SVG** at publish time (`exportToSvg`) and wrap it as the share's
  `entryHtml` — vector, crisp, selectable text, no runtime. Note the wrinkle: `exportToSvg` needs a
  DOM (renderer-side) while the publish pipeline is main-side, so it requires a renderer-side export
  step before publish.
- **Agent as live co-editor** — a real conflict/merge model (deliberate v2).
- **Agent canvas-authoring in the system prompt** — undocumented in v1 (unreliable bindings/layout).
- **In-app export** to PNG/SVG; **embedding** a canvas inside a note.
- **Sibling-file image assets** — inline base64 only for v1.

## Risk notes

- **Offline assets** is the most likely afternoon-eater: Excalidraw fetches fonts from a CDN by
  default; self-hosting via `EXCALIDRAW_ASSET_PATH` under Vite is fiddly. Test offline explicitly.
- **Last-writer-wins:** a genuinely simultaneous user + agent edit loses one side's changes. Accepted
  for v1 — the agent edits a canvas when *asked*, which is almost never while the user is drawing.
- **Inline-image size:** the artifact cap is `MAX_ARTIFACT_BYTES = 25 MB`. A few pasted screenshots
  as base64 can approach it; if it bites, raise the cap for the `canvas` kind specifically (or move
  images to sibling files in a future iteration).
- **Bundle weight:** Excalidraw is large (~47MB unpacked). Lazy-loading keeps it out of the main
  editor chunk, but confirm the canvas chunk loads only when a canvas opens.
- **Cosmetic:** a light-background canvas viewed in dark-mode chrome shows a white scene in a dark
  pane. Correct (background is data), not a bug.
