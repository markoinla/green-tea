/** Prefix marking a tab id as a workspace-file (HTML artifact) tab. */
export const FILE_TAB_PREFIX = 'file:'

/** True when the tab id refers to a workspace file rather than a document. */
export function isFileTabId(id: string): boolean {
  return id.startsWith(FILE_TAB_PREFIX)
}

/** Build the namespaced tab id for a workspace file. */
export function fileTabId(workspaceFileId: string): string {
  return FILE_TAB_PREFIX + workspaceFileId
}

/** Extract the workspace-file id from a file tab id, or null if not a file tab. */
export function parseFileTabId(id: string): string | null {
  return isFileTabId(id) ? id.slice(FILE_TAB_PREFIX.length) : null
}
