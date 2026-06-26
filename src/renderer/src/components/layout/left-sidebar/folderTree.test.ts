import { describe, it, expect } from 'vitest'
import { buildFolderTree, uniqueFolderName } from './folderTree'
import type { Document, Folder } from '../../../../../main/database/types'

const folder = (id: string, name: string): Folder =>
  ({ id, name, workspace_id: 'w', collapsed: 0, created_at: '', updated_at: '' }) as Folder

const doc = (id: string, folder_id: string | null): Document =>
  ({ id, folder_id, title: id }) as Document

describe('buildFolderTree', () => {
  it('returns flat top-level folders as roots', () => {
    const tree = buildFolderTree([folder('a', 'Archive'), folder('p', 'Projects')], [])
    expect(tree.map((n) => n.name)).toEqual(['Archive', 'Projects'])
    expect(tree.every((n) => n.folder !== null)).toBe(true)
  })

  it('nests folders by their slash-separated names', () => {
    const tree = buildFolderTree(
      [folder('p', 'Projects'), folder('a', 'Projects/Alpha'), folder('b', 'Projects/Beta')],
      []
    )
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('Projects')
    expect(tree[0].children.map((c) => c.name)).toEqual(['Alpha', 'Beta'])
  })

  it('synthesizes intermediate nodes that have no row of their own', () => {
    const tree = buildFolderTree([folder('a', 'Projects/Alpha')], [])
    expect(tree).toHaveLength(1)
    const projects = tree[0]
    expect(projects.name).toBe('Projects')
    expect(projects.folder).toBeNull() // synthetic
    expect(projects.children[0].name).toBe('Alpha')
    expect(projects.children[0].folder?.id).toBe('a')
  })

  it('attaches documents to their owning folder node', () => {
    const tree = buildFolderTree([folder('a', 'Projects/Alpha')], [doc('d1', 'a'), doc('d2', 'a')])
    expect(tree[0].children[0].documents.map((d) => d.id)).toEqual(['d1', 'd2'])
  })

  it('excludes root and dangling documents', () => {
    const tree = buildFolderTree([folder('a', 'Alpha')], [doc('d1', null), doc('d2', 'missing')])
    expect(tree[0].documents).toEqual([])
  })

  it('sorts siblings alphabetically, case-insensitively', () => {
    const tree = buildFolderTree(
      [folder('z', 'zeta'), folder('a', 'Alpha'), folder('b', 'beta')],
      []
    )
    expect(tree.map((n) => n.name)).toEqual(['Alpha', 'beta', 'zeta'])
  })

  it('ignores blank segments from stray slashes', () => {
    const tree = buildFolderTree([folder('a', '/Projects//Alpha/')], [])
    expect(tree[0].name).toBe('Projects')
    expect(tree[0].children[0].name).toBe('Alpha')
  })
})

describe('uniqueFolderName', () => {
  it('returns the base name at top level when free', () => {
    expect(uniqueFolderName([], '')).toBe('Untitled Folder')
  })

  it('suffixes a number when the base name is taken', () => {
    const folders = [folder('a', 'Untitled Folder'), folder('b', 'Untitled Folder 2')]
    expect(uniqueFolderName(folders, '')).toBe('Untitled Folder 3')
  })

  it('prefixes the parent path for a subfolder', () => {
    expect(uniqueFolderName([], 'Projects')).toBe('Projects/Untitled Folder')
  })

  it('dedupes within the parent only, ignoring same-named folders elsewhere', () => {
    const folders = [folder('a', 'Untitled Folder'), folder('b', 'Projects/Untitled Folder')]
    expect(uniqueFolderName(folders, 'Projects')).toBe('Projects/Untitled Folder 2')
  })
})
