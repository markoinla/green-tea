---
name: plugin-creator
description: 'Build a sandboxed artifact plugin that renders and edits a file type inside Green Tea. Use when asked to "create/build a plugin", "scaffold a viewer", "add a new artifact type/kind", "make a viewer for .<ext> files", "render/display X files in Green Tea", or "add a manifest.json for an artifact". A plugin is a manifest.json plus an entry HTML file that runs in a sandboxed iframe and renders the bytes of one file extension. NOT for editing note/outliner content, NOT for building agent tools, MCP servers, or anything needing app/system access — plugins are isolated and only ever see their own file.'
license: Complete terms in LICENSE.txt
---

# Plugin Creator

Guide for building a Green Tea **artifact plugin**: a small, sandboxed HTML viewer that
renders (and optionally edits) the bytes of a single file extension. When a file with that
extension is opened as an artifact, Green Tea loads the plugin's entry HTML inside an isolated
iframe and hands it the file contents over a tiny `postMessage` protocol.

Use this for things like "render `.json` nicely", "make a `.csv` table editor", or "show
`.mmd` Mermaid diagrams". Do **not** use it to edit note/outliner content or to build agent
tools — a plugin is sandboxed and only ever sees its own file's bytes.

## Quick start

1. Copy the known-good template into a new plugin folder. Use **absolute paths** for both the
   template source and the destination (see WHERE below) — the agent's working directory is a
   per-workspace scratch dir, so relative paths resolve to the wrong place and the `cp` fails:

   ```bash
   mkdir -p ~/Documents/Green\ Tea/plugins/my-plugin
   cp ~/Documents/Green\ Tea/skills/plugin-creator/template/manifest.json ~/Documents/Green\ Tea/plugins/my-plugin/
   cp ~/Documents/Green\ Tea/skills/plugin-creator/template/viewer.html   ~/Documents/Green\ Tea/plugins/my-plugin/
   ```

   (If you've relocated your Green Tea base folder, substitute it for `~/Documents/Green Tea` in
   both paths — the templates live in `<base>/skills/plugin-creator/template/`. If the template
   source isn't found, write the two files by hand from the manifest + viewer examples below.)

2. Edit `manifest.json` — set `id`, `name`, the `contributes.artifacts[0].kind`, the
   `extensions` your plugin claims, and `editable`.
3. Edit `viewer.html` — replace the `render()` function with your rendering logic. Keep the
   bridge wiring (the `message` listener and the `gt:ready` post) exactly as-is.
4. Open (or refresh) an artifact whose extension your plugin claims. **No app restart needed** —
   see HOT-RELOAD below.

The template (`template/viewer.html` + `template/manifest.json`) already implements the
race-free handshake, debounced saves, and quote-to-chat. Start from it rather than writing the
bridge by hand.

## WHERE to write plugin files

Write plugins to the **absolute** path under your Green Tea base folder:

```
<base>/plugins/<id>/
```

`<base>` defaults to `~/Documents/Green Tea` but is configurable (the `agentBaseDir` setting), so
for the default install that's `~/Documents/Green Tea/plugins/<id>/`. If unsure, the plugins
folder is the `plugins/` sibling of this `skills/` folder. `<id>` must match the `id` in
`manifest.json`. Each plugin is its own subfolder containing at least `manifest.json` and the
entry HTML.

> **Always use the absolute `<base>/plugins/...` path, not a relative one.** The agent's working
> directory is a per-workspace scratch dir, so a relative path like `./plugins/...` lands in the
> wrong place and the plugin will never load. Expand `~` to the real home directory.

### HOT-RELOAD

On **macOS and Windows**, plugins hot-reload automatically: a file watcher on the plugins
directory rebuilds the plugin registry whenever files there change, so as soon as you finish
writing `manifest.json` + `viewer.html`, just **open the artifact (or refresh/reopen an
already-open one)** whose extension the plugin claims — **no app restart, rebuild, or install
step**. If a change does not appear, re-open the artifact tab. (On Linux the watcher is disabled,
so **restart the app** once after creating or changing a plugin.)

## manifest.json

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "minAppVersion": "6.2.0",
  "description": "Render and edit my file type",
  "author": "Green Tea",
  "contributes": {
    "artifacts": [
      {
        "kind": "my-plugin",
        "extensions": ["ext"],
        "entry": "viewer.html",
        "icon": "FileText",
        "editable": true,
        "shareable": false
      }
    ]
  }
}
```

Top-level fields:

- `id` — unique identifier. **No whitespace**, and it **must not contain the substring
  `plugin:`** (that prefix is reserved by the host for namespacing). Match the folder name.
- `name` — human-readable display name.
- `version` — semver string, e.g. `"1.0.0"`.
- `minAppVersion` — minimum Green Tea version, e.g. `"6.2.0"`.
- `description` — one line on what the plugin renders.

Each entry in `contributes.artifacts[]`:

- `kind` — internal artifact kind id for this viewer (unique within the plugin).
- `extensions` — array of file extensions this viewer claims, **without the dot**, e.g.
  `["csv"]` or `["mmd", "mermaid"]`.
- `entry` — the HTML file to load in the iframe, e.g. `"viewer.html"`.
- `icon` — the file-tree and viewer-toolbar icon: an **exact** [lucide](https://lucide.dev/icons)
  icon name in **PascalCase**. An unknown or misspelled name (e.g. `"kanban"`, `"json"`) silently
  falls back to the generic puzzle icon and logs a console warning — match a real name's
  capitalization exactly. You can't browse the icon set while authoring, so pick from these
  verified names (all exist in the bundled lucide version):

  | Artifact kind            | Use `icon`                                          |
  | ------------------------ | --------------------------------------------------- |
  | Kanban / board / tasks   | `"SquareKanban"`, `"Kanban"`, `"Trello"`, `"ListTodo"` |
  | Table / spreadsheet      | `"Table"`, `"Sheet"`, `"FileSpreadsheet"`           |
  | JSON / structured data   | `"FileJson"`, `"Braces"`, `"Database"`              |
  | Diagram / graph / flow   | `"GitBranch"`, `"Network"`, `"Workflow"`            |
  | Chart / metrics          | `"ChartColumn"`, `"ChartLine"`                      |
  | Calendar / time          | `"Calendar"`, `"CalendarDays"`, `"Clock"`           |
  | Map / location           | `"Map"`, `"MapPin"`                                 |
  | Image / media            | `"Image"`                                           |
  | Code / generic text      | `"FileCode"`, `"FileText"`                          |

  When none fit, browse https://lucide.dev/icons and copy a name **verbatim** (PascalCase). The
  icon updates live on hot-reload — reopen the artifact to see it.
- `editable` — `true` if the viewer can save changes back to the file, `false` for read-only.
- `shareable` — optional, defaults to `false`. Opt-in: set `true` to let the **user** publish a
  public, frozen, read-only snapshot of this artifact (see [Sharing](#sharing-optional)). Leave
  `false` (or omit) for artifacts that should never be shared.

## Bridge protocol

The host and the sandboxed iframe talk over `window.postMessage`. The iframe posts to
`window.parent`; the host posts back to the iframe's `window`. `bytes` is always a **UTF-8
string** of the file contents (not a `Uint8Array`).

| Direction      | Message                                       | When                                                 |
| -------------- | --------------------------------------------- | ---------------------------------------------------- |
| frame → host   | `{ type: 'gt:ready' }`                         | Once, AFTER the `message` listener is attached       |
| host → frame   | `{ type: 'gt:init', bytes, fileName, editable }` | Host's reply to `gt:ready`; carries the file        |
| frame → host   | `{ type: 'gt:save', bytes }`                    | Editable plugins, when content changes (debounce ~500ms) |
| frame → host   | `{ type: 'gt:quote', text }`                   | Send the current selection to chat                   |
| host → frame   | `{ type: 'gt:render-static' }`                 | Shareable plugins, when the user publishes a snapshot |
| frame → host   | `{ type: 'gt:static', html }`                  | Reply to `gt:render-static`; a self-contained read-only HTML snapshot |

### The gt:ready handshake (get this right)

The single most important rule:

> **Post `gt:ready` only AFTER `window.addEventListener('message', ...)` is wired up.**

The host sends `gt:init` _in response to_ `gt:ready`. If you announce readiness before the
listener exists, the very first `gt:init` can arrive with no listener attached, get dropped, and
the view stays **blank** forever. The correct order, as in the template:

```js
// 1) Listener first.
window.addEventListener('message', (event) => {
  const msg = event.data
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'gt:init') {
    editable = Boolean(msg.editable)
    const source = typeof msg.bytes === 'string' ? msg.bytes : ''
    render(source)
  }
})

