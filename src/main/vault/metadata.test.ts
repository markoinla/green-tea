import { describe, it, expect } from 'vitest'
import {
  RESERVED_KEYS,
  fold,
  inferType,
  conformsToType,
  deriveProperties,
  tagDisplayString
} from './metadata'

describe('fold', () => {
  it('lowercases and NFC-normalizes', () => {
    expect(fold('Research')).toBe('research')
    expect(fold('RESEARCH')).toBe('research')
    // NFC: composed vs decomposed é fold to the same string
    expect(fold('Café')).toBe(fold('Café'))
  })

  it('coerces non-strings via String()', () => {
    expect(fold(2 as unknown as string)).toBe('2')
    expect(fold(true as unknown as string)).toBe('true')
  })
})

describe('inferType', () => {
  it('infers checkbox/number/date/list/text', () => {
    expect(inferType(true)).toBe('checkbox')
    expect(inferType(2)).toBe('number')
    expect(inferType('2026-07-01')).toBe('date')
    expect(inferType('2026-07-01T10:00:00Z')).toBe('date')
    expect(inferType(['a', 'b'])).toBe('list')
    expect(inferType('draft')).toBe('text')
  })
})

describe('conformsToType', () => {
  it('validates against the registry type', () => {
    expect(conformsToType('2', 'number')).toBe(true)
    expect(conformsToType('draft', 'number')).toBe(false)
    expect(conformsToType('true', 'checkbox')).toBe(true)
    expect(conformsToType('yes', 'checkbox')).toBe(false)
    expect(conformsToType('2026-07-01', 'date')).toBe(true)
    expect(conformsToType('soon', 'date')).toBe(false)
    expect(conformsToType('anything', 'text')).toBe(true)
  })
})

describe('deriveProperties — coercion', () => {
  it('coerces scalars via String()', () => {
    const rows = deriveProperties({ status: 'draft', priority: 2, done: true })
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    expect(byKey.status).toBe('draft')
    expect(byKey.priority).toBe('2')
    expect(byKey.done).toBe('true')
  })

  it('null / empty produce no row', () => {
    const rows = deriveProperties({ a: null, b: '', c: 'x' })
    expect(rows.map((r) => r.key)).toEqual(['c'])
  })

  it('skips nested objects and arrays-of-objects', () => {
    const rows = deriveProperties({
      obj: { x: 1 },
      arr: [{ x: 1 }, { y: 2 }],
      ok: 'v'
    })
    expect(rows.map((r) => r.key)).toEqual(['ok'])
  })

  it('emits one row per list element', () => {
    const rows = deriveProperties({ langs: ['en', 'fr', 'en'] })
    expect(rows.filter((r) => r.key === 'langs').map((r) => r.value)).toEqual(['en', 'fr', 'en'])
  })

  it('emits one row per tags element', () => {
    const rows = deriveProperties({ tags: ['research', 'green-tea'] })
    expect(rows.filter((r) => r.key === 'tags').map((r) => r.value)).toEqual([
      'research',
      'green-tea'
    ])
  })

  it('populates value_fold', () => {
    const rows = deriveProperties({ status: 'Draft' })
    expect(rows[0].value).toBe('Draft')
    expect(rows[0].value_fold).toBe('draft')
  })
})

describe('deriveProperties — reserved keys', () => {
  it('skips id/title/created/updated', () => {
    const rows = deriveProperties({
      id: 'abc',
      title: 'T',
      created: '2026-01-01',
      updated: '2026-01-02',
      status: 'draft'
    })
    expect(rows.map((r) => r.key)).toEqual(['status'])
  })

  it('RESERVED_KEYS holds exactly the four owned keys', () => {
    expect([...RESERVED_KEYS].sort()).toEqual(['created', 'id', 'title', 'updated'])
  })
})

describe('deriveProperties — tag canonicalization', () => {
  it('strips a single leading # from tags', () => {
    const rows = deriveProperties({ tags: ['#research', 'green-tea'] })
    expect(rows.map((r) => r.value)).toEqual(['research', 'green-tea'])
  })

  it('aliases the singular tag key to tags', () => {
    const rows = deriveProperties({ tag: 'research' })
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('tags')
    expect(rows[0].value).toBe('research')
  })

  it('a bare # tag (becomes empty) produces no row', () => {
    const rows = deriveProperties({ tags: ['#', 'keep'] })
    expect(rows.map((r) => r.value)).toEqual(['keep'])
  })

  it('does not strip # for non-tag keys', () => {
    const rows = deriveProperties({ color: '#fff' })
    expect(rows[0].value).toBe('#fff')
  })
})

describe('deriveProperties — conforms via registry type', () => {
  it('marks conforms=0 when value does not parse as the registry type', () => {
    const typeFor = (): 'number' => 'number'
    const rows = deriveProperties({ priority: 'high' }, typeFor as never)
    expect(rows[0].value_type).toBe('number')
    expect(rows[0].conforms).toBe(0)
  })

  it('marks conforms=1 when value parses as the registry type', () => {
    const typeFor = (): 'number' => 'number'
    const rows = deriveProperties({ priority: '3' }, typeFor as never)
    expect(rows[0].conforms).toBe(1)
  })

  it('uses inferred type when no registry override', () => {
    const rows = deriveProperties({ priority: 3 })
    expect(rows[0].value_type).toBe('number')
    expect(rows[0].conforms).toBe(1)
  })
})

describe('tagDisplayString', () => {
  it('picks the most frequent original', () => {
    expect(tagDisplayString(['Research', 'research', 'research'])).toBe('research')
  })

  it('breaks ties by MIN(value)', () => {
    expect(tagDisplayString(['Research', 'research'])).toBe('Research')
  })
})
