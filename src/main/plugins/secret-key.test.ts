import { describe, expect, it } from 'vitest'
import {
  MAX_PLUGIN_SUBKEY_LENGTH,
  pluginSecretKey,
  pluginSecretPrefix,
  sanitizePluginSubKey
} from './secret-key'

describe('pluginSecretPrefix', () => {
  it('builds the per-plugin namespace prefix', () => {
    expect(pluginSecretPrefix('kanban-board')).toBe('plugin:kanban-board:')
  })
})

describe('pluginSecretKey — server-side key construction (§4.9.1)', () => {
  it('namespaces under the plugin prefix', () => {
    expect(pluginSecretKey('mermaid', 'api-token')).toBe('plugin:mermaid:api-token')
  })

  it('keeps a colon-bearing subKey WITHIN the plugin namespace (no escape)', () => {
    // The whole point: even a `:`-laden subKey cannot reach `google` / `mcp:*` /
    // another plugin — it stays prefixed by this plugin's own namespace.
    const key = pluginSecretKey('todo-list', 'google:tokens')
    expect(key).toBe('plugin:todo-list:google:tokens')
    expect(key.startsWith('plugin:todo-list:')).toBe(true)
  })

  it('cannot forge a sibling plugin namespace via the subKey', () => {
    // A subKey that *looks* like it climbs to another plugin still lands under
    // this plugin's prefix; range-scan listing by `plugin:victim:` never sees it.
    const key = pluginSecretKey('attacker', '../victim:secret')
    expect(key).toBe('plugin:attacker:../victim:secret')
    expect(key.startsWith(pluginSecretPrefix('victim'))).toBe(false)
  })
})

describe('sanitizePluginSubKey — bounds & control chars', () => {
  it('returns a well-formed subKey unchanged', () => {
    expect(sanitizePluginSubKey('theme-pref')).toBe('theme-pref')
  })

  it('allows a subKey containing a colon (opaque, stays in-namespace)', () => {
    expect(sanitizePluginSubKey('a:b:c')).toBe('a:b:c')
  })

  it('allows a plain space (0x20, the boundary, not a control char)', () => {
    expect(sanitizePluginSubKey('a b')).toBe('a b')
  })

  it('accepts a subKey exactly at the length cap', () => {
    const atCap = 'x'.repeat(MAX_PLUGIN_SUBKEY_LENGTH)
    expect(sanitizePluginSubKey(atCap)).toBe(atCap)
  })

  it('rejects a non-string subKey', () => {
    expect(() => sanitizePluginSubKey(undefined)).toThrow(/Invalid secret subKey/)
    expect(() => sanitizePluginSubKey(42)).toThrow(/Invalid secret subKey/)
    expect(() => sanitizePluginSubKey({})).toThrow(/Invalid secret subKey/)
  })

  it('rejects an empty subKey', () => {
    expect(() => sanitizePluginSubKey('')).toThrow(/out of bounds/)
  })

  it('rejects a subKey past the length cap', () => {
    expect(() => sanitizePluginSubKey('x'.repeat(MAX_PLUGIN_SUBKEY_LENGTH + 1))).toThrow(
      /out of bounds/
    )
  })

  it('rejects C0 control characters (newline, null, tab)', () => {
    expect(() => sanitizePluginSubKey('a\nb')).toThrow(/control characters/)
    expect(() => sanitizePluginSubKey('a\x00b')).toThrow(/control characters/)
    expect(() => sanitizePluginSubKey('a\tb')).toThrow(/control characters/)
  })

  it('rejects the DEL (0x7f) character', () => {
    expect(() => sanitizePluginSubKey('a\x7fb')).toThrow(/control characters/)
  })
})