// 2) Ready last.
window.parent.postMessage({ type: 'gt:ready' }, '*')
```

### Saving (editable plugins)

When the user edits content, post `{ type: 'gt:save', bytes }` with the full new file contents.
**Debounce** so you save at most once every ~500ms instead of on every keystroke:

```js
let saveTimer = null
function scheduleSave(source) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => window.parent.postMessage({ type: 'gt:save', bytes: source }, '*'), 500)
}
```

### Quote-to-chat

Post `{ type: 'gt:quote', text }` to push the current text selection into the chat sidebar —
useful for "ask about this row/section":

```js
document.addEventListener('selectionchange', () => {
  const text = (window.getSelection()?.toString() || '').trim()
  if (text) window.parent.postMessage({ type: 'gt:quote', text }, '*')
})
```

## Sharing (optional)

A shareable plugin lets the **user** publish a public, frozen, **read-only** snapshot of an
artifact to the web. Opt in by setting `"shareable": true` on the artifact's `contributes`
entry (it defaults to `false`). This is opt-in per artifact kind — only declare it for kinds
whose rendered state is safe to make public.

**The plugin/agent never publishes.** Sharing is always a deliberate **user** action: the user
clicks publish in Green Tea's share control. Setting `shareable: true` only makes that button
available for the kind — your viewer cannot trigger a publish, and there is no host API to do so.
The app also re-checks `shareable` in the main process at publish time, so the flag is the single
source of truth for whether a kind may ever be shared.

When the user publishes, the host asks your viewer for a snapshot over the bridge:

| Direction    | Message                          | Meaning                                              |
| ------------ | -------------------------------- | ---------------------------------------------------- |
| host → frame | `{ type: 'gt:render-static' }`   | Please produce a frozen snapshot of the current state |
| frame → host | `{ type: 'gt:static', html }`    | A self-contained, read-only HTML snapshot string      |

Your `gt:render-static` handler must reply with `{ type: 'gt:static', html }` where `html` is a
**self-contained, read-only** rendering of the *current* state:

- **Inline everything.** Embed the CSS and the data directly in the HTML string — the snapshot
  runs standalone with no host and no `gt:init`. External `https:` assets are allowed, but prefer
  fully inline so the snapshot never breaks.
- **No host bridge, no `gt:save`.** The snapshot is detached from Green Tea: it must not call
  `postMessage`, must not try to save or persist anything, and must not depend on the parent.
- **Read-only.** Render the data for viewing only — no editable fields, no edit affordances.
  Artifact snapshots **may** contain `<script>`, so client-side interactivity (sorting, tabs,
  filtering, expanding) is fine, but nothing that edits or persists state.
- The snapshot is **frozen at publish time** — it captures the state at the moment the user
  published and does not update afterward.

Keep your existing `gt:ready`/`gt:init`/`gt:save` handling intact; just add a branch for
`gt:render-static` in the same `message` listener (see the template's `renderStatic()`).

## Capabilities and hard limits

A plugin gets these capabilities, and nothing else:

1. **Its own file's bytes** via `gt:init`.
2. The ability to **save those bytes** via `gt:save` (only if `editable: true`).
3. **Quote-to-chat** via `gt:quote`.
4. Automatic **live-reload** when the plugin files change.
5. A **read-only snapshot** for user-initiated sharing via `gt:render-static` → `gt:static`
   (only if `shareable: true`). The plugin can never publish on its own.

Hard limits — do not attempt to work around these, they are the security boundary:

- **No access to other notes, files, settings, or any app API.** The plugin never sees anything
  but its own file. There is no host API to call.
- The iframe runs at an **opaque origin** with `sandbox="allow-scripts"`. There is **no
  same-origin access and no persistent storage** (`localStorage`, cookies, IndexedDB are
  unavailable / useless).
- **Inline scripts and styles are allowed**, and **`https:` scripts are allowed**, so you MAY
  import libraries from a CDN (e.g. `https://esm.sh/...` or `https://cdn.jsdelivr.net/...`).
  Keep everything else self-contained in the entry HTML.

