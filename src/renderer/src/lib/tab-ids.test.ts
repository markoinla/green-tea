import { describe, it, expect } from 'vitest'
import { FILE_TAB_PREFIX, isFileTabId, fileTabId, parseFileTabId } from './tab-ids'

describe('tab-ids', () => {
  it('exposes the expected prefix', () => {
    expect(FILE_TAB_PREFIX).toBe('file:')
  })

  it('round-trips a workspace-file id', () => {
    const id = 'abc-123'
    const tabId = fileTabId(id)
    expect(tabId).toBe('file:abc-123')
    expect(isFileTabId(tabId)).toBe(true)
    expect(parseFileTabId(tabId)).toBe(id)
  })

  it('round-trips an id that itself contains a colon', () => {
    const id = 'weird:id:with:colons'
    const tabId = fileTabId(id)
    expect(parseFileTabId(tabId)).toBe(id)
  })

  it('treats a document id as a non-file tab', () => {
    const docId = 'doc-789'
    expect(isFileTabId(docId)).toBe(false)
    expect(parseFileTabId(docId)).toBeNull()
  })
})
