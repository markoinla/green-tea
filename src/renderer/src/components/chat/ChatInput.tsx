import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import { cn } from '@renderer/lib/utils'
import { ChatInputSelectionBadge } from './ChatInputSelectionBadge'
import { ChatInputPastedTextBadge } from './ChatInputPastedTextBadge'
import { ChatInputAttachmentList } from './ChatInputAttachmentList'
import { ChatInputToolbar } from './ChatInputToolbar'
import { useChatInputEditor } from './useChatInputEditor'
import { useChatAttachments } from './useChatAttachments'
import { useChatInputHistory } from './useChatInputHistory'
import { useChatSpeechInput } from './useChatSpeechInput'
import type { DocumentRef, FileAttachment, ImageAttachment } from './chat-input-types'

interface ChatInputProps {
  onSend: (
    message: string,
    references: DocumentRef[],
    images: ImageAttachment[],
    files: FileAttachment[]
  ) => void
  disabled?: boolean
  isStreaming?: boolean
  documents?: DocumentRef[]
  showSlashCommands?: boolean
  selectionContext?: string | null
  onClearSelection?: () => void
  reasoningMode?: boolean
  onToggleReasoning?: () => void
  autoApproveEdits?: boolean
  onToggleAutoApprove?: () => void
}

export interface ChatInputHandle {
  focus: () => void
}

export type { ImageAttachment, FileAttachment } from './chat-input-types'

export const ChatInput = forwardRef<ChatInputHandle, ChatInputProps>(function ChatInput(
  {
    onSend,
    disabled = false,
    isStreaming = false,
    documents = [],
    showSlashCommands = false,
    selectionContext,
    onClearSelection,
    reasoningMode = false,
    onToggleReasoning,
    autoApproveEdits = true,
    onToggleAutoApprove
  },
  ref
) {
  const [hasContent, setHasContent] = useState(false)

  const {
    images,
    files,
    pastedText,
    totalAttachments,
    setPastedText,
    clearAttachments,
    removeImage,
    removeFile,
    handleFilePick,
    handleContainerPaste,
    handleDrop,
    handleDragOver,
    buildImageAttachments,
    buildFileAttachments
  } = useChatAttachments({ disabled })

  const { editor, isMentionActiveRef, isSlashActiveRef, extractMentions, getPlainText } =
    useChatInputEditor({
      disabled,
      isStreaming,
      documents,
      showSlashCommands,
      onHasContentChange: setHasContent,
      onLargePaste: (text) => setPastedText(text)
    })

  const { pushHistory, resetHistoryCursor, handleHistoryKeyDown } = useChatInputHistory()

  const { speechError, speechStatus, handleMicToggle, stopSpeechIfActive } = useChatSpeechInput({
    editor
  })

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor?.commands.focus()
    }),
    [editor]
  )

  useEffect(() => {
    if (selectionContext && editor) {
      editor.commands.focus()
    }
  }, [selectionContext, editor])

  const handleSend = useCallback(() => {
    if (!editor || disabled) return

    stopSpeechIfActive()

    const text = getPlainText()
    if (!text && images.length === 0 && files.length === 0 && !pastedText) return

    if (text) pushHistory(text)
    resetHistoryCursor()

    let finalMessage = text
    if (pastedText) {
      finalMessage = pastedText + (text ? '\n\n' + text : '')
    }
    if (selectionContext) {
      finalMessage = `> [Selected text]\n> "${selectionContext}"\n\n${text}`
      onClearSelection?.()
    }

    onSend(finalMessage, extractMentions(), buildImageAttachments(), buildFileAttachments())

    editor.commands.clearContent()
    setHasContent(false)
    clearAttachments()
  }, [
    editor,
    disabled,
    stopSpeechIfActive,
    getPlainText,
    images.length,
    files.length,
    pastedText,
    pushHistory,
    resetHistoryCursor,
    selectionContext,
    onClearSelection,
    onSend,
    extractMentions,
    buildImageAttachments,
    buildFileAttachments,
    clearAttachments
  ])

  useEffect(() => {
    if (!editor) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (isMentionActiveRef.current || isSlashActiveRef.current) return

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSend()
        return
      }

      handleHistoryKeyDown({ event, editor, getPlainText })
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener('keydown', handleKeyDown, true)

    return () => {
      editorElement.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [editor, isMentionActiveRef, isSlashActiveRef, handleSend, handleHistoryKeyDown, getPlainText])

  useEffect(() => {
    if (!editor) return

    const handleSlashSend = () => {
      setTimeout(() => handleSend(), 0)
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener('slash-command-send', handleSlashSend)

    return () => {
      editorElement.removeEventListener('slash-command-send', handleSlashSend)
    }
  }, [editor, handleSend])

  const handleMentionTrigger = useCallback(() => {
    if (!editor || disabled) return
    editor.chain().focus().insertContent('@').run()
  }, [editor, disabled])

  const handleSkillTrigger = useCallback(() => {
    if (!editor || disabled) return
    editor.chain().focus().clearContent().insertContent('/').run()
  }, [editor, disabled])

  if (!editor) return null

  const canSend = (hasContent || images.length > 0 || files.length > 0 || !!pastedText) && !disabled

  return (
    <div
      className="chat-input relative flex flex-col gap-2 rounded-3xl bg-secondary/40 border border-border/60 dark:border-border/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)] focus-within:bg-secondary/60 focus-within:border-border/80 dark:focus-within:border-border/90 focus-within:shadow-sm transition-all duration-200"
      onPaste={handleContainerPaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {selectionContext && (
        <ChatInputSelectionBadge
          selectionContext={selectionContext}
          onClearSelection={onClearSelection}
        />
      )}

      {pastedText && (
        <ChatInputPastedTextBadge pastedText={pastedText} onClear={() => setPastedText(null)} />
      )}

      <ChatInputAttachmentList
        images={images}
        files={files}
        onRemoveImage={removeImage}
        onRemoveFile={removeFile}
      />

      <EditorContent
        editor={editor}
        className={cn('px-4 py-3 min-h-[44px]', disabled ? 'opacity-50' : '')}
      />

      <ChatInputToolbar
        disabled={disabled}
        showSlashCommands={showSlashCommands}
        reasoningMode={reasoningMode}
        autoApproveEdits={autoApproveEdits}
        totalAttachments={totalAttachments}
        canSend={canSend}
        speechError={speechError}
        speechStatus={speechStatus}
        onMentionTrigger={handleMentionTrigger}
        onSkillTrigger={handleSkillTrigger}
        onFilePick={() => {
          void handleFilePick()
        }}
        onToggleReasoning={onToggleReasoning}
        onToggleAutoApprove={onToggleAutoApprove}
        onMicToggle={handleMicToggle}
        onSend={handleSend}
      />
    </div>
  )
})
