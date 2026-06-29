/**
 * Pure helpers for the plugin-scoped secrets path (§4.9.1).
 *
 * The storage key for a plugin secret is ALWAYS built server-side as
 * `plugin:<pluginId>:<subKey>` from the host-stamped `pluginId` (never a
 * full key supplied by the untrusted iframe), so a plugin can never reach
 * `google`, `microsoft`, `mcp:*`, or another plugin's namespace — even a
 * `subKey` containing `:` stays within its own `plugin:<id>:` prefix.
 *
 * `pluginId` is already constrained to `/^[a-z0-9][a-z0-9-]{0,63}$/` at manifest
 * load time (see `manager.ts` loadManifest), which is what makes the
 * `plugin:<id>:` prefix grammar collision-free. These helpers are deliberately
 * small and side-effect-free so the key construction and subKey bounds are unit
 * testable in isolation.
 */

/** Max length of an opaque plugin secret subKey (defensive, not a storage limit). */
export const MAX_PLUGIN_SUBKEY_LENGTH = 256

/** The namespace prefix owned by a single plugin. */
export function pluginSecretPrefix(pluginId: string): string {
  return `plugin:${pluginId}:`
}

/** The full storage key for a plugin secret. */
export function pluginSecretKey(pluginId: string, subKey: string): string {
  return `${pluginSecretPrefix(pluginId)}${subKey}`
}

/**
 * Validate/bound an opaque subKey supplied by a plugin. It's just storage, but we
 * keep it from being abused as a huge/binary/control-char key: must be a non-empty
 * string within {@link MAX_PLUGIN_SUBKEY_LENGTH}, with no C0/DEL control chars.
 * Throws on any violation; returns the subKey unchanged on success.
 */
export function sanitizePluginSubKey(subKey: unknown): string {
  if (typeof subKey !== 'string') throw new Error('Invalid secret subKey')
  if (subKey.length === 0 || subKey.length > MAX_PLUGIN_SUBKEY_LENGTH) {
    throw new Error('Secret subKey out of bounds')
  }
  for (let i = 0; i < subKey.length; i++) {
    const code = subKey.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) {
      throw new Error('Secret subKey contains control characters')
    }
  }
  return subKey
}
