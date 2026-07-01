---
name: plugin-creator
description: 'Build a sandboxed artifact plugin that renders and edits a file type inside Green Tea, optionally bundling an agent skill that teaches Claude how to read/edit that file type. Use when asked to "create/build a plugin", "scaffold a viewer", "add a new artifact type/kind", "make a viewer for .<ext> files", "render/display X files in Green Tea", "add a manifest.json for an artifact", "bundle/ship a skill with a plugin", or "build a small app that saves data" (a tracker, board, checklist, or simple CRUD tool — back it with a JSON file acting as a tiny database; see "The JSON-backed data pattern"). A plugin is a manifest.json plus an entry HTML file that runs in a sandboxed iframe and renders the bytes of one file extension; it may also ship one or more bundled skills (markdown instructions + the agent''s sandboxed bash/read/edit, NOT in-process agent tools). NOT for editing note/outliner content, NOT for registering model-callable agent tools or MCP servers, NOT for anything needing app/system access — the viewer is isolated and only ever sees its own file.'
license: Complete terms in LICENSE.txt
---

# Plugin Creator

Guide for building a Green Tea **artifact plugin**: a small, sandboxed HTML viewer that
renders (and optionally edits) the bytes of a single file extension. When a file with that
extension is opened as an artifact, Green Tea loads the plugin's entry HTML inside an isolated
iframe and hands it the file contents over a tiny `postMessage` protocol.

Use this for things like "render `.json` nicely", "make a `.csv` table editor", or "show
`.mmd` Mermaid diagrams". Do **not** use it to edit note/outliner content or to build agent
tools — the viewer is sandboxed and only ever sees its own file's bytes.

