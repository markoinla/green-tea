import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@renderer/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@renderer/components/ui/tabs'
import { GeneralTab } from './GeneralTab'
import { AppearanceTab } from './AppearanceTab'
import { ModelsTab } from './ModelsTab'
import { SkillsTab } from './SkillsTab'
import { AccountsTab } from './AccountsTab'
import { McpServersTab } from './McpServersTab'
import { useSettings } from '@renderer/hooks/useSettings'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: string
}

export function SettingsDialog({ open, onOpenChange, defaultTab }: SettingsDialogProps) {
  const { settings, updateSetting } = useSettings()
  const [activeTab, setActiveTab] = useState(defaultTab || 'general')

  useEffect(() => {
    if (open) setActiveTab(defaultTab || 'general')
  }, [open, defaultTab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage your app preferences.</DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          orientation="vertical"
          className="gap-0"
        >
          <div className="flex w-44 shrink-0 flex-col border-r border-border py-6 pl-6 pr-2">
            <h2 className="text-base font-semibold mb-4 px-2">Settings</h2>
            <TabsList variant="line" className="gap-0.5">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="appearance">Appearance</TabsTrigger>
              <TabsTrigger value="models">Models</TabsTrigger>
              <TabsTrigger value="skills">Skills</TabsTrigger>
              <TabsTrigger value="accounts">Accounts</TabsTrigger>
              <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="general" className="min-h-[480px] p-6 overflow-y-auto max-h-[70vh]">
            <GeneralTab />
          </TabsContent>

          <TabsContent
            value="appearance"
            className="min-h-[480px] p-6 overflow-y-auto max-h-[70vh]"
          >
            <AppearanceTab />
          </TabsContent>

          <TabsContent value="models" className="min-h-[480px] p-6 overflow-y-auto max-h-[70vh]">
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium">Models</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Add API keys and choose which models are available.
                </p>
              </div>
              <ModelsTab settings={settings} updateSetting={updateSetting} />
            </div>
          </TabsContent>

          <TabsContent value="skills" className="min-h-[480px] p-6 overflow-y-auto max-h-[70vh]">
            <SkillsTab />
          </TabsContent>

          <TabsContent value="accounts" className="min-h-[480px] p-6 overflow-y-auto max-h-[70vh]">
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium">Accounts</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect and manage your linked accounts.
                </p>
              </div>
              <AccountsTab />
            </div>
          </TabsContent>

          <TabsContent value="mcp" className="min-h-[480px] p-6 overflow-y-auto max-h-[70vh]">
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium">MCP Servers</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Configure external tool servers for the agent.
                </p>
              </div>
              <McpServersTab />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
