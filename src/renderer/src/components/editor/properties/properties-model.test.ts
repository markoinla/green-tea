import { describe, it, expect } from 'vitest'
import {
  buildPropertyRows,
  inferDefaultType,
  valueToInputString,
  valueToBoolean,
  toStringArray,
  inputStringToValue,
  normalizeStringArray,
  arrayToValue,
  stripTagHash,
  validatePropertyName,
  defaultValueForType
} from './properties-model'

describe('buildPropertyRows', () => {
  it('excludes reserved keys and orders registry keys first', () => {
    const fm = {
      id: 'abc',
      title: 'T',
      created: '2026-01-01',
      updated: '2026-01-02',
      status: 'draft',
      priority: 2,
      extra: 'z'
    }
    const types = [
      { key: 'priority', type: 'number' as const },
      { key: 'status', type: 'text' as const }
    ]
    const rows = buildPropertyRows(fm, types)
    expect(rows.map((r) => r.key)).toEqual(['priority', 'status', 'extra'])
    expect(rows[0].type).toBe('number')
    expect(rows[2].type).toBe('text') // inferred default
  })

  it('aliases singular `tag` to `tags`', () => {
    const rows = buildPropertyRows({ tag: ['a', 'b'] }, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('tags')
    expect(rows[0].type).toBe('list') // inferred for an array
  })

  it('prefers explicit `tags` over aliased `tag`', () => {
    const rows = buildPropertyRows({ tag: ['x'], tags: ['y'] }, [])
    expect(rows).toHaveLength(1)
    expect(rows[0].key).toBe('tags')
    expect(rows[0].value).toEqual(['y'])
  })

  it('sorts non-registry keys alphabetically', () => {
    const rows = buildPropertyRows({ zebra: 1, apple: 2 }, [])
    expect(rows.map((r) => r.key)).toEqual(['apple', 'zebra'])
  })
})

describe('inferDefaultType', () => {
  it('maps shapes to types', () => {
    expect(inferDefaultType([])).toBe('list')
    expect(inferDefaultType(true)).toBe('checkbox')
    expect(inferDefaultType(3)).toBe('number')
    expect(inferDefaultType('hi')).toBe('text')
  })
})

describe('valueToInputString', () => {
  it('renders list as comma string', () => {
    expect(valueToInputString(['a', 'b'], 'list')).toBe('a, b')
  })
  it('renders scalar', () => {
    expect(valueToInputString(2, 'number')).toBe('2')
    expect(valueToInputString(null, 'text')).toBe('')
  })
})

describe('valueToBoolean', () => {
  it('reads booleans and strings', () => {
    expect(valueToBoolean(true)).toBe(true)
    expect(valueToBoolean('true')).toBe(true)
    expect(valueToBoolean('false')).toBe(false)
    expect(valueToBoolean(undefined)).toBe(false)
  })
})

describe('toStringArray', () => {
  it('coerces values to arrays', () => {
    expect(toStringArray(['a', 1])).toEqual(['a', '1'])
    expect(toStringArray('solo')).toEqual(['solo'])
    expect(toStringArray('')).toEqual([])
    expect(toStringArray(null)).toEqual([])
  })
})

describe('inputStringToValue', () => {
  it('parses numbers, falls back to raw on NaN', () => {
    expect(inputStringToValue('42', 'number')).toBe(42)
    expect(inputStringToValue('  ', 'number')).toBeNull()
    expect(inputStringToValue('1x', 'number')).toBe('1x')
  })
  it('splits list strings', () => {
    expect(inputStringToValue('a, b ,c', 'list')).toEqual(['a', 'b', 'c'])
    expect(inputStringToValue('  ', 'list')).toBeNull()
  })
  it('clears empty text/date', () => {
    expect(inputStringToValue('', 'text')).toBeNull()
    expect(inputStringToValue('2026-01-01', 'date')).toBe('2026-01-01')
  })
})

describe('normalizeStringArray / arrayToValue', () => {
  it('trims, drops empties, dedupes case-insensitively', () => {
    expect(normalizeStringArray([' a ', 'A', '', 'b'])).toEqual(['a', 'b'])
  })
  it('arrayToValue returns null when empty', () => {
    expect(arrayToValue(['', '  '])).toBeNull()
    expect(arrayToValue(['x'])).toEqual(['x'])
  })
})

describe('stripTagHash', () => {
  it('strips one leading hash', () => {
    expect(stripTagHash('#research')).toBe('research')
    expect(stripTagHash('plain')).toBe('plain')
  })
})

describe('validatePropertyName', () => {
  it('rejects empty, reserved, and duplicate names', () => {
    expect(validatePropertyName('', [])).toEqual({ ok: false, error: 'Name required' })
    expect(validatePropertyName('id', [])).toMatchObject({ ok: false })
    expect(validatePropertyName('status', ['status'])).toMatchObject({ ok: false })
    expect(validatePropertyName(' new ', [])).toEqual({ ok: true, key: 'new' })
  })
})

describe('defaultValueForType', () => {
  it('returns sensible empties', () => {
    expect(defaultValueForType('checkbox')).toBe(false)
    expect(defaultValueForType('tags')).toEqual([])
    expect(defaultValueForType('text')).toBe('')
  })
})
