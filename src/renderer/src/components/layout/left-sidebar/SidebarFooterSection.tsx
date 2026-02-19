import { useState, useEffect } from 'react'
import { Settings, Bug } from 'lucide-react'
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '@renderer/components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { SettingsDialog } from '@renderer/components/settings/SettingsDialog'
import { BugReportDialog } from '@renderer/components/settings/BugReportDialog'
import { SchedulerPopover } from '@renderer/components/layout/SchedulerPopover'
import { useAutoUpdate } from '@renderer/hooks/useAutoUpdate'

interface SidebarFooterSectionProps {
  selectedWorkspaceId: string | null
}

export function SidebarFooterSection({ selectedWorkspaceId }: SidebarFooterSectionProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<string | undefined>(undefined)
  const [bugReportOpen, setBugReportOpen] = useState(false)
  const { status: updateStatus } = useAutoUpdate()

  useEffect(() => {
    function handleOpenSettingsTab(e: Event) {
      const tab = (e as CustomEvent).detail as string
      setSettingsTab(tab)
      setSettingsOpen(true)
    }
    window.addEventListener('open-settings-tab', handleOpenSettingsTab)
    return () => window.removeEventListener('open-settings-tab', handleOpenSettingsTab)
  }, [])

  return (
    <SidebarFooter className="p-2 group-data-[collapsible=icon]:p-1 border-t border-border">
      <SidebarMenu>
        <SidebarMenuItem>
          <SchedulerPopover workspaceId={selectedWorkspaceId} />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <div className="flex items-center gap-1">
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  onClick={() => setSettingsOpen(true)}
                  size="sm"
                  className="flex-1"
                >
                  <div className="relative">
                    <Settings className="h-4 w-4" />
                    {updateStatus.state === 'downloaded' && (
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-500" />
                    )}
                  </div>
                  <span className="group-data-[collapsible=icon]:hidden">Settings</span>
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent side="top">
                Configure AI models, API keys, and app preferences
              </TooltipContent>
            </Tooltip>
            <Tooltip delayDuration={500}>
              <TooltipTrigger asChild>
                <SidebarMenuButton
                  onClick={() => setBugReportOpen(true)}
                  size="sm"
                  className="w-8 justify-center shrink-0"
                >
                  <Bug className="h-4 w-4" />
                </SidebarMenuButton>
              </TooltipTrigger>
              <TooltipContent side="top">Report a bug or issue</TooltipContent>
            </Tooltip>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
      <BugReportDialog open={bugReportOpen} onOpenChange={setBugReportOpen} />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open)
          if (!open) setSettingsTab(undefined)
        }}
        defaultTab={settingsTab}
      />
    </SidebarFooter>
  )
}
