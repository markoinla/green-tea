import { useState, useEffect, useCallback } from 'react'

interface SkillInfo {
  /** Stable identity: the skill name for user skills, `plugin:<id>:<name>` for bundled. */
  id: string
  name: string
  description: string
  enabled: boolean
  /** `'user'` for user-installed skills, or the contributing plugin's id. */
  source: string
  /** Whether the skill can be individually removed (false for plugin-bundled skills). */
  removable: boolean
}

export function useSkills() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchSkills = useCallback(async () => {
    const list = await window.api.skills.list()
    setSkills(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSkills()
    const unsub = window.api.onSkillsChanged(fetchSkills)
    return unsub
  }, [fetchSkills])

  const installSkill = useCallback(async (url: string) => {
    setInstalling(url)
    setError(null)
    try {
      await window.api.skills.install(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setInstalling(null)
    }
  }, [])

  const removeSkill = useCallback(async (id: string) => {
    setError(null)
    try {
      await window.api.skills.remove(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const toggleSkill = useCallback(async (id: string, enabled: boolean) => {
    setError(null)
    try {
      await window.api.skills.toggle(id, enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return { skills, loading, installing, error, installSkill, removeSkill, toggleSkill }
}
