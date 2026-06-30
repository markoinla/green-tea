import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { Toaster } from 'sonner'
import { AppLayout } from './components/layout/AppLayout'
import { TabbedEditorHost } from './components/editor/TabbedEditorHost'
import { useOpenTabs } from './hooks/useOpenTabs'
import { flushAll } from './hooks/useAutosave'
import { useWorkspaces } from './hooks/useWorkspaces'
import { useWorkspaceFiles } from './hooks/useWorkspaceFiles'
import { fileTabId } from './lib/tab-ids'
import { useTaskNotifications } from './hooks/useTaskNotifications'
import { usePythonCheck } from './hooks/usePythonCheck'
import { MetadataFilterProvider } from './contexts/MetadataFilterContext'
import { getFontStack } from './components/settings/constants'
import { setPluginViewers } from './components/artifacts/registry'

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

export default function App() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [selectionContext, setSelectionContext] = useState<string | null>(null)
  const autoOpenedWorkspaceRef = useRef<string | null>(null)
  const pendingOpenRef = useRef<{ docId: string; workspaceId: string | null } | null>(null)
  const { workspaces } = useWorkspaces()
  const { files: workspaceFiles } = useWorkspaceFiles(selectedWorkspaceId)
  const tabs = useOpenTabs(selectedWorkspaceId)
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  // Live workspace id so async callbacks (documents.list, hydration) can detect a
  // workspace switch that happened while they were in flight and bail out, rather
  // than acting on the new workspace's tabs with the old workspace's data.
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId)
  selectedWorkspaceIdRef.current = selectedWorkspaceId
  useTaskNotifications()
  usePythonCheck()

  const clearSelection = useCallback(() => setSelectionContext(null), [])

  // Keep the renderer plugin-viewer store in sync with enabled plugins: fetch the
  // viewer contributions on mount and whenever plugins change, feeding them into
  // the artifact registry so `plugin:*` kinds resolve to their viewers.
  useEffect(() => {
    const syncViewers = (): void => {
      window.api.plugins.viewers().then(setPluginViewers)
    }
    syncViewers()
    return window.api.onPluginsChanged(syncViewers)
  }, [])

  // Restore last workspace or fall back to first
  useEffect(() => {
    if (!selectedWorkspaceId && workspaces.length > 0) {
      window.api.settings.get('lastOpenedWorkspaceId').then((lastId) => {
        const match = lastId && workspaces.find((w) => w.id === lastId)
        setSelectedWorkspaceId(match ? lastId : workspaces[0].id)
      })
    }
  }, [workspaces, selectedWorkspaceId])

  // Auto-open the first document when entering a workspace — but only AFTER tab
  // state has hydrated and resolved to empty (finding #9). Never re-open after the
  // user manually closes everything in this workspace.
  useEffect(() => {
    if (!selectedWorkspaceId || !tabs.hydrated) return
    if (tabs.openDocIds.length > 0) {
      autoOpenedWorkspaceRef.current = selectedWorkspaceId
      return
    }
    if (autoOpenedWorkspaceRef.current === selectedWorkspaceId) return
    if (pendingOpenRef.current?.workspaceId === selectedWorkspaceId) return
    autoOpenedWorkspaceRef.current = selectedWorkspaceId
    const wsId = selectedWorkspaceId
    window.api.documents.list(wsId).then((docs) => {
      // Bail if the workspace switched while the list was in flight.
      if (selectedWorkspaceIdRef.current !== wsId) return
      if (docs.length > 0) tabsRef.current.openTab(docs[0].id)
    })
  }, [selectedWorkspaceId, tabs.hydrated, tabs.openDocIds.length])

  // A queued open (e.g. the command palette switching workspaces) waits for the
  // target workspace to hydrate before opening, so the hydrate doesn't clobber it
  // (finding #14). Only open if still in the workspace where it was queued.
  useEffect(() => {
    const pending = pendingOpenRef.current
    if (tabs.hydrated && pending && pending.workspaceId === selectedWorkspaceId) {
      pendingOpenRef.current = null
      tabsRef.current.openTab(pending.docId)
    }
  }, [tabs.hydrated, selectedWorkspaceId])

  // Close tabs whose docs no longer exist (delete / move-out-of-workspace). The
  // bare `documents:changed` event carries no payload, so reconcile by re-listing
  // (finding #3). Skip when the list reads empty — a transient/suspicious read must
  // not nuke open tabs (finding #12).
  useEffect(() => {
    if (!selectedWorkspaceId) return
    return window.api.onDocumentsChanged(() => {
      const wsId = selectedWorkspaceId
      window.api.documents.list(wsId).then((docs) => {
        // Bail if the workspace switched while the list was in flight, else we'd
        // reconcile the new workspace's tabs against the old workspace's doc set.
        if (selectedWorkspaceIdRef.current !== wsId) return
        if (docs.length === 0) return
        tabsRef.current.reconcileDeletions(new Set(docs.map((d) => d.id)))
      })
    })
  }, [selectedWorkspaceId])

  // Tab navigation accelerators ride the application menu (finding #1).
  useEffect(() => {
    return window.api.menu.onTabCommand((cmd) => {
      const t = tabsRef.current
      switch (cmd.type) {
        case 'close':
          if (t.openDocIds.length === 0) {
            window.close() // zero tabs → real window-close
          } else if (t.activeDocId) {
            t.closeTab(t.activeDocId)
          }
          break
        case 'next':
          t.cycle(1)
          break
        case 'prev':
          t.cycle(-1)
          break
        case 'goto':
          // Cmd/Ctrl-9 (index 8) → last tab; Cmd/Ctrl-1…8 → that visual index.
          t.activateByIndex(cmd.index === 8 ? t.openDocIds.length - 1 : cmd.index)
          break
      }
    })
  }, [])

  // Quit flush. The main process intercepts `before-quit`, asks us to flush, and
  // waits for `flushDone` — that handshake is the GUARANTEE that pending autosaves
  // and tab state are written before exit (findings #5, #11, #17).
  useEffect(() => {
    return window.api.app.onFlushBeforeQuit(async () => {
      try {
        await flushAll()
        await tabsRef.current.flushNow()
      } finally {
        window.api.app.flushDone()
      }
    })
  }, [])

  // Best-effort flush on plain window unload / reload (e.g. closing the window on
  // macOS without quitting). beforeunload can't await, so this stays best-effort;
  // the before-quit handshake above is the real guarantee.
  useEffect(() => {
    const handler = (): void => {
      void flushAll()
      void tabsRef.current.flushNow()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

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

  const handleSelectWorkspace = useCallback((id: string) => {
    setSelectedWorkspaceId(id)
    window.api.settings.set('lastOpenedWorkspaceId', id)
  }, [])

  // Sidebar / palette open. Cmd/Ctrl-click → new tab. If the target workspace is
  // still hydrating (cross-workspace palette open), queue the open.
  const handleSelectDoc = useCallback((id: string, opts?: { newTab?: boolean }) => {
    const t = tabsRef.current
    if (!t.hydrated) {
      // Tag with the workspace it was requested in so a later hydration of a
      // DIFFERENT workspace doesn't open it into the wrong strip.
      pendingOpenRef.current = { docId: id, workspaceId: selectedWorkspaceIdRef.current }
      return
    }
    t.openTab(id, { newTab: opts?.newTab })
  }, [])

  // Open an HTML artifact from the Files section in a `file:` tab. File tabs flow
  // through the same tab machinery as documents (no reducer change); the render
  // branch in TabbedEditorHost swaps in HtmlViewer.
  const handleOpenFile = useCallback((fileId: string) => {
    tabsRef.current.openTab(fileTabId(fileId))
  }, [])

  // workspace-file id → name, for labelling `file:` tabs inside TabbedEditorHost.
  const fileNamesById = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of workspaceFiles) map.set(f.id, f.file_name)
    return map
  }, [workspaceFiles])

  return (
    <MetadataFilterProvider>
      <AppLayout
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={handleSelectWorkspace}
        onSelectDoc={handleSelectDoc}
        onOpenFile={handleOpenFile}
        openDocIds={tabs.openDocIds}
        activeDocId={tabs.activeDocId}
        onActivateTab={tabs.activateTab}
        onCloseTab={tabs.closeTab}
        onCloseOthers={tabs.closeOthers}
        onCloseToRight={tabs.closeToRight}
        onCloseAll={tabs.closeAll}
        onReorderTab={tabs.reorderTab}
        selectionContext={selectionContext}
        onClearSelection={clearSelection}
      >
        {tabs.openDocIds.length > 0 ? (
          <TabbedEditorHost
            openDocIds={tabs.openDocIds}
            activeDocId={tabs.activeDocId}
            workspaceId={selectedWorkspaceId}
            onQuoteSelection={setSelectionContext}
            onNavigateToDoc={handleSelectDoc}
            onNavigateBack={tabs.goBack}
            onNavigateForward={tabs.goForward}
            canNavigateBack={tabs.canGoBack}
            canNavigateForward={tabs.canGoForward}
            fileNamesById={fileNamesById}
          />
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
    </MetadataFilterProvider>
  )
}
