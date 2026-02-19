import { useState, useEffect, useCallback } from 'react'

interface ThemeData {
  editorFontSize?: string
  uiFontSize?: string
  codeFontSize?: string
  editorBodyFont?: string
  editorHeadingFont?: string
  lightBackground?: string
  darkBackground?: string
  radius?: string
  light?: Record<string, string>
  dark?: Record<string, string>
}

const DEFAULTS: ThemeData = {
  editorFontSize: '14',
  uiFontSize: '14',
  codeFontSize: '13',
  editorBodyFont: 'inter',
  editorHeadingFont: 'georgia',
  lightBackground: '#ffffff',
  darkBackground: '#3b3f3c',
  radius: '0.5rem'
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeData>(DEFAULTS)

  useEffect(() => {
    window.api.theme.get().then((data) => {
      setTheme({ ...DEFAULTS, ...data })
    })
    const unsub = window.api.onThemeChanged((data) => {
      setTheme({ ...DEFAULTS, ...data })
    })
    return unsub
  }, [])

  const updateTheme = useCallback(async (partial: Partial<ThemeData>) => {
    setTheme((prev) => ({ ...prev, ...partial }))
    await window.api.theme.save(partial)
  }, [])

  return { theme, updateTheme }
}
