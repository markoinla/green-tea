---
name: kanban-board-edit
description: Read and edit Kanban board files (`.kanban`, JSON). Use when the user asks to add, move, reprioritize, tag, or summarize tasks/columns on a Kanban board, or to create a new board.
---

# Editing Kanban boards (`.kanban`)

A `.kanban` file is a single JSON object describing a board. It is a normal file on
disk — read it with the `read` tool and modify it with `edit` (or rewrite it with
`write`). Always keep it **valid JSON**; the viewer normalizes missing fields but
will reject malformed JSON.

## Schema

```jsonc
{
  "title": "My Board",
  "columns": [
    { "id": "col-todo", "name": "To Do", "color": "#3b82f6" }
  ],
  "tasks": [
    {
      "id": "task-abc123",          // unique within the board
      "title": "Ship the thing",
      "description": "Optional longer text",
      "columnId": "col-todo",        // MUST match an existing column id
      "priority": "medium",          // one of: low | medium | high | urgent
      "tags": ["backend"],
      "dueDate": "2026-07-15",       // ISO date string, or "" for none
      "createdAt": "2026-06-29"      // ISO date string
    }
  ]
}
```

Column `color` is a hex string; the palette is
`#94a3b8 #3b82f6 #22c55e #f59e0b #ec4899 #8b5cf6 #06b6d4 #ef4444`.

## Rules

- **`columnId` is a foreign key.** Every task's `columnId` must equal an existing
  column's `id`. To "move" a task between columns, change its `columnId` — never
  reorder by anything else.
- **Ids are stable and unique.** When adding a task or column, generate a new id
  (e.g. `task-` / `col-` plus a short random suffix). Never reuse or renumber
  existing ids — the viewer keys on them.
- **`priority`** must be exactly one of `low`, `medium`, `high`, `urgent`.
- **Preserve unknown fields** if you encounter any; only touch what the request needs.
- Prefer a **minimal `edit`** (change one task's `columnId`, append one task to the
  `tasks` array) over rewriting the whole file, to keep diffs reviewable.

## Common operations

- **Add a task:** append an object to `tasks` with a fresh `id`, a valid `columnId`,
  and sensible defaults (`priority: "medium"`, `tags: []`, `createdAt` = today).
- **Move a task:** set its `columnId` to the target column's id.
- **Reprioritize / tag:** edit the task's `priority` / `tags`.
- **Add a column:** append `{ id, name, color }` to `columns` with a fresh id and a
  palette color; existing tasks keep their `columnId`.
- **New board from scratch:** start from the schema above with an empty `tasks` array
  and a few starter columns (To Do / In Progress / Done).
