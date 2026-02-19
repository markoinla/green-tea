import { ipcMain } from 'electron'
import { promptAgent, abortAgent, resetSession, approveEdit, rejectEdit } from '../agent/session'
import { generateConversationTitle } from '../agent/title-generator'
import * as conversations from '../database/repositories/conversations'
import type { IpcHandlerContext } from './context'
import { getMainWindow } from './context'

export function registerAgentHandlers({ db, mainWindow }: IpcHandlerContext): void {
  ipcMain.handle(
    'agent:prompt',
    async (
      _event,
      data: {
        message: string
        conversationId: string
        documentId?: string
        workspaceId?: string
        references?: { id: string; title: string }[]
        images?: { data: string; mimeType: string }[]
        files?: { name: string; path: string }[]
      }
    ) => {
      const window = getMainWindow(mainWindow)
      if (!window) throw new Error('No browser window available')
      await promptAgent(
        db,
        window,
        data.message,
        data.conversationId,
        data.documentId,
        data.workspaceId,
        data.references,
        data.images,
        data.files
      )
    }
  )

  ipcMain.handle(
    'agent:generate-title',
    async (_event, data: { conversationId: string; userMessage: string }) => {
      let title = ''
      try {
        title = await generateConversationTitle(db, data.userMessage)
      } catch {
        // AI title generation failed — use fallback below
      }
      if (!title) {
        title = data.userMessage.trim().split(/\s+/).slice(0, 4).join(' ')
      }
      if (title) {
        conversations.updateConversationTitle(db, data.conversationId, title)
        mainWindow?.webContents.send('conversations:changed')
      }
    }
  )

  ipcMain.handle('agent:abort', (_event, conversationId: string) => {
    abortAgent(conversationId, mainWindow)
  })

  ipcMain.handle('agent:reset-session', async (_event, conversationId?: string) => {
    await resetSession(conversationId)
  })

  ipcMain.handle('agent:approve-edit', (_event, logId: string) => {
    const docId = approveEdit(db, logId)
    if (docId) {
      mainWindow?.webContents.send('documents:content-changed', { id: docId })
    }
  })

  ipcMain.handle('agent:reject-edit', (_event, logId: string) => {
    rejectEdit(db, logId)
  })
}
