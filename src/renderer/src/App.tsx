import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  Component,
  type ReactNode,
  type ErrorInfo
} from 'react'
import type { JSONContent } from '@tiptap/react'
import { Toaster } from 'sonner'
import { AppLayout } from './components/layout/AppLayout'
import { OutlinerEditor } from './components/editor/OutlinerEditor'
import { useDocument } from './hooks/useDocument'
import { useAutosave } from './hooks/useAutosave'
import { useWorkspaces } from './hooks/useWorkspaces'
import { useTaskNotifications } from './hooks/useTaskNotifications'
import { usePythonCheck } from './hooks/usePythonCheck'
import { getFontStack } from './components/settings/constants'

const THEME_CSS_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring'
] as const

type ThemeData = {
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

function applyThemeOverrides(theme: ThemeData | null, mode: 'light' | 'dark'): void {
  const el = document.documentElement
  if (!theme) {
    for (const key of THEME_CSS_KEYS) {
      el.style.removeProperty(`--${key}`)
    }
    el.style.removeProperty('--radius')
    el.style.removeProperty('--editor-font-size')
    el.style.removeProperty('--code-font-size')
    el.style.removeProperty('--editor-body-font')
    el.style.removeProperty('--editor-heading-font')
    el.style.fontSize = ''
    return
  }

  // UI font size — scale the root so all rem-based Tailwind classes scale.
  // Most UI text uses text-sm (0.875rem). To make text-sm equal the user's
  // chosen size we set the html font-size = uiFontSize / 0.875.
  const uiSize = parseInt(theme.uiFontSize || '14', 10)
  el.style.fontSize = `${uiSize / 0.875}px`

  // Appearance settings from theme.json
  if (theme.editorFontSize) {
    el.style.setProperty('--editor-font-size', `${theme.editorFontSize}px`)
  }
  if (theme.codeFontSize) {
    el.style.setProperty('--code-font-size', `${theme.codeFontSize}px`)
  }
  if (theme.editorBodyFont) {
    el.style.setProperty('--editor-body-font', getFontStack(theme.editorBodyFont))
  }
  if (theme.editorHeadingFont) {
    el.style.setProperty('--editor-heading-font', getFontStack(theme.editorHeadingFont))
  }
  const bg = mode === 'dark' ? theme.darkBackground : theme.lightBackground
  if (bg) {
    el.style.setProperty('--background', bg)
  }

  // Radius
  if (theme.radius) {
    el.style.setProperty('--radius', theme.radius)
  } else {
    el.style.removeProperty('--radius')
  }

  // Color overrides
  const modeVars = mode === 'dark' ? theme.dark : theme.light
  for (const key of THEME_CSS_KEYS) {
    const value = modeVars?.[key]
    if (value) {
      el.style.setProperty(`--${key}`, value)
    } else {
      el.style.removeProperty(`--${key}`)
    }
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 bg-red-900 text-white m-4 rounded overflow-auto max-h-[50vh]">
          <h2 className="font-bold mb-2">Editor crashed:</h2>
          <pre className="text-xs whitespace-pre-wrap">{this.state.error.message}</pre>
          <pre className="text-xs whitespace-pre-wrap mt-2 opacity-70">
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

function DocumentEditor({
  documentId,
  onQuoteSelection
}: {
  documentId: string
  onQuoteSelection?: (text: string) => void
}) {
  const { document, loading, externalContentVersion, externalContent } =
    useDocument(documentId)
  const save = useAutosave(documentId)

  const initialContent = useMemo(() => {
    if (!document?.content) return undefined
    try {
      return JSON.parse(document.content) as JSONContent
    } catch {
      return undefined
    }
  }, [document?.content])

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1">
        <p className="text-muted-foreground text-sm">Loading...</p>
      </div>
    )
  }

  return (
    <OutlinerEditor
      key={documentId}
      content={initialContent}
      onUpdate={save}
      onQuoteSelection={onQuoteSelection}
      externalContent={externalContent}
      externalContentVersion={externalContentVersion}
    />
  )
}

export default function App() {
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectionContext, setSelectionContext] = useState<string | null>(null)
  const autoOpenedWorkspaceRef = useRef<string | null>(null)
  const { workspaces } = useWorkspaces()
  useTaskNotifications()
  usePythonCheck()

  const clearSelection = useCallback(() => setSelectionContext(null), [])

  // Restore last workspace or fall back to first
  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      window.api.settings.get('lastOpenedWorkspaceId').then((lastId) => {
        const match = lastId && workspaces.find((w) => w.id === lastId)
        setSelectedWorkspaceId(match ? lastId : workspaces[0].id)
      })
    }
  }, [workspaces, selectedWorkspaceId])

  // Auto-open first document when entering a workspace.
  // Do not re-open after the user manually closes the document.
  useEffect(() => {
    if (!selectedWorkspaceId || selectedDocId) return
    if (autoOpenedWorkspaceRef.current === selectedWorkspaceId) return

    autoOpenedWorkspaceRef.current = selectedWorkspaceId
    window.api.documents.list(selectedWorkspaceId).then((docs) => {
      if (docs.length > 0) {
        setSelectedDocId(docs[0].id)
      }
    })
  }, [selectedWorkspaceId, selectedDocId])

  const [appTheme, setAppTheme] = useState<'light' | 'dark'>('light')

  const themeRef = useRef<ThemeData | null>(null)

  useEffect(() => {
    const applySettings = async (): Promise<void> => {
      const s = await window.api.settings.getAll()
      const theme = (s.theme as 'light' | 'dark') || 'light'
      setAppTheme(theme)
      document.documentElement.classList.toggle('dark', theme === 'dark')

      // All appearance settings come from theme.json
      const themeData = await window.api.theme.get()
      themeRef.current = themeData
      applyThemeOverrides(themeData, theme)
    }

    applySettings()
    const unsub = window.api.onSettingsChanged(() => {
      applySettings()
    })
    return unsub
  }, [])

  useEffect(() => {
    return window.api.onThemeChanged((data) => {
      themeRef.current = data
      applyThemeOverrides(themeRef.current, appTheme)
    })
  }, [appTheme])

  const handleSelectWorkspace = (id: string) => {
    setSelectedWorkspaceId(id)
    setSelectedDocId(null) // Reset doc selection on workspace switch
    window.api.settings.set('lastOpenedWorkspaceId', id)
  }

  return (
    <>
      <AppLayout
        selectedDocId={selectedDocId}
        onSelectDoc={setSelectedDocId}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={handleSelectWorkspace}
        selectionContext={selectionContext}
        onClearSelection={clearSelection}
      >
        {selectedDocId ? (
          <ErrorBoundary key={selectedDocId}>
            <DocumentEditor documentId={selectedDocId} onQuoteSelection={setSelectionContext} />
          </ErrorBoundary>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 gap-3">
            <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center">
              <span className="text-sm font-bold text-accent-foreground">G</span>
            </div>
            <p className="text-muted-foreground text-sm">What would you like to work on?</p>
          </div>
        )}
      </AppLayout>
      <Toaster theme={appTheme} position="bottom-right" richColors closeButton />
    </>
  )
}