If a task needs anything beyond rendering/editing a single file's bytes (reading other notes,
calling the app, talking to the system), it is **not** a plugin — stop and tell the user.

## Worked example: an editable CSV table

Goal: render `.csv` files as a simple editable table that saves edits back to the file.

**1. Create the folder and manifest** at `~/Documents/Green Tea/plugins/csv-table/manifest.json`:

```json
{
  "id": "csv-table",
  "name": "CSV Table",
  "version": "1.0.0",
  "minAppVersion": "6.2.0",
  "description": "View and edit CSV files as a table",
  "author": "Green Tea",
  "contributes": {
    "artifacts": [
      { "kind": "csv-table", "extensions": ["csv"], "entry": "viewer.html", "icon": "Table", "editable": true }
    ]
  }
}
```

**2. Create `viewer.html`** in the same folder. It loads the bytes, renders an editable grid,
and debounce-saves serialized CSV. Note the handshake order: listener first, `gt:ready` last.

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      table { border-collapse: collapse; font: 13px ui-sans-serif, system-ui; }
      td { border: 1px solid #e5e7eb; padding: 2px 6px; }
      td[contenteditable] { min-width: 60px; }
    </style>
  </head>
  <body>
    <table id="grid"></table>
    <script type="module">
      const grid = document.getElementById('grid')
      let editable = false
      const post = (m) => window.parent.postMessage(m, '*')

      // Tiny CSV parse/serialize (no quoting edge-cases, for illustration).
      const parse = (s) => s.split(/\r?\n/).filter(Boolean).map((r) => r.split(','))
      const serialize = (rows) => rows.map((r) => r.join(',')).join('\n')

      let saveTimer = null
      function scheduleSave() {
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => {
          const rows = [...grid.rows].map((tr) => [...tr.cells].map((td) => td.textContent))
          post({ type: 'gt:save', bytes: serialize(rows) })
        }, 500)
      }

      function render(source) {
        grid.replaceChildren()
        for (const row of parse(source)) {
          const tr = grid.insertRow()
          for (const cell of row) {
            const td = tr.insertCell()
            td.textContent = cell
            if (editable) {
              td.contentEditable = 'true'
              td.addEventListener('input', scheduleSave)
            }
          }
        }
      }

      window.addEventListener('message', (event) => {
        const msg = event.data
        if (msg?.type === 'gt:init') {
          editable = Boolean(msg.editable)
          render(typeof msg.bytes === 'string' ? msg.bytes : '')
        }
      })

      post({ type: 'gt:ready' })
    </script>
  </body>
