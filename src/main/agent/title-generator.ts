import type Database from 'better-sqlite3'
import { getSetting } from '../database/repositories/settings'

const PROMPT = `Generate a short title (maximum 4 words) for a chat conversation that starts with the following user message. Reply with ONLY the title, no quotes, no punctuation, no explanation.

User message: `

export async function generateConversationTitle(
  db: Database.Database,
  userMessage: string
): Promise<string> {
  const aiProvider = getSetting(db, 'aiProvider') || 'default'

  if (aiProvider === 'anthropic') {
    return generateWithAnthropic(db, userMessage)
  }
  return generateWithOpenAI(db, aiProvider as 'default' | 'together' | 'openrouter', userMessage)
}

async function generateWithOpenAI(
  db: Database.Database,
  provider: 'default' | 'together' | 'openrouter',
  userMessage: string
): Promise<string> {
  let baseUrl: string
  let apiKey: string
  let modelId: string

  // Use a small, fast model for title generation instead of the main reasoning model
  const titleModelDirect = 'meta-llama/Llama-3.2-3B-Instruct-Turbo'

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
    modelId = titleModelDirect
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: PROMPT + userMessage }],
      max_tokens: 30,
      temperature: 0.3
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Title generation failed: ${res.status} ${text}`)
  }

  const json = (await res.json()) as {
    choices: { message: { content: string } }[]
  }
  return cleanTitle(json.choices[0]?.message?.content || '')
}

async function generateWithAnthropic(db: Database.Database, userMessage: string): Promise<string> {
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
      max_tokens: 20,
      messages: [{ role: 'user', content: PROMPT + userMessage }]
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Title generation failed: ${res.status} ${text}`)
  }

  const json = (await res.json()) as {
    content: { type: string; text: string }[]
  }
  const textBlock = json.content.find((b) => b.type === 'text')
  return cleanTitle(textBlock?.text || '')
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^["']|["']$/g, '')
    .replace(/[.!?]+$/, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(' ')
}
