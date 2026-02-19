# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Green Tea

Green Tea is an Electron desktop app for intelligent knowledge management and document editing powered by Claude AI. It features an outliner-style editor (TipTap), AI agent integration with custom knowledge base tools, workspace management, and an extensible skills system.

## Commands

```bash
npm run dev              # Development with HMR
npm run build            # Type check + production build
npm run typecheck        # Both node + web type checks
npm run typecheck:node   # Main + preload only
npm run typecheck:web    # Renderer only
npm run lint             # ESLint (cached)
npm run format           # Prettier
npm run build:mac        # macOS ARM64 distribution
npm run test             # Run all unit tests (vitest)
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Tests with coverage report
npm run test:integration # Integration tests only
```

### Testing

Vitest with `better-sqlite3` rebuild (`pretest` script runs automatically). Unit tests are co-located with source files (`src/**/*.test.ts`). Integration tests live in `src/main/integration/` and use a separate config (`vitest.integration.config.ts`). Run a single test file with `npx vitest run src/main/database/repositories/documents.test.ts`.

## Architecture

**Three-process Electron architecture:**

- **Main process** (`src/main/`) — App lifecycle, SQLite database, IPC handlers, AI agent sessions, skills manager
- **Preload** (`src/preload/`) — Context bridge exposing `window.api` with typed IPC methods
- **Renderer** (`src/renderer/src/`) — React 19 UI with TipTap editor, chat sidebar, workspace management

### Data flow

Components use custom hooks (`useDocuments`, `useWorkspaces`, `useSettings`, etc.) that call `window.api.*` IPC methods. The main process handles these via `ipcMain.handle()`, performs database operations, and broadcasts change events back. Hooks subscribe to these events for reactive updates. No Redux/Zustand — state lives in hooks + IPC.

### Database

SQLite via `better-sqlite3` with WAL mode. Tables: `documents`, `blocks`, `folders`, `workspaces`, `settings` (key-value), `agent_logs`, `workspace_files`. Migrations run at startup in `src/main/database/migrations.ts`. Repositories in `src/main/database/repositories/` follow a consistent pattern: functions taking `db: Database.Database` as first argument.

### IPC namespace convention

All IPC channels follow a namespace pattern: `db:documents:*`, `db:blocks:*`, `db:settings:*`, `agent:*`, `skills:*`, `shell:*`, `md:*`. Handlers registered in `src/main/ipc/handlers.ts`, preload bridge in `src/preload/index.ts`.

### Agent system

Uses `@mariozechner/pi-coding-agent` with custom tools in `src/main/agent/tools/`. The agent reads/writes documents via notes tools (`notes_list`, `notes_get_markdown`, `notes_search`, `notes_propose_patch`, etc.) and proposes changes as markdown patches. Patches go through an approval flow (stored in `agent_logs`, approved/rejected by user in UI). Other tools: `workspace_add_file`, `web_search`, `web_fetch`, `subagent`.

API key and model are read from the `settings` table (fallback to `.env`). Skills loaded from `~/Documents/Green Tea/skills/`.

### Editor

TipTap-based outliner with custom extensions in `src/renderer/src/components/editor/extensions/`: outliner nodes, keymap, collapsible blocks, slash commands. Documents are stored as TipTap JSON but serialized to/from markdown for agent interaction (`src/main/markdown/`).

### UI layer

React 19 + Tailwind CSS 4 + Radix UI primitives. Component library in `src/renderer/src/components/ui/` (shadcn pattern). Three-pane layout: left sidebar (documents/folders), center (editor), right sidebar (chat).

## Code style

- Prettier: single quotes, no semicolons, 100 char width, no trailing commas
- Path alias: `@renderer` → `src/renderer/src` (renderer code only)
- TypeScript with composite project references: `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer)
- electron-vite builds all three processes; config in `electron.vite.config.ts`
