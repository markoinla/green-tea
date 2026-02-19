export interface ModelDef {
  id: string
  name: string
}

export interface ProviderDef {
  id: string
  name: string
  description: string
  models: ModelDef[]
  keyField: string | null
  keyPlaceholder?: string
  modelField?: string
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'default',
    name: 'Green Tea',
    description: 'Built-in model. No API key required.',
    models: [{ id: 'default', name: 'Green Tea' }],
    keyField: null
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models by Anthropic.',
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }
    ],
    keyField: 'anthropicApiKey',
    keyPlaceholder: 'sk-ant-...',
    modelField: 'anthropicModel'
  },
  {
    id: 'together',
    name: 'Together AI',
    description: 'Open-source models via Together AI.',
    models: [
      { id: 'moonshotai/Kimi-K2.5', name: 'Kimi K2.5' },
      { id: 'Qwen/Qwen3-Coder-Next-FP8', name: 'Qwen3 Coder' }
    ],
    keyField: 'togetherApiKey',
    keyPlaceholder: 'together-...',
    modelField: 'togetherModel'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access many models through OpenRouter.',
    models: [
      { id: 'minimax/minimax-m2.1', name: 'MiniMax M2.1' },
      { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast' },
      { id: 'x-ai/grok-code-fast-1', name: 'Grok Code Fast 1' },
      { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' }
    ],
    keyField: 'openrouterApiKey',
    keyPlaceholder: 'sk-or-...',
    modelField: 'openrouterModel'
  }
]

/** Check if a model is enabled (defaults to true if not explicitly set) */
export function isModelEnabled(enabledModels: Record<string, boolean>, modelId: string): boolean {
  return enabledModels[modelId] !== false
}