</html>
```

**3. Open a `.csv` file as an artifact.** The watcher has already registered the plugin; the
table renders, edits save back to disk after ~500ms. Done — no restart.

## Worked example: a shareable kanban board

Goal: render a `.kanban` JSON file (`{ "columns": [{ "title", "cards": ["…"] }] }`) as a board
and let the **user** publish a frozen, read-only snapshot of it.

**1. Manifest** at `~/Documents/Green Tea/plugins/kanban/manifest.json` — note `shareable: true`:

```json
{
  "id": "kanban",
  "name": "Kanban Board",
  "version": "1.0.0",
  "minAppVersion": "6.2.0",
  "description": "View a kanban board and publish a read-only snapshot",
  "author": "Green Tea",
  "contributes": {
    "artifacts": [
      { "kind": "kanban", "extensions": ["kanban"], "entry": "viewer.html", "icon": "SquareKanban", "editable": false, "shareable": true }
    ]
  }
}
```

**2. `viewer.html`** — render the board, and add a `gt:render-static` branch that emits the
columns/cards as a self-contained, read-only HTML string. The same `boardHtml()` builder feeds
both the live view and the snapshot, so the snapshot matches what the user sees:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; font: 14px ui-sans-serif, system-ui; color: #1f2937; }
      .board { display: flex; gap: 12px; padding: 16px; align-items: flex-start; }
      .col { background: #f3f4f6; border-radius: 8px; padding: 8px; min-width: 180px; }
      .col h3 { margin: 4px 6px 8px; font-size: 13px; }
      .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 8px; margin: 6px 0; }
    </style>
  </head>
  <body>
    <div id="view"></div>
    <script type="module">
      const viewEl = document.getElementById('view')
      const post = (m) => window.parent.postMessage(m, '*')
      let board = { columns: [] }

      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

      // Pure builder: turns the board data into HTML. Reused for the live view AND the snapshot.
      function boardHtml(data) {
        const cols = (data.columns || []).map((col) => {
          const cards = (col.cards || []).map((c) => `<div class="card">${esc(c)}</div>`).join('')
          return `<div class="col"><h3>${esc(col.title || '')}</h3>${cards}</div>`
        }).join('')
        return `<div class="board">${cols}</div>`
      }

      function render(source) {
        try { board = JSON.parse(source) } catch { board = { columns: [] } }
        viewEl.innerHTML = boardHtml(board)
      }

      // Self-contained, read-only snapshot: inline CSS + current board, no host, no gt:save.
      function renderStatic() {
        return [
          '<!doctype html><html><head><meta charset="utf-8" /><style>',
          'body{margin:0;font:14px ui-sans-serif,system-ui;color:#1f2937}',
          '.board{display:flex;gap:12px;padding:16px;align-items:flex-start}',
          '.col{background:#f3f4f6;border-radius:8px;padding:8px;min-width:180px}',
          '.col h3{margin:4px 6px 8px;font-size:13px}',
          '.card{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:6px 8px;margin:6px 0}',
          '</style></head><body>', boardHtml(board), '</body></html>'
        ].join('')
      }

      window.addEventListener('message', (event) => {
        const msg = event.data
        if (!msg || typeof msg !== 'object') return
        if (msg.type === 'gt:init') {
          render(typeof msg.bytes === 'string' ? msg.bytes : '')
        } else if (msg.type === 'gt:render-static') {
          post({ type: 'gt:static', html: renderStatic() })
        }
      })

      post({ type: 'gt:ready' })
    </script>
  </body>
</html>
```

**3.** Open a `.kanban` file. Because the manifest declares `shareable: true`, the user gets a
publish action in the share control; clicking it triggers `gt:render-static`, your viewer replies
with the inlined board HTML, and Green Tea publishes that frozen snapshot. The agent never
publishes — it only provides the snapshot when asked.

## Checklist before finishing

- [ ] Files are under `~/Documents/Green Tea/plugins/<id>/` (absolute path), folder name = `id`.
- [ ] `id` has no whitespace and does not contain `plugin:`.
- [ ] `extensions` are lowercase, without the leading dot.
- [ ] `icon` is a valid lucide-react PascalCase name.
- [ ] `window.addEventListener('message', ...)` is attached BEFORE `gt:ready` is posted.
- [ ] Saves are debounced (~500ms) and only sent when `editable: true`.
- [ ] If `shareable: true`, a `gt:render-static` branch replies with `{ type: 'gt:static', html }`
      that is self-contained and read-only (inlined CSS/data, no host, no `gt:save`).
- [ ] No attempt to access other notes, settings, storage, or any app/system API, and no attempt
      to self-publish (publishing is always the user's action).
