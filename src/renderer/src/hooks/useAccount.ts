import { useState, useEffect, useCallback } from 'react'
import type { AccountUser } from '../../../shared/share-contract'

/**
 * Marketplace account state (auth layer one). Mirrors `useGoogleAccount` /
 * `useSkills`: resolves the signed-in account on mount, subscribes to `auth:changed`,
 * and exposes `signIn` / `signOut`. The app is fully functional signed-out, so
 * `account === null` is a normal, non-error state.
 */
export function useAccount() {
  const [account, setAccount] = useState<AccountUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [signingIn, setSigningIn] = useState(false)

  const fetchAccount = useCallback(async () => {
    try {
      const user = await window.api.auth.getAccount()
      setAccount(user)
    } catch {
      // best-effort; leave signed-out on failure
      setAccount(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAccount()
    const unsub = window.api.onAuthChanged(fetchAccount)
    return unsub
  }, [fetchAccount])

  const signIn = useCallback(async () => {
    setSigningIn(true)
    try {
      return await window.api.auth.signIn()
    } finally {
      setSigningIn(false)
    }
  }, [])

  const sendMagicLink = useCallback(async (email: string) => {
    return window.api.auth.sendMagicLink(email)
  }, [])

  const signOut = useCallback(async () => {
    return window.api.auth.signOut()
  }, [])

  return { account, loading, signingIn, signIn, sendMagicLink, signOut }
}
