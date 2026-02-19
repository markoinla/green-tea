import type Database from 'better-sqlite3'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getSetting } from '../database/repositories/settings'

// Patterns indicating document-storage filesystem references (not config/script paths).
// Excludes patterns like ~/.config, ~/.openclaw, etc. that are runtime config paths.
const FILESYSTEM_PATTERNS =
  /\.claude\/|create\s+a\s+file\s+at|save\s+(it\s+)?to\s+[~./]|write\s+(it\s+)?to\s+[~./]|["`'][\w./]*\/[\w.-]+\.md["`']/i

const SYSTEM_PROMPT = `You are adapting a skill document for Green Tea, a notes-based knowledge app.

Green Tea does NOT have a filesystem for documents. Instead it has:
- Notes (documents) in workspaces, accessed via notes_* tools
- notes_list, notes_search, notes_get_markdown, notes_create, notes_propose_edit
- Workspace description (persistent project context, like a CLAUDE.md)
- workspace_add_file for adding generated files to context

Rewrite ONLY the parts that reference filesystem paths for markdown/text document storage
(e.g. ".claude/foo.md", "~/docs/bar.md", "create a file at...").
Replace them with equivalent Green Tea operations (search for a note, read workspace
description, create a note, etc.).

DO NOT change:
- The skill's core knowledge, workflows, or instructions
- Script references (scripts/ directory) — these run on the real filesystem
- Asset references (assets/ directory)
- The YAML frontmatter (keep it exactly as-is)
- Config file paths (e.g. ~/.openclaw/*, ~/.config/*) — these are runtime configs, not documents
- Any content that doesn't reference filesystem document paths

Do NOT wrap your response in markdown code fences. Return the raw file content directly.
Return the COMPLETE adapted file. If nothing needs changing, return it unchanged.`

function needsAdaptation(content: string): boolean {
  return FILESYSTEM_PATTERNS.test(content)
}

async function callLLM(db: Database.Database, content: string): Promise<string> {
  const aiProvider = getSetting(db, 'aiProvider') || 'default'

  if (aiProvider === 'anthropic') {
    return callAnthropic(db, content)
  }
  return callOpenAI(db, aiProvider as 'default' | 'together' | 'openrouter', content)
}

async function callOpenAI(
  db: Database.Database,
  provider: 'default' | 'together' | 'openrouter',
  content: string
): Promise<string> {
  let baseUrl: string
  let apiKey: string
  let modelId: string

  if (provider === 'default') {
    baseUrl = 'https://greentea-proxy.m-6bb.workers.dev/v1'
    apiKey = 'proxy'
    modelId = 'green-tea-fast'
  } else if (provider === 'openrouter') {
    const key = getSetting(db, 'openrouterApiKey')
    if (!key) throw new Error('No OpenRouter API key configured')
    baseUrl = 'https://openrouter.ai/api/v1'
    apiKey = key
    modelId = getSetting(db, 'openrouterModel') || 'minimax/minimax-m2.1'
  } else {
    const key = getSetting(db, 'togetherApiKey')
    if (!key) throw new Error('No Together AI API key configured')
    baseUrl = 'https://api.together.xyz/v1'
    apiKey = key
    modelId = 'meta-llama/Llama-3.2-3B-Instruct-Turbo'
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content }
      ],
      max_tokens: 4096,
      temperature: 0
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Skill adaptation LLM call failed: ${res.status} ${text}`)
  }

  const json = (await res.json()) as {
    choices: { message: { content: string } }[]
  }
  return json.choices[0]?.message?.content || content
}

async function callAnthropic(db: Database.Database, content: string): Promise<string> {
  const apiKey = getSetting(db, 'anthropicApiKey')
  if (!apiKey) throw new Error('No Anthropic API key configured')
  const modelId = getSetting(db, 'anthropicModel') || 'claude-sonnet-4-6'

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }]
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Skill adaptation LLM call failed: ${res.status} ${text}`)
  }

  const json = (await res.json()) as {
    content: { type: string; text: string }[]
  }
  const textBlock = json.content.find((b) => b.type === 'text')
  return textBlock?.text || content
}

/**
 * Strip markdown code fences that LLMs sometimes wrap their output in.
 * Handles ```markdown, ```yaml, ```md, or bare ``` wrappers.
 */
function stripCodeFences(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```(?:markdown|yaml|md)?\s*\n([\s\S]*?)\n```\s*$/)
  return match ? match[1] : trimmed
}

/**
 * Extract frontmatter block (including delimiters) from markdown content.
 * Returns null if no valid frontmatter found.
 */
function extractFrontmatter(content: string): { raw: string; body: string } | null {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!normalized.startsWith('---')) return null
  const endIndex = normalized.indexOf('\n---', 3)
  if (endIndex === -1) return null
  return {
    raw: normalized.slice(0, endIndex + 4),
    body: normalized.slice(endIndex + 4)
  }
}

async function adaptFile(db: Database.Database, filePath: string): Promise<boolean> {
  const content = readFileSync(filePath, 'utf-8')
  if (!needsAdaptation(content)) return false

  // Preserve original frontmatter so the LLM can't corrupt it
  const original = extractFrontmatter(content)

  let adapted = await callLLM(db, content)
  adapted = stripCodeFences(adapted)
  if (adapted === content) return false

  // If the adapted output lost or mangled the frontmatter, restore the original
  if (original) {
    const adaptedFm = extractFrontmatter(adapted)
    if (!adaptedFm) {
      // LLM stripped frontmatter entirely — prepend the original
      adapted = original.raw + '\n' + adapted.trim()
    }
  }

  writeFileSync(filePath + '.original', content, 'utf-8')
  writeFileSync(filePath, adapted, 'utf-8')
  return true
}

export async function adaptSkillForGreenTea(
  db: Database.Database,
  skillDir: string
): Promise<void> {
  // Adapt SKILL.md
  const skillMd = join(skillDir, 'SKILL.md')
  if (existsSync(skillMd)) {
    await adaptFile(db, skillMd)
  }

  // Adapt references/*.md
  const refsDir = join(skillDir, 'references')
  if (existsSync(refsDir)) {
    const entries = readdirSync(refsDir)
    for (const entry of entries) {
      if (entry.endsWith('.md')) {
        await adaptFile(db, join(refsDir, entry))
      }
    }
  }
}
