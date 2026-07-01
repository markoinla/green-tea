---
id: d4661041-1bbe-4577-a88b-6212e4eb2390
created: 2026-07-01T20:09:48.030Z
updated: 2026-07-01T20:32:34.490Z
---

Green Tea is the **open source AI workspace** for people who want AI that actually does things without giving up control of their data.

It gives you a local-first workspace for notes, files, research, generated artifacts, and autonomous agents. Your work stays in plain files on your machine. The AI works with the full context of your workspace. And because Green Tea is open and extensible, you can inspect it, customize it, and teach it new tricks.

## Table of contents

- [Start here](#start-here)
  - [Getting started](#getting-started)
  - [The big idea](#the-big-idea)
- [Understand your workspace](#understand-your-workspace)
  - [Your workspace is a folder](#your-workspace-is-a-folder)
  - [Organizing your work](#organizing-your-work)
  - [Finding things](#finding-things)
- [Work with notes and artifacts](#work-with-notes-and-artifacts)
  - [Writing notes](#writing-notes)
  - [Linking ideas](#linking-ideas)
  - [Default artifact types](#default-artifact-types)
- [Use the AI agent](#use-the-ai-agent)
  - [How to work with the agent](#how-to-work-with-the-agent)
  - [What the agent can do](#what-the-agent-can-do)
- [Automate and extend Green Tea](#automate-and-extend-green-tea)
  - [Scheduled agents](#scheduled-agents)
  - [Memory that carries over](#memory-that-carries-over)
  - [Skills](#skills)
  - [Plugins](#plugins)
- [Control, sharing, and customization](#control-sharing-and-customization)
  - [Open source, provider login, and self-hosting](#open-source-provider-login-and-self-hosting)
  - [Sharing and publishing](#sharing-and-publishing)
  - [Make it yours](#make-it-yours)
- [Try it](#try-it)

## Start here

### Getting started

1. **Choose an AI model** — use Green Tea's built-in model to get started quickly, or log in with your **Anthropic** or **OpenAI** account to use your existing plan inside Green Tea.
2. **Write a note** — use this workspace like a normal outliner for ideas, drafts, meeting notes, specs, or research.
3. **Ask the agent for help** — open the chat sidebar and mention a note with `@` when you want the agent to use it as context.
4. **Create an artifact** — ask Green Tea to make a table, HTML report, dashboard, canvas diagram, checklist, or slide-style page.
5. **Try automation** — ask the agent to run a recurring task, like a weekly research digest or workspace summary.
6. **Make it yours** — enable skills, connect providers, customize the theme, and organize the workspace around your own projects.

### The big idea

Most tools make you choose:

- A notes app that owns your knowledge, but has weak or fragmented AI
- An AI chat tool that is powerful, but forgets your context every session
- A SaaS workspace that is convenient, but locks your data and workflows into someone else's cloud

Green Tea is the intersection: **open source + local-first + AI-native**.

Use it as a writing and thinking space, but also as a place where agents can research, organize, generate, update, and publish work for you. The goal is not “AI sprinkled on notes.” The goal is a workspace where AI has context, tools, memory, and permission to help you get real work done.

## Understand your workspace

### Your workspace is a folder

A Green Tea workspace is just a folder on disk. Notes are Markdown. Tables are CSV. Artifacts are ordinary files. You can open them in Green Tea, Finder, Git, Obsidian, VS Code, or any other tool that understands plain files.

- **Local-first by default** — your workspace lives on your machine.
- **Portable formats** — Markdown notes, CSV tables, images, PDFs, HTML, and other file-based artifacts.
- **No lock-in** — if Green Tea disappeared tomorrow, your files would still be yours.
- **Version history** — workspaces are automatically version-controlled with Git, so you can restore earlier versions.

### Organizing your work

- **Workspaces** are top-level folders on disk. Switch or create them from the top of the left sidebar.
- **Folders** organize notes and artifacts inside a workspace.
- **`README.md`** stores stable workspace context.
- **`MEMORY.md`** stores the agent's running memory.

### Finding things

- **Cmd/Ctrl-K** — command palette: jump to any note across every workspace.
- **Cmd/Ctrl-F** — find and replace within the current note.

## Work with notes and artifacts

### Writing notes

Notes are **outlines**. Every line is a block you can nest, fold, and rearrange.

- Press **Enter** for a new block, **Tab** to indent, **Shift-Tab** to outdent.
- Move a block with **Cmd/Ctrl-Shift-↑** and **Cmd/Ctrl-Shift-↓**.
- Type **`/`** at the start of a block to insert text, headings, task lists, blockquotes, code blocks, tables, and images.
- Use inline formatting like **bold** (`Cmd/Ctrl-B`), *italic* (`Cmd/Ctrl-I`), `inline code`, highlight, and links.

Task lists are just blocks with checkboxes:

- [ ] Read this welcome note
- [ ] Ask the agent to draft or reorganize something
- [ ] Create your first artifact
- [ ] Make this workspace your own

### Linking ideas

Type **`[[`** to link to another note by title. Links show up in reverse on the target note as **backlinks**, so you can see everything that points at a topic. Links are stored as plain [[Title]] text on disk, so they stay portable and Obsidian-compatible.

### Default artifact types

Green Tea is a workspace for knowledge work, not just a note editor. It can store and render **artifacts** beside your notes:

| Type                 | File format                             | What it is good for                                                                                               |
| -------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Notes**            | `.md`                                   | Outlines, writing, linked knowledge, project context, meeting notes, specs, and drafts.                           |
| **Tables**           | `.csv`                                  | Editable grids for lists, research matrices, trackers, inventories, and structured data.                          |
| **HTML artifacts**   | `.html`                                 | Polished reports, dashboards, briefings, slide-style pages, and interactive documents generated by the agent.     |
| **Canvas diagrams**  | `.excalidraw`                           | Flowcharts, mind maps, system diagrams, relationship maps, and visual planning.                                   |
| **Images**           | `.png`, `.jpg`, `.gif`, `.webp`, `.svg` | Screenshots, diagrams, reference images, exports, and visual assets.                                              |
| **PDFs**             | `.pdf`                                  | Reports, papers, contracts, scans, and other read-only reference documents.                                       |
| **Office documents** | `.docx`, `.xlsx`, `.pptx`               | Word documents, spreadsheets, and presentations the agent can read, create, or transform with skills.             |
| **Plugin artifacts** | Varies                                  | Custom document types added by plugins, like kanban boards, Mermaid diagrams, todo lists, or your own file types. |

This means the AI can help you move from **research → notes → artifact → published link** without leaving the workspace.

## Use the AI agent

### How to work with the agent

Open the **chat sidebar** and talk to the agent. It can work across your workspace, not just the current note.

A few things worth knowing:

- **Mention notes with `@`** to pull them into context.
- Attach files or images when you want the agent to inspect or transform them.
- The agent can read and search your notes, query by tag or property, create notes and folders, generate artifacts, and reorganize your workspace.
- It can search the web, read pages, write code, run tools, and create new capabilities for itself.
- In **Review** mode, edits are proposed as a diff you can accept or reject. In **Auto** mode, approved operations can happen immediately.

### What the agent can do

Try asking Green Tea to:

- Summarize, rewrite, or restructure a messy note
- Research a topic and draft a briefing
- Turn a braindump into an organized outline, table, or checklist
- Generate an HTML report, dashboard, slide deck, or canvas diagram
- Create a recurring workflow, like a weekly research digest
- Build a custom skill or plugin for your workflow

The difference from a standalone chatbot is context: the agent can see the workspace you are building, remember what matters, and leave useful outputs behind as durable files.

## Automate and extend Green Tea

### Scheduled agents

Green Tea can run agent tasks in the background. Ask it to do something recurring, like:

> Every Monday at 9am, summarize what changed in this workspace into a new note.

Scheduled agents make Green Tea more than a place to store knowledge. They make it a workspace that can monitor, update, research, and prepare work while you are away.

### Memory that carries over

The agent keeps its own lightweight memory in **`MEMORY.md`** — facts, preferences, decisions, and project context it should remember across conversations. Ask it to “remember” something and it will write it there. Delete or edit the file whenever you want to change what it carries forward.

### Skills

**Skills** are reusable capability packs the agent loads on demand. Green Tea ships with skills for **PDF**, **DOCX**, **XLSX**, and **PPTX** files, plus skills for diagrams, slide decks, intelligence briefings, kanban boards, and more.

Two meta-skills let Green Tea extend itself:

- **skill-creator** — build a brand-new agent skill.
- **plugin-creator** — build a new artifact viewer/editor.

Skills are just files on disk, so they can be shared, edited, inspected, and installed from a GitHub URL.

### Plugins

**Plugins** add new artifact types with their own viewers. Bundled plugins include things like kanban boards, Mermaid diagrams, and todo lists. Plugins are sandboxed to their own files, so they are safe to use — and you can ask the agent to create new ones when your workflow needs a custom document type.

## Control, sharing, and customization

### Open source, provider login, and self-hosting

Green Tea is built around user control:

- **Open source** — inspect the code, contribute, fork it, or self-host the pieces you need.
- **Use your existing AI plans** — log in with your Anthropic or OpenAI account and use your plan inside Green Tea, instead of being locked into one bundled model.
- **Local-first data** — your notes and artifacts live on your machine by default.
- **Optional cloud convenience** — use hosted services when you want sync, managed AI, or publishing convenience.

The model is simple: the software should be yours; paid services should be for convenience, not captivity.

### Sharing and publishing

Publish any note or shareable artifact to the web as a read-only snapshot. You get a clean link at **share.greentea.app** to send to anyone — no account needed on their end.

Shares expire after 30 days, and re-publishing resets the clock. Publishing is always deliberate: the agent never publishes on its own.

### Make it yours

Open **Settings** to:

- Choose your **AI provider and model**.
- Log in with your **Anthropic** or **OpenAI** account to use your existing plan inside Green Tea.
- Connect other providers with API keys when you want more options.
- Toggle **Review vs. Auto** approval.
- Enable extended reasoning, skills, plugins, and MCP servers.
- Customize the theme, fonts, sizes, and light/dark colors.

## Try it

Open the chat sidebar and try:

```text
Research the best open source alternatives to Notion and turn the result into an HTML briefing report.
```

Or:

```text
Every Monday at 8am, check the web for new developments in local-first AI tools and summarize them in this workspace.
```

That is the Green Tea idea: **your notes, your agents, your data — in an open source AI workspace you control.**
