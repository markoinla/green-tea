import { ipcMain } from 'electron'
import * as settings from '../database/repositories/settings'
import { resetSession } from '../agent/session'
import * as skillsManager from '../skills/manager'
import { fetchMarketplaceRegistry } from '../skills/marketplace'
import { loadPluginSkills, pluginSkillId } from '../plugins/skills'
import type { IpcHandlerContext } from './context'

export function registerSkillsHandlers({ db }: IpcHandlerContext): void {
  ipcMain.handle('skills:list', () => {
    const disabledRaw = settings.getSetting(db, 'disabledSkills')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []

    // User skills first; their `name` is both their stable id and disabled-list key.
    const userSkills = skillsManager.listInstalledSkills(db)
    const taken = new Set(userSkills.map((s) => s.name))
    const rows: {
      id: string
      name: string
      description: string
      enabled: boolean
      source: string
      removable: boolean
    }[] = userSkills.map((s) => ({
      id: s.name,
      name: s.name,
      description: s.description,
      enabled: !disabled.includes(s.name),
      source: 'user',
      removable: true
    }))

    // Plugin-bundled skills: tracked by a plugin-namespaced id, surfaced as read-only
    // (removed by uninstalling the plugin, not individually). Mirror the session's
    // user-precedence de-dup so a plugin skill shadowed by a user skill isn't shown.
    for (const { skill, pluginId } of loadPluginSkills(db)) {
      if (taken.has(skill.name)) continue
      taken.add(skill.name)
      const id = pluginSkillId(pluginId, skill.name)
      rows.push({
        id,
        name: skill.name,
        description: skill.description,
        enabled: !disabled.includes(id),
        source: pluginId,
        removable: false
      })
    }

    return rows
  })

  ipcMain.handle('skills:install', async (_event, url: string) => {
    const skill = await skillsManager.installSkillFromUrl(db, url)
    await resetSession()
    _event.sender.send('skills:changed')
    return {
      id: skill.name,
      name: skill.name,
      description: skill.description,
      enabled: true,
      source: 'user',
      removable: true
    }
  })

  ipcMain.handle('skills:remove', async (_event, id: string) => {
    // Plugin-bundled skills (composite `plugin:<id>:<name>` ids) are managed by their
    // plugin — uninstall the plugin to remove them. Never delete out of a plugin dir.
    if (id.startsWith('plugin:')) {
      throw new Error('This skill is provided by a plugin. Remove the plugin to remove it.')
    }
    skillsManager.removeSkill(db, id)
    const disabledRaw = settings.getSetting(db, 'disabledSkills')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    const updated = disabled.filter((n) => n !== id)
    settings.setSetting(db, 'disabledSkills', JSON.stringify(updated))
    await resetSession()
    _event.sender.send('skills:changed')
  })

  // `id` is a user-skill name OR a plugin-skill composite id; both are stored verbatim
  // in `disabledSkills`, matching the precedence-aware filter in session.ts.
  ipcMain.handle('skills:toggle', async (_event, id: string, enabled: boolean) => {
    const disabledRaw = settings.getSetting(db, 'disabledSkills')
    const disabled: string[] = disabledRaw ? JSON.parse(disabledRaw) : []
    let updated: string[]
    if (enabled) {
      updated = disabled.filter((n) => n !== id)
    } else {
      updated = disabled.includes(id) ? disabled : [...disabled, id]
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
