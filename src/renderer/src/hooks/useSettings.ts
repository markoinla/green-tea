import { useState, useEffect, useCallback } from 'react'

export interface Settings {
  theme: 'light' | 'dark'
  aiProvider: 'default' | 'anthropic' | 'together' | 'openrouter'
  anthropicModel: string
  anthropicApiKey: string
  togetherModel: string
  togetherApiKey: string
  openrouterModel: string
  openrouterApiKey: string
  showToolResults: boolean
  agentBaseDir: string
  reasoningMode: boolean
  autoApproveEdits: boolean
  enabledModels: Record<string, boolean>
}

const DEFAULTS: Settings = {
  theme: 'light',
  aiProvider: 'default',
  anthropicModel: 'claude-sonnet-4-6',
  anthropicApiKey: '',
  togetherModel: 'moonshotai/Kimi-K2.5',
  togetherApiKey: '',
  openrouterModel: 'minimax/minimax-m2.1',
  openrouterApiKey: '',
  showToolResults: false,
  agentBaseDir: '~/Documents/Green Tea',
  reasoningMode: false,
  autoApproveEdits: true,
  enabledModels: {}
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
      togetherModel: all.togetherModel || DEFAULTS.togetherModel,
      togetherApiKey: all.togetherApiKey || DEFAULTS.togetherApiKey,
      openrouterModel: all.openrouterModel || DEFAULTS.openrouterModel,
      openrouterApiKey: all.openrouterApiKey || DEFAULTS.openrouterApiKey,
      showToolResults: all.showToolResults === 'true',
      agentBaseDir: all.agentBaseDir || DEFAULTS.agentBaseDir,
      reasoningMode: all.reasoningMode === 'true',
      autoApproveEdits: all.autoApproveEdits !== 'false',
      enabledModels: all.enabledModels ? JSON.parse(all.enabledModels) : DEFAULTS.enabledModels
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
