import type { Document, Folder } from '../../../../../main/database/types'

/**
 * A node in the rendered folder tree. The folder data model is flat — a folder
 * row's `name` is a slash-separated path (e.g. "Projects/Alpha"), mirroring the
 * subdirectory it maps to on disk. This builds the nested tree the sidebar
 * renders from those path-names.
 *
 * A node is either:
 *  - "real":      `folder` is the backing row (has an id, persisted collapse
 *                 state, and may directly contain documents), or
 *  - "synthetic": `folder` is null — an intermediate path segment that has
 *                 descendants but no row of its own (e.g. "Projects" when only
 *                 "Projects/Alpha" contains notes). Synthetic nodes are pure
 *                 grouping: no id, no direct documents.
 */
export interface FolderNode {
  /** Full slash-path from the root, e.g. "Projects/Alpha". */
  path: string
  /** Last path segment, used for display, e.g. "Alpha". */
  name: string
  /** The backing row, or null for a synthesized intermediate. */
  folder: Folder | null
  children: FolderNode[]
  /** Documents whose folder_id points directly at this node's row. */
  documents: Document[]
}

const byName = (a: FolderNode, b: FolderNode) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/**
 * User-selectable document sort for the sidebar. Applies to documents only —
 * folders always sort alphabetically (see `sortTree`) so the tree structure
 * stays predictable regardless of the chosen order.
 */
export type SidebarDocSort = 'name-asc' | 'name-desc' | 'modified-desc' | 'created-desc'

// Timestamps are ISO-8601 strings, so lexicographic compare orders chronologically.
const DOC_COMPARATORS: Record<SidebarDocSort, (a: Document, b: Document) => number> = {
  'name-asc': (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
  'name-desc': (a, b) => b.title.localeCompare(a.title, undefined, { sensitivity: 'base' }),
  'modified-desc': (a, b) => b.updated_at.localeCompare(a.updated_at),
  'created-desc': (a, b) => b.created_at.localeCompare(a.created_at)
}

/**
 * Sort documents by the user's chosen sidebar order. Callers sort the full
 * document list once — both the root list and `buildFolderTree`'s per-folder
 * lists preserve input order, so one pass covers the whole tree.
 */
export function sortDocuments(documents: Document[], sort: SidebarDocSort): Document[] {
  return [...documents].sort(DOC_COMPARATORS[sort])
}

function sortTree(nodes: FolderNode[]): void {
  nodes.sort(byName)
  for (const node of nodes) sortTree(node.children)
}

/**
 * Build the nested folder tree from the flat folder rows and the documents that
 * live in them. Intermediate path segments without their own row are synthesized
 * as grouping nodes so the hierarchy renders top-to-bottom.
 *
 * Documents with no folder (or a dangling folder_id) are NOT included here —
 * callers render those at the root via their own (existing) logic.
 */
export function buildFolderTree(folders: Folder[], documents: Document[]): FolderNode[] {
  const docsByFolder = new Map<string, Document[]>()
  for (const doc of documents) {
    if (!doc.folder_id) continue
    const list = docsByFolder.get(doc.folder_id)
    if (list) list.push(doc)
    else docsByFolder.set(doc.folder_id, [doc])
  }

  const nodeByPath = new Map<string, FolderNode>()
  const roots: FolderNode[] = []

  const ensureNode = (path: string): FolderNode => {
    const existing = nodeByPath.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const node: FolderNode = {
      path,
      name: slash === -1 ? path : path.slice(slash + 1),
      folder: null,
      children: [],
      documents: []
    }
    nodeByPath.set(path, node)
    if (slash === -1) roots.push(node)
    else ensureNode(path.slice(0, slash)).children.push(node)
    return node
  }

  for (const folder of folders) {
    // Normalize the stored name: drop empty/whitespace segments so a stray
    // leading/trailing/double slash can't create a blank node.
    const path = folder.name
      .split('/')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('/')
    if (!path) continue
    const node = ensureNode(path)
    node.folder = folder
    node.documents = docsByFolder.get(folder.id) ?? []
  }

  sortTree(roots)
  return roots
}

/**
 * Pick a non-colliding "Untitled Folder" name for a new folder under `parentPath`
 * ('' = top level). Folder names are full slash-paths and must be unique within a
 * workspace, so this appends " 2", " 3", … until it finds a free name.
 */
export function uniqueFolderName(folders: Folder[], parentPath: string): string {
  const prefix = parentPath ? `${parentPath}/` : ''
  const taken = new Set(folders.map((f) => f.name))
  const base = `${prefix}Untitled Folder`
  if (!taken.has(base)) return base
  let n = 2
  while (taken.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}
