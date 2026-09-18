# Green Tea

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A notes app that does work for you.

[greentea.app](https://greentea.app)

<!-- ![Green Tea Screenshot](screenshot.png) -->

## About

Green Tea is a notes app built on a powerful AI coding agent framework — designed so anyone can automate knowledge work without touching a terminal. Your AI agent reads your documents, drafts your emails, and automates the busywork you keep putting off.

All data stays on your computer. Full data ownership.

## Features

- **Agentic AI** — Runs tasks in the background, builds automations, and works while you're away
- **Outliner editor** — Collapsible blocks, slash commands, and markdown support
- **Knowledge base** — The agent has full access to your notes as context
- **Skills and automation** — Extensible skill marketplace, custom skills, and scheduled tasks
- **MCP support** — Connect to external data sources without technical setup
- **Model-agnostic** — Use open-source models or add API keys from Anthropic, OpenAI, or OpenRouter
- **Privacy-first** — Local files with a SQLite index, no cloud dependency

## Prerequisites

- [Node.js](https://nodejs.org/) v20+

## Getting Started

```bash
# Install dependencies
npm install

# Start development
npm run dev
```

## Scripts

```bash
npm run dev              # Development with HMR
npm run build            # Type check + production build
npm run typecheck        # Run all type checks
npm run lint             # ESLint (cached)
npm run format           # Prettier
npm run build:mac        # macOS ARM64 distribution
npm run build:win        # Windows distribution
npm run build:linux      # Linux distribution
```

## Architecture

Green Tea uses a three-process Electron architecture:

- **Main** (`src/main/`) — App lifecycle, SQLite database, IPC handlers, AI agent, skills manager
- **Preload** (`src/preload/`) — Context bridge exposing typed IPC methods
- **Renderer** (`src/renderer/src/`) — React 19 + Tailwind CSS 4 UI with TipTap editor

Workspace documents are ordinary files: Markdown notes with YAML frontmatter, alongside
artifacts and attachments. Files are the source of truth; SQLite provides the document,
metadata, and search indexes. The vault watcher picks up changes from the agent or other
editors and broadcasts them to the UI.

The agent uses read/edit/write and filesystem search tools for local note work, with bash
for scripts and bulk operations. Notes referenced in chat are supplied as file paths.
`README.md` holds workspace context and `MEMORY.md` holds persistent agent memory.
Keep each note's frontmatter `id` unchanged when moving or renaming it; new notes should
have a fresh UUID. File edits apply directly, and the former Auto/Review toggle is removed.
Workspace checkpoints capture the on-disk state before agent turns; existing history and
editor conflict handling remain available.

App controls still use typed `window.api.*` IPC methods. Scheduling, sharing, version-history
queries, and external integrations retain their dedicated agent tools. Installing a skill
preserves its filesystem instructions without an LLM rewrite.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details on the codebase.

## License

[MIT](LICENSE)
