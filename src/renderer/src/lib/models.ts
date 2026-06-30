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
  /**
   * How the provider authenticates. 'apiKey' (default) reads `keyField` from
   * settings; 'oauth' is gated on a connected account (`connectionId`) managed
   * in Settings → Accounts rather than an API key.
   */
  authKind?: 'apiKey' | 'oauth'
  /** For oauth providers: the llm-auth account id used to check connection. */
  connectionId?: string
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
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }
    ],
    keyField: 'anthropicApiKey',
    keyPlaceholder: 'sk-ant-...',
    modelField: 'anthropicModel'
  },
  {
    id: 'anthropic-oauth',
    name: 'Claude (Pro / Max)',
    description: 'Use your Claude subscription. Connect in Settings → Accounts.',
    models: [
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' }
    ],
    keyField: null,
    modelField: 'anthropicOAuthModel',
    authKind: 'oauth',
    connectionId: 'anthropic'
  },
  {
    id: 'openai-codex',
    name: 'ChatGPT (Codex)',
    description: 'Use your ChatGPT Plus/Pro subscription. Connect in Settings → Accounts.',
    models: [
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 mini' },
      { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark' }
    ],
    keyField: null,
    modelField: 'codexModel',
    authKind: 'oauth',
    connectionId: 'openai-codex'
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
  },
  {
    id: 'zenlayer',
    name: 'Zenlayer AI Gateway',
    description: 'Many vendors through one OpenAI-compatible gateway.',
    models: [
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5' },
      { id: 'gpt-5.5', name: 'GPT-5.5' },
      { id: 'gpt-5.2', name: 'GPT-5.2' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
      { id: 'grok-4.3', name: 'Grok 4.3' },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking' },
      { id: 'qwen3-coder-next', name: 'Qwen3 Coder Next' }
    ],
    keyField: 'zenlayerApiKey',
    keyPlaceholder: 'sk-...',
    modelField: 'zenlayerModel'
  }
]

/** Check if a model is enabled (defaults to true if not explicitly set) */
export function isModelEnabled(enabledModels: Record<string, boolean>, modelId: string): boolean {
  return enabledModels[modelId] !== false
}
