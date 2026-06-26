/**
 * Shared drag-and-drop contracts for the documents sidebar, built on Pragmatic
 * drag-and-drop (@atlaskit/pragmatic-drag-and-drop).
 *
 * Scope: dragging a document onto a folder (move into) or onto the root drop
 * zone (move out to top level). Folders are not draggable and documents are not
 * reorderable — the backend sorts documents by `updated_at` and folders by
 * `name`, so there is no persistable manual order yet (that would need a
 * `position` column + migration).
 */

export const DRAG_TYPE_DOCUMENT = 'sidebar-document'
export const DROP_TYPE_FOLDER = 'sidebar-folder'
export const DROP_TYPE_ROOT = 'sidebar-root'

export interface DocumentDragData {
  [key: string]: unknown
  type: typeof DRAG_TYPE_DOCUMENT
  docId: string
  /** The folder the document currently lives in (null = root). Used to skip no-op moves. */
  folderId: string | null
}

export interface FolderDropData {
  [key: string]: unknown
  type: typeof DROP_TYPE_FOLDER
  folderId: string
}

export interface RootDropData {
  [key: string]: unknown
  type: typeof DROP_TYPE_ROOT
}

export function isDocumentDragData(data: Record<string, unknown>): data is DocumentDragData {
  return data.type === DRAG_TYPE_DOCUMENT
}

export function isFolderDropData(data: Record<string, unknown>): data is FolderDropData {
  return data.type === DROP_TYPE_FOLDER
}

export function isRootDropData(data: Record<string, unknown>): data is RootDropData {
  return data.type === DROP_TYPE_ROOT
}