A plugin can **also** ship one or more bundled agent *skills* — markdown instructions that teach
Claude how to read and edit the file type the viewer renders. That is a separate, optional
capability (see [Bundling a skill](#bundling-a-skill-optional)) and does **not** loosen the
viewer's sandbox: a bundled skill is still just instructions plus the agent's already-sandboxed
tools, never a model-callable in-process tool.

## The JSON-backed data pattern (small "apps" that save data)

When the user asks to **"build an app"** — a tracker, a board, a checklist, a simple CRUD tool, a
dashboard over their own data — what they almost always need reduces to: **structured data, a custom
UI to view/edit it, and somewhere to save it.** In Green Tea the idiomatic shape for that is a
plugin whose file **is a JSON document acting as a tiny database.** Reach for this pattern by
default for "app"-flavored requests that boil down to records the user creates, edits, and views.

How it maps onto a plugin:

- **Pick a custom extension** for the data (`.kanban`, `.tracker`, `.budget`, …) and design a JSON
  schema for it (an object with arrays of records — see the kanban example's `columns`/`tasks`).
- **The file is the database.** The viewer iframe has **no `localStorage`/IndexedDB and sees only
  its own bytes** (see [Capabilities and hard limits](#capabilities-and-hard-limits)), so *all*
  persistence flows through `gt:save` writing the JSON back to disk. There is no server and no
  external DB — the single file on disk is the entire store.
- **Two write paths, one file.** The **viewer** renders the JSON and saves edits via `gt:save`
  (`editable: true`); the **agent** reads and edits the same file with its built-in
  `read`/`edit`/`write` tools. A [bundled skill](#bundling-a-skill-optional) documenting the schema
  keeps the agent's chat-driven edits valid. The two stay in sync because they're the same file.
- **Seed it and let the user create one.** Set `creatable: true` + a `templateFile` so the user gets
  a **"New …"** menu item that starts from a valid empty document (see
  [Making a kind user-creatable](#making-a-kind-user-creatable-optional)).

Schema-design rules for data files:

- **Stable, unique ids** on every record (e.g. `task-<rand>`), never renumbered — the viewer keys on them.
- **Tolerate empty/missing bytes.** A new or `creatable` file can arrive as `""`; `render()` must not
  crash (guard `JSON.parse` with `try/catch`, default to an empty shape).
- **Preserve unknown fields** on edit — touch only what the change needs, so older/newer docs round-trip.
- **Always valid JSON.** Both write paths must keep the file parseable; the viewer should reject/ignore
  malformed input rather than overwrite good data with garbage.

When **not** to use it: anything needing multi-user sync, large datasets, cross-file queries, a real
backend/auth, or live external data is beyond a single-file plugin — say so instead of forcing it.
The kanban worked example at the end of this guide is this pattern end-to-end (JSON file + viewer +
`creatable` starter + a bundled edit skill).

## Quick start

1. Copy the known-good template into a new plugin folder. Use **absolute paths** for both the
   template source and the destination (see WHERE below) — the agent's working directory is a
   per-workspace scratch dir, so relative paths resolve to the wrong place and the `cp` fails:

   ```bash
   mkdir -p ~/Documents/Green\ Tea/.settings/plugins/my-plugin
   cp ~/Documents/Green\ Tea/.settings/skills/plugin-creator/template/manifest.json ~/Documents/Green\ Tea/.settings/plugins/my-plugin/
   cp ~/Documents/Green\ Tea/.settings/skills/plugin-creator/template/viewer.html   ~/Documents/Green\ Tea/.settings/plugins/my-plugin/
   ```

   (`.settings/` is a **hidden** folder under your Green Tea base dir — both `plugins/` and
   `skills/` live inside it. If you've relocated your Green Tea base folder, substitute it for
   `~/Documents/Green Tea` in both paths — the templates live in
   `<base>/.settings/skills/plugin-creator/template/`. If the template source isn't found, write
   the two files by hand from the manifest + viewer examples below.)

2. Edit `manifest.json` — set `id`, `name`, the `contributes.artifacts[0].kind`, the
   `extensions` your plugin claims, and `editable`. If you want the user to be able to create new
   files of this kind from inside the app, also set `creatable: true` (and optionally `newLabel`
   + `templateFile`).
3. If `creatable: true` and you set a `templateFile`, write that seed file next to `viewer.html`
   (e.g. `new.<ext>`) containing minimal valid starter content for your extension.
4. Edit `viewer.html` — replace the `render()` function with your rendering logic. Keep the
   bridge wiring (the `message` listener and the `gt:ready` post) exactly as-is.
5. Open (or refresh) an artifact whose extension your plugin claims. **No app restart needed** —
   see HOT-RELOAD below.

The template (`template/viewer.html` + `template/manifest.json`) already implements the
race-free handshake, debounced saves, and quote-to-chat. Start from it rather than writing the
bridge by hand.

## WHERE to write plugin files

Write plugins to the **absolute** path under your Green Tea base folder, inside the **hidden
`.settings/`** folder:

```
<base>/.settings/plugins/<id>/
```

`<base>` defaults to `~/Documents/Green Tea` but is configurable (the `agentBaseDir` setting), so
for the default install that's `~/Documents/Green Tea/.settings/plugins/<id>/`. The `.settings/`
folder is hidden (note the leading dot) and holds all consolidated config — `plugins/`, `skills/`,
agents, `mcp.json`, etc. If unsure, the plugins folder is the `plugins/` sibling of this
`skills/` folder (both under `.settings/`). `<id>` must match the `id` in `manifest.json`. Each
plugin is its own subfolder containing `manifest.json`, the entry HTML, and any other assets it
references (see [Multi-file viewers](#multi-file-viewers) below).

> **Always use the absolute `<base>/.settings/plugins/...` path, not a relative one.** The agent's
> working directory is a per-workspace scratch dir, so a relative path like `./plugins/...` lands
> in the wrong place and the plugin will never load. Expand `~` to the real home directory.

### Multi-file viewers

The entry HTML does **not** have to contain everything inline. Every file inside the plugin folder
is served to the sandboxed iframe over the `gt-plugin://<id>/` protocol, so your viewer can be split
across multiple local files that reference each other with **relative URLs**:

```html
<link rel="stylesheet" href="./styles.css" />
<script type="module" src="./app.js"></script>
```

Any sibling asset works — `.js` / `.mjs`, `.css`, `.json`, `.svg` / `.png` / `.jpg` / `.gif` /
`.webp`, fonts (`.woff2`, `.ttf`, …), etc. — resolved relative to the plugin folder and clamped to
it (a path escaping the folder is rejected). You can **also** pull **remote** assets over `https:`
(e.g. `https://esm.sh/...` or a CDN stylesheet) — see [Capabilities and hard limits](#capabilities-and-hard-limits).
The single-file `viewer.html` in the worked examples below is just the simplest shape, not a
requirement. Whatever you split out, keep the `gt:ready` handshake wiring in the entry HTML (or in
a module it imports) so the listener is attached before `gt:ready` is posted.

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
  "minAppVersion": "0.6.0",
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
        "shareable": false,
        "creatable": false
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
- `minAppVersion` — minimum Green Tea version, e.g. `"0.6.0"`.
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
- `creatable` — optional, defaults to `false`. Opt-in: set `true` to add a **"New &lt;label&gt;"**
  item to the root `+` menu and the folder right-click menu, so the **user** can create a fresh,
  empty file of this kind from inside Green Tea (see [Making a kind user-creatable](#making-a-kind-user-creatable-optional)).
  Leave `false` (or omit) for kinds that only ever appear when the agent or the user adds a file
  with the matching extension by hand.
- `newLabel` — optional. The label shown on the "New …" menu item when `creatable: true`, e.g.
  `"New kanban board"`. When omitted, Green Tea derives a label from the kind id (`New <kind>`).
- `templateFile` — optional, only meaningful when `creatable: true`. A filename **inside the
  plugin folder** (next to `manifest.json`) whose bytes **seed** each newly created file. When
  omitted, new files start **empty** (`""`). The path is clamped to the plugin folder — it cannot
  point outside it — and a missing/unreadable file falls back to an empty seed. **You ship this
  seed file** alongside `manifest.json` and the entry HTML. Because the seed can be absent or
  empty, your viewer must still render empty/missing bytes defensively (see below) — the template
  is a nicer starting state, not something the viewer may assume is present.

`contributes.skills` (optional) — an array of plugin-dir-relative **directory paths**, each
shipping one or more agent skills that load while the plugin is enabled. Independent of
`contributes.artifacts`: a plugin may declare either, both, or (rarely) only skills. See
[Bundling a skill](#bundling-a-skill-optional).

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

## Making a kind user-creatable (optional)

By default a plugin only renders files that already exist — the agent (or the user) creates the
file, and the plugin shows it. Set `"creatable": true` on the artifact entry to also let the
**user** create a brand-new file of this kind from inside Green Tea: a **"New &lt;label&gt;"** item
appears in both the root `+` menu and the folder right-click menu. Picking it writes a new file
(using the first of your `extensions`) and opens it in your viewer.

Three optional fields control this, all on the same `contributes.artifacts[]` entry:

- `creatable` — set `true` to show the "New …" item (defaults `false`).
- `newLabel` — the menu label, e.g. `"New kanban board"`. Omitted ⇒ derived from the kind id.
- `templateFile` — a filename **inside your plugin folder** whose bytes seed each new file. When
  omitted, new files start **empty** (`""`).

**You ship the seed file.** Put it next to `manifest.json` and the entry HTML (the same folder),
and name it in `templateFile`. The host reads it from the plugin folder only — the path is
clamped, so it cannot reach files outside the plugin — and if it is missing or unreadable the new
file simply starts empty.

> **The viewer must tolerate empty/missing bytes.** Because the seed can be absent or empty, your
> `render()` must never crash on `""` — `gt:init` already hands you `''` in that case (the
> template's `render()` already guards this with `typeof msg.bytes === 'string' ? msg.bytes : ''`
> and a `try/catch` around `JSON.parse`). The template is just a friendlier starting state, not
> something `render()` is allowed to assume exists.

The plugin/agent never creates these files behind the user's back — the "New …" item is a
deliberate **user** action, exactly like sharing. Setting `creatable: true` only makes the menu
item available.

## Bundling a skill (optional)

A plugin can ship one or more **agent skills** alongside its viewer, so that installing the plugin
also teaches Claude how to work with the file type it renders. This is the agent-side counterpart
to the viewer: the viewer renders the bytes for the **user**, while the bundled skill tells the
**agent** the file's schema and the safe ways to read and edit it (with the agent's built-in
`read`/`edit`/`write` tools — a bundled skill adds no new tool).

Opt in with a top-level `contributes.skills` array of **plugin-dir-relative directory paths**:

```json
{
  "id": "kanban-board",
  "name": "Kanban Board",
  "version": "1.0.0",
  "minAppVersion": "0.6.0",
  "description": "View and edit .kanban files as a board",
  "author": "Green Tea",
  "contributes": {
    "skills": ["skills"],
    "artifacts": [
      { "kind": "kanban-board", "extensions": ["kanban"], "entry": "viewer.html", "icon": "SquareKanban", "editable": true }
    ]
  }
}
```

Each path points at a **skill root** (a folder containing a `SKILL.md`) or a parent folder that is
recursed into for `SKILL.md` files. The conventional layout is a single `skills/` folder holding
one subfolder per skill:

```
<base>/.settings/plugins/kanban-board/
├── manifest.json
├── viewer.html
└── skills/
    └── kanban-board-edit/
        └── SKILL.md
```

A bundled `SKILL.md` is an ordinary skill file — YAML frontmatter (`name`, `description`) plus
markdown instructions:

```markdown
---
name: kanban-board-edit
description: Read and edit Kanban board files (`.kanban`, JSON). Use when the user asks to add, move, reprioritize, or tag tasks/columns on a Kanban board, or to create a new board.
---

# Editing Kanban boards (`.kanban`)

A `.kanban` file is a single JSON object … (document the schema and the safe edit operations).
```

Write the `description` so the agent knows **when** to reach for the skill (trigger phrases, the
file type). The body usually documents the file's schema and the safe editing operations, since the
agent edits the file directly. The bundled default `kanban-board` plugin is a complete worked
example — see its `skills/kanban-board-edit/SKILL.md`.

How bundled skills behave:

- **Loaded in place, tied to the plugin.** They load directly from the plugin folder — never copied
  into the user skills dir, never rewritten — and are active only while the plugin is **enabled**.
  Disabling or uninstalling the plugin removes them.
- **Namespaced, and user skills win.** A bundled skill is tracked as `plugin:<id>:<name>`, so it
  can't collide with a user skill of the same name. But if a **user** skill already has that name,
  the user's wins and the plugin's is dropped — so give bundled skills specific names
  (`kanban-board-edit`, not `edit`).
- **Same trust as any skill, NOT an agent tool.** A bundled skill is markdown instructions plus the
  agent's already-sandboxed `bash`/`read`/`edit` tools. It does **not** register a model-callable
  tool and gets no extra privileges — `contributes.skills` is not a way to give a plugin app or
  system access.
- **Paths are clamped.** Each entry must stay inside the plugin folder; a path that escapes (`..`,
  absolute) is rejected. A missing or malformed skill dir is skipped silently and never breaks the
  rest of skill loading.

Hot-reload covers skills too — add or edit a `SKILL.md` and the plugin registry rebuilds (restart
once on Linux). `contributes.skills` and `contributes.artifacts` are independent, so a plugin may
bundle a skill, a viewer, or both.

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
  You may also split the viewer across **multiple local files** in the plugin folder — `.js`,
  `.css`, images, fonts, etc. — referenced with relative URLs and served over `gt-plugin://`
  (see [Multi-file viewers](#multi-file-viewers)). What you can't do is reach **outside** the
  plugin folder or load assets over any scheme other than `https:` and `gt-plugin://`.

If a **viewer** task needs anything beyond rendering/editing a single file's bytes (reading other
notes, calling the app, talking to the system), it is **not** a plugin viewer — stop and tell the
user. (Teaching the *agent* to work across files is a different axis: that's a bundled skill, which
uses the agent's own sandboxed tools — see [Bundling a skill](#bundling-a-skill-optional) — not a
loophole in the viewer sandbox.)

## Worked example: an editable CSV table

Goal: render `.csv` files as a simple editable table that saves edits back to the file.

**1. Create the folder and manifest** at `~/Documents/Green Tea/.settings/plugins/csv-table/manifest.json`:

```json
{
  "id": "csv-table",
  "name": "CSV Table",
  "version": "1.0.0",
  "minAppVersion": "0.6.0",
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

## Worked example: a shareable, creatable kanban board

Goal: render a `.kanban` JSON file (`{ "columns": [{ "title", "cards": ["…"] }] }`) as a board,
let the **user** create a fresh board from a starter template, and let the **user** publish a
frozen, read-only snapshot of it.

**1. Manifest** at `~/Documents/Green Tea/.settings/plugins/kanban/manifest.json` — note `shareable: true`
and `creatable: true` with a `templateFile` that seeds new boards:

```json
{
  "id": "kanban",
  "name": "Kanban Board",
  "version": "1.0.0",
  "minAppVersion": "0.6.0",
  "description": "View a kanban board, create one from a starter, and publish a read-only snapshot",
  "author": "Green Tea",
  "contributes": {
    "artifacts": [
      {
        "kind": "kanban",
        "extensions": ["kanban"],
        "entry": "viewer.html",
        "icon": "SquareKanban",
        "editable": false,
        "shareable": true,
        "creatable": true,
        "newLabel": "New kanban board",
        "templateFile": "new.kanban"
      }
    ]
  }
}
```

**2. Starter template** at `~/Documents/Green Tea/.settings/plugins/kanban/new.kanban` — this file ships
**alongside** `manifest.json` and `viewer.html` in the plugin folder; its bytes seed every board
the user creates from the "New kanban board" menu item:

```json
{ "columns": [{ "title": "To Do", "cards": [] }, { "title": "Doing", "cards": [] }, { "title": "Done", "cards": [] }] }
```

**3. `viewer.html`** — render the board, and add a `gt:render-static` branch that emits the
columns/cards as a self-contained, read-only HTML string. The same `boardHtml()` builder feeds
both the live view and the snapshot, so the snapshot matches what the user sees. Note that
`render()` tolerates empty bytes (`board = { columns: [] }`), so a board created with no
`templateFile` would still render — the starter just gives the user three columns to begin with:

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

**4.** Open a `.kanban` file. Because the manifest declares `creatable: true`, the user now also
gets a **"New kanban board"** item in the root `+` menu and folder right-click menu; picking it
writes a new `.kanban` file seeded from `new.kanban` and opens it in the viewer. And because the
manifest declares `shareable: true`, the user gets a publish action in the share control; clicking
it triggers `gt:render-static`, your viewer replies with the inlined board HTML, and Green Tea
publishes that frozen snapshot. The agent never creates or publishes on its own — both are the
user's actions; the plugin only ships the starter and provides the snapshot when asked.

## Checklist before finishing

- [ ] Files are under `~/Documents/Green Tea/.settings/plugins/<id>/` (absolute path), folder name = `id`.
- [ ] `id` has no whitespace and does not contain `plugin:`.
- [ ] `extensions` are lowercase, without the leading dot.
- [ ] `icon` is a valid lucide-react PascalCase name.
- [ ] `window.addEventListener('message', ...)` is attached BEFORE `gt:ready` is posted.
- [ ] Saves are debounced (~500ms) and only sent when `editable: true`.
- [ ] If `shareable: true`, a `gt:render-static` branch replies with `{ type: 'gt:static', html }`
      that is self-contained and read-only (inlined CSS/data, no host, no `gt:save`).
- [ ] If the kind should be user-creatable, `creatable: true` is set and (if a `templateFile` is
      named) that seed file exists in the plugin folder with valid starter content for the
      claimed extension — and `render()` still tolerates empty/missing bytes without crashing.
- [ ] If the plugin bundles a skill, `contributes.skills` lists its folder(s) (each path inside the
      plugin dir), every listed folder holds a `SKILL.md` with `name` + a trigger-friendly
      `description`, and the skill name is specific enough not to collide with a user skill.
- [ ] No attempt to access other notes, settings, storage, or any app/system API, and no attempt
      to self-publish (publishing is always the user's action).
