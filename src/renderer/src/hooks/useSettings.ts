import { useState, useEffect, useCallback } from 'react'
import type { SidebarDocSort } from '@renderer/components/layout/left-sidebar/folderTree'

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
  /** Document sort order in the sidebar file tree (folders always sort A→Z). */
  sidebarSort: SidebarDocSort
}

const DEFAULTS: Settings = {
  theme: 'light',
  aiProvider: 'default',
  anthropicModel: 'claude-sonnet-5',
  anthropicApiKey: '',
  anthropicOAuthModel: 'claude-sonnet-5',
  codexModel: 'gpt-5.6-sol',
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
  // Matches the pre-setting behavior (documents arrive updated_at DESC from the DB).
  sidebarSort: 'modified-desc'
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
      sidebarSort: (all.sidebarSort as SidebarDocSort) || DEFAULTS.sidebarSort
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
