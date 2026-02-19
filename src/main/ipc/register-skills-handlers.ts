import { ipcMain } from 'electron'
import * as settings from '../database/repositories/settings'
import { resetSession } from '../agent/session'
import * as skillsManager from '../skills/manager'
import { fetchMarketplaceRegistry } from '../skills/marketplace'
import type { IpcHandlerContext } from './context'

export function registerSkillsHandlers({ db }: IpcHandlerContext): void {
  ipcMain.handle('skills:list', () => {
    const skills = skillsManager.listInstalledSkills(db)
    const disabledRaw = settings.getSetting(db, 'disabledSkills')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      enabled: !disabled.includes(s.name)
    }))
  })

  ipcMain.handle('skills:install', async (_event, url: string) => {
    const skill = await skillsManager.installSkillFromUrl(db, url)
    await resetSession()
    _event.sender.send('skills:changed')
    return { name: skill.name, description: skill.description, enabled: true }
  })

  ipcMain.handle('skills:remove', async (_event, name: string) => {
    skillsManager.removeSkill(db, name)
    const disabledRaw = settings.getSetting(db, 'disabledSkills')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    const updated = disabled.filter((n) => n !== name)
    settings.setSetting(db, 'disabledSkills', JSON.stringify(updated))
    await resetSession()
    _event.sender.send('skills:changed')
  })

  ipcMain.handle('skills:toggle', async (_event, name: string, enabled: boolean) => {
    const disabledRaw = settings.getSetting(db, 'disabledSkills')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    let updated: string[]
    if (enabled) {
      updated = disabled.filter((n) => n !== name)
    } else {
      updated = disabled.includes(name) ? disabled : [...disabled, name]
    }
    settings.setSetting(db, 'disabledSkills', JSON.stringify(updated))
    await resetSession()
    _event.sender.send('skills:changed')
  })

  ipcMain.handle('skills:marketplace:list', async () => {
    return fetchMarketplaceRegistry()
  })

  ipcMain.handle('skills:marketplace:refresh', async () => {
    return fetchMarketplaceRegistry(true)
  })
}
