import { useState, useEffect, useCallback } from 'react'

export interface Settings {
  theme: 'light' | 'dark'
  aiProvider:
    | 'default'
    | 'anthropic'
    | 'anthropic-oauth'
    | 'openai-codex'
    | 'together'
    | 'openrouter'
    | 'zenlayer'
  anthropicModel: string
  anthropicApiKey: string
  anthropicOAuthModel: string
  codexModel: string
  togetherModel: string
  togetherApiKey: string
  openrouterModel: string
  openrouterApiKey: string
  zenlayerModel: string
  zenlayerApiKey: string
  showToolResults: boolean
  agentBaseDir: string
  reasoningMode: boolean
  autoApproveEdits: boolean
  enabledModels: Record<string, boolean>
  // Share keys use the dotted settings names the main process reads verbatim
  // (getSetting(db,'share.publishToken') / getSetting(db,'share.baseUrl')).
  'share.publishToken': string
  'share.baseUrl': string
}

const DEFAULTS: Settings = {
  theme: 'light',
  aiProvider: 'default',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicApiKey: '',
  anthropicOAuthModel: 'claude-sonnet-4-6',
  codexModel: 'gpt-5.5',
  togetherModel: 'moonshotai/Kimi-K2.5',
  togetherApiKey: '',
  openrouterModel: 'minimax/minimax-m2.1',
  openrouterApiKey: '',
  zenlayerModel: 'glm-5.2',
  zenlayerApiKey: '',
  showToolResults: false,
  agentBaseDir: '~/Documents/Green Tea',
  reasoningMode: false,
  autoApproveEdits: true,
  enabledModels: {},
  'share.publishToken': '',
  'share.baseUrl': 'https://share.greentea.app'
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loading, setLoading] = useState(true)

  const fetchSettings = useCallback(async () => {
    const all = (await window.api.settings.getAll()) as Record<string, string>
    setSettings({
      theme: (all.theme as Settings['theme']) || DEFAULTS.theme,
      aiProvider: (all.aiProvider as Settings['aiProvider']) || DEFAULTS.aiProvider,
      anthropicModel: all.anthropicModel || DEFAULTS.anthropicModel,
      anthropicApiKey: all.anthropicApiKey || DEFAULTS.anthropicApiKey,
      anthropicOAuthModel: all.anthropicOAuthModel || DEFAULTS.anthropicOAuthModel,
      codexModel: all.codexModel || DEFAULTS.codexModel,
      togetherModel: all.togetherModel || DEFAULTS.togetherModel,
      togetherApiKey: all.togetherApiKey || DEFAULTS.togetherApiKey,
      openrouterModel: all.openrouterModel || DEFAULTS.openrouterModel,
      openrouterApiKey: all.openrouterApiKey || DEFAULTS.openrouterApiKey,
      zenlayerModel: all.zenlayerModel || DEFAULTS.zenlayerModel,
      zenlayerApiKey: all.zenlayerApiKey || DEFAULTS.zenlayerApiKey,
      showToolResults: all.showToolResults === 'true',
      agentBaseDir: all.agentBaseDir || DEFAULTS.agentBaseDir,
      reasoningMode: all.reasoningMode === 'true',
      autoApproveEdits: all.autoApproveEdits !== 'false',
      enabledModels: all.enabledModels ? JSON.parse(all.enabledModels) : DEFAULTS.enabledModels,
      'share.publishToken': all['share.publishToken'] || DEFAULTS['share.publishToken'],
      'share.baseUrl': all['share.baseUrl'] || DEFAULTS['share.baseUrl']
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSettings()
    const unsub = window.api.onSettingsChanged(fetchSettings)
    return unsub
  }, [fetchSettings])

  const updateSetting = useCallback(async (key: keyof Settings, value: string | boolean) => {
    await window.api.settings.set(key, String(value))
  }, [])

  return { settings, loading, updateSetting }
}
