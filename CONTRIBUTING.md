# Contributing to Green Tea

Thanks for your interest in contributing!

## Dev Setup

```bash
git clone https://github.com/markoinla/green-tea.git
cd green-tea
npm install
npm run dev
```

## Code Style

- **Prettier**: single quotes, no semicolons, 100 char width, no trailing commas
- **Path alias**: `@renderer` maps to `src/renderer/src` (renderer code only)
- **TypeScript**: composite project references — `tsconfig.node.json` (main + preload), `tsconfig.web.json` (renderer)

Run before submitting:

```bash
npm run lint
npm run typecheck
```

## Project Structure

```
src/
  main/           # Electron main process
    agent/        # AI agent sessions and tools
    database/     # SQLite repos and migrations
    ipc/          # IPC handler registration
    markdown/     # Markdown ↔ TipTap conversion
    skills/       # Skills manager and marketplace
  preload/        # Context bridge (window.api)
  renderer/src/   # React UI
    components/   # UI components (shadcn pattern)
    hooks/        # Custom hooks (data fetching via IPC)
```

## IPC Conventions

All IPC channels follow a namespace pattern: `db:documents:*`, `db:blocks:*`, `agent:*`, `skills:*`, etc. Handlers are registered in `src/main/ipc/handlers.ts`, and the preload bridge is in `src/preload/index.ts`.

## Submitting Changes

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Run `npm run lint` and `npm run typecheck`
4. Open a pull request with a clear description

## Testing

No test framework is configured yet. If you'd like to help set one up, that would be a welcome contribution!
