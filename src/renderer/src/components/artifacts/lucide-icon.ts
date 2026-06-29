import * as Icons from 'lucide-react'
import { Puzzle, type LucideIcon } from 'lucide-react'

/**
 * Resolve a lucide icon name (as declared in a plugin manifest, e.g. `'SquareKanban'`)
 * to its component. The name must be an EXACT lucide export in PascalCase. Unknown or
 * empty names fall back to the generic plugin icon (`Puzzle`).
 *
 * Shared by the artifact registry (tree icon) and PluginViewer (toolbar icon) so a
 * plugin's manifest icon drives every surface consistently. On an unresolved name we
 * warn ONCE (deduped) so a plugin author/agent can spot a bad icon name rather than
 * silently getting the puzzle.
 */
const warned = new Set<string>()

/**
 * A lucide icon is a React component — historically a function, but in current
 * lucide-react every icon is a `forwardRef` object (`typeof === 'object'` with a
 * React `$$typeof`), NOT a function. Accept both; reject lucide's non-component
 * exports (the plain `icons` map, `createLucideIcon`, etc. won't carry `$$typeof`).
 */
function isRenderableIcon(value: unknown): value is LucideIcon {
  if (typeof value === 'function') return true
  return typeof value === 'object' && value !== null && '$$typeof' in value
}

export function resolveLucideIcon(name: string): LucideIcon {
  const icon = (Icons as unknown as Record<string, unknown>)[name]
  if (isRenderableIcon(icon)) return icon
  if (name && !warned.has(name)) {
    warned.add(name)
    console.warn(
      `[plugin] unknown icon "${name}" — falling back to the plugin icon. ` +
        `Use an exact PascalCase lucide name from https://lucide.dev/icons (e.g. "SquareKanban").`
    )
  }
  return Puzzle
}
