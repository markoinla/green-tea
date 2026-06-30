import { useState, useEffect } from 'react'
import { Key, Loader2, CheckCircle2, XCircle, ShieldCheck, LogIn } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from '@renderer/components/ui/accordion'
import { Switch } from '@renderer/components/ui/switch'
import { PROVIDERS, isModelEnabled } from '@renderer/lib/models'
import { useLlmAccounts } from '@renderer/hooks/useLlmAccounts'
import type { Settings } from '@renderer/hooks/useSettings'

interface ModelsTabProps {
  settings: Settings
  updateSetting: (key: keyof Settings, value: string | boolean) => void
}

function ReadyDot({ ready }: { ready: boolean }) {
  if (!ready) return null
  return <span className="size-2 rounded-full bg-green-500 shrink-0" />
}

type TestState = 'idle' | 'testing' | 'success' | 'error'

export function ModelsTab({ settings, updateSetting }: ModelsTabProps) {
  const llm = useLlmAccounts()
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({
    anthropicApiKey: '',
    togetherApiKey: '',
    openrouterApiKey: '',
    zenlayerApiKey: ''
  })
  const [testStates, setTestStates] = useState<Record<string, TestState>>({})
  const [testErrors, setTestErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    setApiKeys({
      anthropicApiKey: settings.anthropicApiKey,
      togetherApiKey: settings.togetherApiKey,
      openrouterApiKey: settings.openrouterApiKey,
      zenlayerApiKey: settings.zenlayerApiKey
    })
  }, [
    settings.anthropicApiKey,
    settings.togetherApiKey,
    settings.openrouterApiKey,
    settings.zenlayerApiKey
  ])

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
        const isOAuth = provider.authKind === 'oauth'
        const keyField = provider.keyField
        const hasKey = !!keyField && !!(settings[keyField as keyof Settings] as string)
        const connected = isOAuth ? llm.isConnected(provider.connectionId as string) : false
        const ready = isOAuth ? connected : hasKey
        const testState = testStates[provider.id] || 'idle'

        return (
          <AccordionItem key={provider.id} value={provider.id}>
            <AccordionTrigger>
              <span className="flex items-center gap-2">
                {provider.name}
                <ReadyDot ready={ready} />
              </span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                {isOAuth ? (
                  /* OAuth account connection (managed in Accounts) */
                  <div className="flex items-center justify-between gap-2">
                    {connected ? (
                      <span className="flex items-center gap-1.5 text-sm text-green-600">
                        <ShieldCheck className="size-4" />
                        Account connected
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">No account connected</span>
                    )}
                    <button
                      type="button"
                      className="h-8 rounded-lg border border-border px-3 text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
                      onClick={() =>
                        window.dispatchEvent(
                          new CustomEvent('open-settings-tab', { detail: 'accounts' })
                        )
                      }
                    >
                      <LogIn className="size-3.5" />
                      {connected ? 'Manage in Accounts' : 'Connect in Accounts'}
                    </button>
                  </div>
                ) : (
                  <>
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
                        value={apiKeys[keyField as string] || ''}
                        onChange={(e) => handleKeyChange(keyField as string, e.target.value)}
                        onBlur={() => handleKeyBlur(keyField as string)}
                      />
                    </div>

                    {/* Test Connection */}
                    {hasKey && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={testState === 'testing'}
                          className="h-8 px-3 text-xs font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors disabled:opacity-50"
                          onClick={() => handleTestConnection(provider.id, keyField as string)}
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
                  </>
                )}

                {/* Models */}
                <div>
                  <label className="text-sm font-medium">Models</label>
                  {!ready && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {isOAuth
                        ? 'Connect an account to enable models'
                        : 'Add an API key to enable models'}
                    </p>
                  )}
                  <div className="mt-1.5 space-y-1">
                    {provider.models.map((model) => {
                      const enabled = ready && isModelEnabled(settings.enabledModels, model.id)
                      return (
                        <div
                          key={model.id}
                          className={`flex items-center justify-between rounded-lg border border-border px-3 py-2 ${
                            !ready ? 'opacity-50' : ''
                          }`}
                        >
                          <span className="text-sm">{model.name}</span>
                          <Switch
                            checked={enabled}
                            onCheckedChange={() => handleToggleModel(model.id)}
                            disabled={!ready}
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
