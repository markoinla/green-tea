import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { parseFrontmatter } from '@mariozechner/pi-coding-agent'
import { getAgentBaseDir } from '../paths'

export interface AgentConfig {
  name: string
  description: string
  tools?: string[]
  model?: string
  maxTurns?: number
  timeoutMs?: number
  systemPrompt: string
  filePath: string
}

interface AgentFrontmatter extends Record<string, unknown> {
  name: string
  description: string
  tools?: string[]
  model?: string
  maxTurns?: number
  timeoutMs?: number
}

function getAgentsDir(db: Database.Database): string {
  return join(getAgentBaseDir(db), 'agents')
}

const DEFAULT_AGENTS: Record<string, string> = {
  'explorer.md': `---
name: explorer
description: Fast reconnaissance and research agent. Searches notes, files, and the web to gather context.
model: green-tea-explorer
maxTurns: 15
timeoutMs: 90000
tools:
  - read
  - grep
  - find
  - ls
  - notes_list
  - notes_get_markdown
  - notes_search
  - notes_get_outline
  - web_search
  - web_fetch
---

You are an explorer agent. Your job is to quickly gather information and return structured findings.

Rules:
- Be thorough but fast. Scan broadly, then drill into relevant areas.
- Return findings as a structured report with clear sections and key takeaways.
- Use web_search to find relevant URLs, then web_fetch to read the most important pages in full.
- When researching a topic, go deep: search, read top results, and extract the most useful information.
- Do NOT make changes. You are read-only.
- Do NOT propose edits or create notes.`,

  'planner.md': `---
name: planner
description: Read-only planning agent. Creates step-by-step implementation plans.
model: green-tea-planner
tools:
  - read
  - grep
  - find
  - ls
  - notes_list
  - notes_get_markdown
  - notes_search
  - notes_get_outline
---

You are a planning agent. Given context (often from a scout), create a detailed implementation plan.

Rules:
- Output a numbered step-by-step plan.
- Reference specific files and line numbers when possible.
- Each step should be small and independently verifiable.
- Do NOT make changes. You are read-only.`,

  'worker.md': `---
name: worker
description: General-purpose agent with full tool access for implementation tasks.
model: green-tea-worker
maxTurns: 25
timeoutMs: 180000
tools:
  - read
  - bash
  - edit
  - write
  - grep
  - find
  - ls
  - notes_list
  - notes_get_markdown
  - notes_search
  - notes_get_outline
  - notes_create
  - notes_propose_edit
  - notes_update_workspace_description
  - notes_create_folder
  - notes_move_to_folder
  - web_search
  - web_fetch
---

You are a worker agent. Execute the given task using all available tools.

Rules:
- Follow instructions precisely.
- Propose changes via notes_propose_edit when modifying existing notes.
- Create new notes when appropriate.
- Report what you did when finished.`
}

function seedDefaultAgents(agentsDir: string): void {
  mkdirSync(agentsDir, { recursive: true })

  // Only seed if directory is empty (no .md files)
  try {
    const existing = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
    if (existing.length > 0) return
  } catch {
    // Directory just created, proceed to seed
  }

  for (const [filename, content] of Object.entries(DEFAULT_AGENTS)) {
    const filePath = join(agentsDir, filename)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content, 'utf-8')
    }
  }
}

export function discoverAgents(db: Database.Database): Map<string, AgentConfig> {
  const agentsDir = getAgentsDir(db)
  seedDefaultAgents(agentsDir)

  const agents = new Map<string, AgentConfig>()

  let files: string[]
  try {
    files = readdirSync(agentsDir).filter((f) => f.endsWith('.md'))
  } catch {
    return agents
  }

  for (const file of files) {
    const filePath = join(agentsDir, file)
    try {
      const raw = readFileSync(filePath, 'utf-8')
      const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(raw)

      if (!frontmatter.name || !frontmatter.description) continue

      agents.set(frontmatter.name, {
        name: frontmatter.name,
        description: frontmatter.description,
        tools: frontmatter.tools,
        model: frontmatter.model,
        maxTurns: frontmatter.maxTurns,
        timeoutMs: frontmatter.timeoutMs,
        systemPrompt: body.trim(),
        filePath
      })
    } catch {
      // Skip malformed files
    }
  }

  return agents
}
