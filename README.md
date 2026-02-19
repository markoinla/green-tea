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
- **Privacy-first** — Local SQLite database, no cloud dependency

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

Data flows through custom hooks that call `window.api.*` IPC methods. The main process handles database operations and broadcasts change events back for reactive updates.

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details on the codebase.

## License

[MIT](LICENSE)
