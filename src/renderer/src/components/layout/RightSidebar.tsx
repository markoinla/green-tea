import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader
} from '@renderer/components/ui/sidebar'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { MessageSquare } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { ChatInput, type ChatInputHandle } from '@renderer/components/chat/ChatInput'
import { ChatHeader } from '@renderer/components/chat/ChatHeader'
import { ChatMessageList } from '@renderer/components/chat/ChatMessageList'
import { useDocuments } from '@renderer/hooks/useDocuments'
import { useWorkspaceFiles } from '@renderer/hooks/useWorkspaceFiles'
import { useSettings } from '@renderer/hooks/useSettings'
import { useConversations, dbMessageToChatMessage } from '@renderer/hooks/useConversations'
import { useChatState } from '@renderer/hooks/useChatState'
import { useAgentEvents } from '@renderer/hooks/useAgentEvents'
import { groupMessages } from '@renderer/hooks/chat-types'

interface RightSidebarProps {
  documentId: string | null
  workspaceId: string | null
  width?: number
  resizing?: boolean
  selectionContext?: string | null
  onClearSelection?: () => void
  hoverExpanded?: boolean
  onHoverChange?: (hovered: boolean) => void
}

export function RightSidebar({
  documentId,
  workspaceId,
  width,
  resizing,
  selectionContext,
  onClearSelection,
  hoverExpanded,
  onHoverChange
}: RightSidebarProps) {
  const { documents } = useDocuments(workspaceId)
  const { files: workspaceFiles } = useWorkspaceFiles(workspaceId)
  const { settings, updateSetting } = useSettings()

  const { conversations, createConversation, deleteConversation, canCreateNew } =
    useConversations(workspaceId)
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const { chatStates, setChatStates, dispatchTo, getState } = useChatState()

  const activeState = getState(activeConversationId)

  const {
    subagentEventsRef,
    subagentEventVersion,
    activeSubagentToolCallId,
    streamingStartTimeRef
  } = useAgentEvents({ dispatchTo })

  const docNameMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of documents) map.set(d.id, d.title)
    return map
  }, [documents])
  const resolveDocName = useCallback((id: string) => docNameMap.get(id) ?? id, [docNameMap])

  const displayItems = useMemo(() => groupMessages(activeState.messages), [activeState.messages])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollViewportRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<ChatInputHandle>(null)
  const isNearBottomRef = useRef(true)

  // Track whether user is near the bottom of the scroll area
  useEffect(() => {
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const onScroll = () => {
      const threshold = 80
      isNearBottomRef.current =
        viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < threshold
    }
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [])

  // Auto-scroll only when user is near the bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [activeState.messages])

  // Auto-create first conversation on workspace change, or select existing
  useEffect(() => {
    if (!workspaceId) {
      setActiveConversationId(null)
      setChatStates(new Map())
      return
    }
    if (conversations.length === 0) {
      setActiveConversationId(null)
    } else if (!activeConversationId || !conversations.find((c) => c.id === activeConversationId)) {
      setActiveConversationId(conversations[0].id)
    }
  }, [workspaceId, conversations, activeConversationId, createConversation, setChatStates])

  // Load persisted messages when switching to a conversation not yet in memory
  useEffect(() => {
    if (!activeConversationId) return
    if (chatStates.has(activeConversationId)) return
    window.api.conversations.listMessages(activeConversationId).then((dbMessages) => {
      const msgs = dbMessages.map(dbMessageToChatMessage)
      setChatStates((prev) => {
        const newMap = new Map(prev)
        newMap.set(activeConversationId, { messages: msgs, isStreaming: false })
        return newMap
      })
    })
  }, [activeConversationId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = useCallback(
    async (
      message: string,
      references: { id: string; title: string }[] = [],
      images: { data: string; mimeType: string }[] = [],
      files: { name: string; path: string }[] = []
    ) => {
      let convId = activeConversationId
      if (!convId) {
        const conv = await createConversation()
        if (!conv) return
        convId = conv.id
        setActiveConversationId(convId)
      }

      // User just sent a message — always scroll to bottom
      isNearBottomRef.current = true

      dispatchTo(convId, {
        type: 'add_message',
        message: {
          id: crypto.randomUUID(),
          role: 'user',
          content: message,
          timestamp: Date.now(),
          images: images.length > 0 ? images : undefined,
          files: files.length > 0 ? files.map((f) => ({ name: f.name })) : undefined
        }
      })

      // Persist user message
      await window.api.conversations.addMessage({
        conversation_id: convId,
        role: 'user',
        content: message,
        images: images.length > 0 ? JSON.stringify(images) : undefined,
        files: files.length > 0 ? JSON.stringify(files.map((f) => ({ name: f.name }))) : undefined
      })

      // Auto-title: generate from first user message if conversation has no title
      const conv = conversations.find((c) => c.id === convId)
      if (!conv || !conv.title) {
        window.api.agent.generateTitle({
          conversationId: convId,
          userMessage: message
        })
      }

      try {
        await window.api.agent.prompt({
          message,
          conversationId: convId,
          documentId: documentId ?? undefined,
          workspaceId: workspaceId ?? undefined,
          references: references.length > 0 ? references : undefined,
          images: images.length > 0 ? images : undefined,
          files: files.length > 0 ? files : undefined
        })
      } catch (err) {
        dispatchTo(convId, {
          type: 'add_message',
          message: {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            timestamp: Date.now()
          }
        })
        dispatchTo(convId, { type: 'set_streaming', streaming: false })
      }
    },
    [activeConversationId, documentId, workspaceId, dispatchTo, conversations, createConversation]
  )

  const handleStop = useCallback(() => {
    if (!activeConversationId) return
    window.api.agent.abort(activeConversationId)
    // Safety net: if still streaming after 3s, force-reset
    const convId = activeConversationId
    setTimeout(() => {
      setChatStates((prev) => {
        const current = prev.get(convId)
        if (current?.isStreaming) {
          window.api.agent.resetSession(convId)
          const newMap = new Map(prev)
          newMap.set(convId, { ...current, isStreaming: false })
          return newMap
        }
        return prev
      })
    }, 3000)
  }, [activeConversationId, setChatStates])

  const handleClear = useCallback(() => {
    if (!activeConversationId) return
    window.api.agent.resetSession(activeConversationId)
    dispatchTo(activeConversationId, { type: 'clear' })
  }, [activeConversationId, dispatchTo])

  const handleApproveEdit = useCallback(
    async (logId: string) => {
      if (!activeConversationId) return
      try {
        await window.api.agent.approveEdit(logId)
        dispatchTo(activeConversationId, { type: 'remove_patch', logId })
        dispatchTo(activeConversationId, {
          type: 'add_message',
          message: {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Edit applied successfully.',
            timestamp: Date.now()
          }
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        const isStale = message.includes('outdated')
        // Remove stale edits from the UI so the user doesn't keep retrying
        if (isStale) {
          dispatchTo(activeConversationId, { type: 'remove_patch', logId })
        }
        dispatchTo(activeConversationId, {
          type: 'add_message',
          message: {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: isStale
              ? 'This edit is outdated — the document has changed since it was proposed. Ask me to make this change again.'
              : `Failed to apply edit: ${message}`,
            timestamp: Date.now()
          }
        })
      }
    },
    [activeConversationId, dispatchTo]
  )

  const handleRejectEdit = useCallback(
    async (logId: string) => {
      if (!activeConversationId) return
      try {
        await window.api.agent.rejectEdit(logId)
        dispatchTo(activeConversationId, { type: 'remove_patch', logId })
        dispatchTo(activeConversationId, {
          type: 'add_message',
          message: {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Edit rejected.',
            timestamp: Date.now()
          }
        })
      } catch (err) {
        console.error('Failed to reject edit:', err)
      }
    },
    [activeConversationId, dispatchTo]
  )

  const handleDeleteConversation = useCallback(
    async (id: string) => {
      await deleteConversation(id)
      if (conversations.length === 1) {
        setActiveConversationId(null)
      }
      setChatStates((prev) => {
        const newMap = new Map(prev)
        newMap.delete(id)
        return newMap
      })
    },
    [deleteConversation, conversations.length, setChatStates]
  )

  const handleNewConversation = useCallback(async () => {
    const conv = await createConversation()
    if (conv) {
      setActiveConversationId(conv.id)
      requestAnimationFrame(() => chatInputRef.current?.focus())
    }
  }, [createConversation])

  return (
    <Sidebar
      side="right"
      collapsible="icon"
      className="border-l border-border"
      width={width}
      resizing={resizing}
      hoverExpanded={hoverExpanded}
      onHoverChange={onHoverChange}
    >
      {/* Collapsed indicator — only visible in icon mode */}
      <div className="hidden group-data-[collapsible=icon]:flex flex-col items-center pt-3 gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Full chat content — hidden in icon mode, shown when expanded or hover-expanded */}
      <div className="flex flex-col h-full w-full group-data-[collapsible=icon]:hidden">
        <SidebarHeader className="p-0">
          <ChatHeader
            conversations={conversations}
            activeConversationId={activeConversationId}
            canCreateNew={canCreateNew}
            onSelectConversation={setActiveConversationId}
            onDeleteConversation={handleDeleteConversation}
            onNewConversation={handleNewConversation}
            settings={settings}
            onUpdateSetting={updateSetting}
            tokens={activeState.tokens}
            isStreaming={activeState.isStreaming}
            hasMessages={activeState.messages.length > 0}
            onStop={handleStop}
            onClear={handleClear}
            documentId={documentId}
          />
        </SidebarHeader>

        <SidebarContent>
          <ScrollArea
            viewportRef={scrollViewportRef}
            className={cn('flex-1', documentId ? 'px-4' : 'px-48')}
          >
            <ChatMessageList
              displayItems={displayItems}
              isStreaming={activeState.isStreaming}
              activeConversationId={activeConversationId}
              streamingStartTime={
                activeConversationId
                  ? streamingStartTimeRef.current.get(activeConversationId)
                  : undefined
              }
              subagentEventsRef={subagentEventsRef}
              subagentEventVersion={subagentEventVersion}
              activeSubagentToolCallId={activeSubagentToolCallId}
              resolveDocName={resolveDocName}
              showToolResults={settings.showToolResults}
              onApprovePatch={handleApproveEdit}
              onRejectPatch={handleRejectEdit}
              messagesEndRef={messagesEndRef}
            />
          </ScrollArea>
        </SidebarContent>

        <SidebarFooter className={cn('pb-3 pt-0', documentId ? 'px-3' : 'px-48')}>
          <ChatInput
            ref={chatInputRef}
            onSend={handleSend}
            isStreaming={activeState.isStreaming}
            documents={[
              ...documents.map((d) => ({ id: d.id, title: d.title })),
              ...workspaceFiles.map((f) => ({ id: `file:${f.file_path}`, title: f.file_name }))
            ]}
            showSlashCommands={!!workspaceId}
            selectionContext={selectionContext}
            onClearSelection={onClearSelection}
            reasoningMode={settings.reasoningMode}
            onToggleReasoning={() => {
              const newMode = !settings.reasoningMode
              updateSetting('reasoningMode', newMode)
              if (activeConversationId) {
                window.api.agent.resetSession(activeConversationId)
              }
            }}
            autoApproveEdits={settings.autoApproveEdits}
            onToggleAutoApprove={() => {
              updateSetting('autoApproveEdits', !settings.autoApproveEdits)
            }}
          />
        </SidebarFooter>
      </div>
    </Sidebar>
  )
}
