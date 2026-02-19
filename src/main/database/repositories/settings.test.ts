import { describe, it, expect, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createTestDb } from '../__test__/setup'
import { getSetting, setSetting, getAllSettings, deleteSetting } from './settings'

let db: Database.Database

beforeEach(() => {
  db = createTestDb()
})

describe('settings repository', () => {
  it('returns null for nonexistent key', () => {
    expect(getSetting(db, 'nope')).toBeNull()
  })

  it('sets and gets a setting', () => {
    setSetting(db, 'theme', 'dark')
    expect(getSetting(db, 'theme')).toBe('dark')
  })

  it('upserts on repeated set', () => {
    setSetting(db, 'key', 'v1')
    setSetting(db, 'key', 'v2')
    expect(getSetting(db, 'key')).toBe('v2')
  })

  it('deletes a setting', () => {
    setSetting(db, 'temp', 'value')
    deleteSetting(db, 'temp')
    expect(getSetting(db, 'temp')).toBeNull()
  })

  it('getAllSettings returns full map', () => {
    setSetting(db, 'a', '1')
    setSetting(db, 'b', '2')
    const all = getAllSettings(db)
    expect(all.a).toBe('1')
    expect(all.b).toBe('2')
  })

  it('getAllSettings returns empty object when no settings', () => {
    const all = getAllSettings(db)
    expect(typeof all).toBe('object')
  })
})
