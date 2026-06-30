import type Database from 'better-sqlite3'
import { getSecret, setSecret } from '../secrets'
import type { RegisterResponse } from '../../shared/share-contract'

/**
 * Per-device share credential (replaces the legacy shared publish token).
 *
 * On first use this device calls home to the share worker's POST /register,
 * which mints a unique `{ deviceId, deviceSecret }`. We persist the opaque
 * credential string `<deviceId>.<deviceSecret>` in the encrypted secrets store
 * and send it as the publish/unpublish bearer. No shared secret ships in the
 * app (green-tea is a public repo), so registration is automatic and silent.
 *
 * Only `sha256(deviceSecret)` is stored server-side; the raw secret lives only
 * here, encrypted at rest via safeStorage.
 */

const CREDENTIAL_KEY = 'share:deviceCredential'

/**
 * In-flight registration promise, so concurrent publishes that all miss the
 * cache register the device exactly once instead of racing /register.
 */
let inFlightRegistration: Promise<string> | null = null

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

async function registerDevice(db: Database.Database, baseUrl: string): Promise<string> {
  let res: Response
  try {
    res = await fetch(`${trimBaseUrl(baseUrl)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    throw new Error(
      `Device registration request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  if (!res.ok) {
    throw new Error(`Device registration failed (${res.status})`)
  }

  let json: RegisterResponse
  try {
    json = (await res.json()) as RegisterResponse
  } catch {
    throw new Error('Device registration returned an invalid response')
  }

  if (
    !json ||
    typeof json.deviceId !== 'string' ||
    typeof json.deviceSecret !== 'string' ||
    !json.deviceId ||
    !json.deviceSecret
  ) {
    throw new Error('Device registration returned an unexpected response')
  }

  const credential = `${json.deviceId}.${json.deviceSecret}`
  setSecret(db, CREDENTIAL_KEY, credential)
  return credential
}

/**
 * Resolve this device's share credential, registering on first use. Returns the
 * cached credential when present; otherwise POSTs to `<baseUrl>/register`,
 * persists the result, and returns it. Concurrent callers share one in-flight
 * registration. Throws a clear Error on network/HTTP failure.
 */
export async function getDeviceCredential(db: Database.Database, baseUrl: string): Promise<string> {
  const existing = getSecret(db, CREDENTIAL_KEY)
  if (existing) return existing

  if (inFlightRegistration) return inFlightRegistration

  inFlightRegistration = registerDevice(db, baseUrl).finally(() => {
    inFlightRegistration = null
  })
  return inFlightRegistration
}

/** Reset the in-flight registration memo. For tests only. */
export function clearCachedCredential(): void {
  inFlightRegistration = null
}
