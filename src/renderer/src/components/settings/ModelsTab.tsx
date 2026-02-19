import { useState, useEffect } from 'react'
import { Key, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'
import { Switch } from '@renderer/components/ui/switch'
import { PROVIDERS, isModelEnabled } from '@renderer/lib/models'
import type { Settings } from '@renderer/hooks/useSettings'

interface ModelsTabProps {
  settings: Settings
  updateSetting: (key: keyof Settings, value: string | boolean) => void
}

function KeyDot({ hasKey }: { hasKey: boolean }) {
  if (!hasKey) return null
  return <span className="size-2 rounded-full bg-green-500 shrink-0" />
}

type TestState = 'idle' | 'testing' | 'success' | 'error'

export function ModelsTab({ settings, updateSetting }: ModelsTabProps) {
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropicApiKey: '',
    togetherApiKey: '',
    openrouterApiKey: ''
  })
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [testErrors, setTestErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setApiKeys({
      anthropicApiKey: settings.anthropicApiKey,
      togetherApiKey: settings.togetherApiKey,
      openrouterApiKey: settings.openrouterApiKey
    })
  }, [settings.anthropicApiKey, settings.togetherApiKey, settings.openrouterApiKey])

  function handleToggleModel(modelId: string) {
    const current = isModelEnabled(settings.enabledModels, modelId)
    const next = { ...settings.enabledModels, [modelId]: !current }
    updateSetting('enabledModels', JSON.stringify(next))
  }

  function handleKeyChange(field: string, value: string) {
    setApiKeys((prev) => ({ ...prev, [field]: value }))
  }

  function handleKeyBlur(field: string) {
    updateSetting(field as keyof Settings, apiKeys[field])
  }

  async function handleTestConnection(providerId: string, keyField: string) {
    const key = (settings[keyField as keyof Settings] as string) || apiKeys[keyField]
    if (!key) return

    setTestStates((prev) => ({ ...prev, [providerId]: 'testing' }))
    setTestErrors((prev) => ({ ...prev, [providerId]: '' }))

    try {
      const result = await window.api.settings.testApiKey(providerId, key)
      if (result.success) {
        setTestStates((prev) => ({ ...prev, [providerId]: 'success' }))
      } else {
        setTestStates((prev) => ({ ...prev, [providerId]: 'error' }))
        setTestErrors((prev) => ({ ...prev, [providerId]: result.error || 'Connection failed' }))
      }
    } catch {
      setTestStates((prev) => ({ ...prev, [providerId]: 'error' }))
      setTestErrors((prev) => ({ ...prev, [providerId]: 'Connection failed' }))
    }

    // Reset status after 3 seconds
    setTimeout(() => {
      setTestStates((prev) => ({ ...prev, [providerId]: 'idle' }))
    }, 3000)
  }

  const nonDefaultProviders = PROVIDERS.filter((p) => p.id !== 'default')

  return (
    <Accordion type="multiple" defaultValue={[]}>
      {nonDefaultProviders.map((provider) => {
        const keyField = provider.keyField as string
        const hasKey = !!(settings[keyField as keyof Settings] as string)
        const testState = testStates[provider.id] || 'idle'

        return (
          <AccordionItem key={provider.id} value={provider.id}>
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                {provider.name}
                <KeyDot hasKey={hasKey} />
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                {/* API Key */}
                <div>
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <Key className="size-3.5 text-muted-foreground" />
                    API Key
                  </label>
                  <input
                    type="password"
                    className="mt-1.5 w-full h-9 rounded-lg border border-border bg-background text-foreground text-sm px-3"
                    placeholder={provider.keyPlaceholder}
                    value={apiKeys[keyField] || ''}
                    onChange={(e) => handleKeyChange(keyField, e.target.value)}
                    onBlur={() => handleKeyBlur(keyField)}
                  />
                </div>

                {/* Test Connection */}
                {hasKey && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={testState === 'testing'}
                      className="h-8 px-3 text-xs font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors disabled:opacity-50"
                      onClick={() => handleTestConnection(provider.id, keyField)}
                    >
                      {testState === 'testing' ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="size-3 animate-spin" />
                          Testing...
                        </span>
                      ) : (
                        'Test Connection'
                      )}
                    </button>
                    {testState === 'success' && (
                      <span className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle2 className="size-3.5" />
                        Connected
                      </span>
                    )}
                    {testState === 'error' && (
                      <span className="flex items-center gap-1 text-xs text-red-500">
                        <XCircle className="size-3.5" />
                        {testErrors[provider.id]}
                      </span>
                    )}
                  </div>
                )}

                {/* Models */}
                <div>
                  <label className="text-sm font-medium">Models</label>
                  {!hasKey && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Add an API key to enable models
                    </p>
                  )}
                  <div className="mt-1.5 space-y-1">
                    {provider.models.map((model) => {
                      const enabled = hasKey && isModelEnabled(settings.enabledModels, model.id)
                      return (
                        <div
                          key={model.id}
                          className={`flex items-center justify-between rounded-lg border border-border px-3 py-2 ${
                            !hasKey ? 'opacity-50' : ''
                          }`}
                        >
                          <span className="text-sm">{model.name}</span>
                          <Switch
                            checked={enabled}
                            onCheckedChange={() => handleToggleModel(model.id)}
                            disabled={!hasKey}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        )
      })}
    </Accordion>
  )
}
