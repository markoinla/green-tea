import { useState, useEffect, useCallback } from 'react'

interface SkillInfo {
  name: string
  description: string
  enabled: boolean
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

  const removeSkill = useCallback(async (name: string) => {
    setError(null)
    try {
      await window.api.skills.remove(name)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const toggleSkill = useCallback(async (name: string, enabled: boolean) => {
    setError(null)
    try {
      await window.api.skills.toggle(name, enabled)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  return { skills, loading, installing, error, installSkill, removeSkill, toggleSkill }
}
