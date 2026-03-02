import { useState, useEffect, useRef, useCallback } from 'react'
import NetInfo from '@react-native-community/netinfo'
import * as SecureStore from 'expo-secure-store'
import { attemptBroadcast } from '../src/infrastructure/chain/AvalancheBroadcaster'
import { getPendingTransaction } from '../src/infrastructure/chain/AvalancheBroadcaster'
import { SECURE_KEYS } from '../constants/avalanche'

export interface NetworkStatus {
  isOnline: boolean
  isChecking: boolean
  hasPendingTx: boolean
}

export interface NetworkActions {
  manualBroadcast: () => Promise<string | null>
}

/**
 * Monitors connectivity and auto-broadcasts pending transactions on reconnect.
 *
 * Runs on BOTH sender (Phone A) and relay (Phone B).
 * Whichever device reconnects first broadcasts — the other handles the duplicate gracefully.
 */
export function useNetworkStatus(
  onBroadcastSuccess?: (hash: string | null) => void,
  onBroadcastError?: (error: string) => void
): NetworkStatus & NetworkActions {
  const [isOnline, setIsOnline] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [hasPendingTx, setHasPendingTx] = useState(false)
  const wasOfflineRef = useRef(true) // assume offline on start

  // Check for pending tx periodically
  const checkPendingTx = useCallback(async () => {
    const pending = await getPendingTransaction()
    setHasPendingTx(!!pending)
  }, [])

  useEffect(() => {
    checkPendingTx()
    const interval = setInterval(checkPendingTx, 5000)
    return () => clearInterval(interval)
  }, [checkPendingTx])

  // NetInfo listener — triggers broadcast on reconnect
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const isNowOnline = !!state.isConnected && !!state.isInternetReachable

      setIsOnline(isNowOnline)

      // Just came back online
      if (wasOfflineRef.current && isNowOnline) {
        wasOfflineRef.current = false
        await tryBroadcastOnReconnect()
      } else if (!isNowOnline) {
        wasOfflineRef.current = true
      }
    })

    return () => unsubscribe()
  }, [])

  async function tryBroadcastOnReconnect() {
    const pending = await getPendingTransaction()
    if (!pending) return

    setIsChecking(true)
    try {
      const result = await attemptBroadcast()

      setHasPendingTx(false)

      if (result.alreadyBroadcast) {
        // Other device got there first — still clear pending
        onBroadcastSuccess?.(null)
      } else if (result.hash) {
        onBroadcastSuccess?.(result.hash)
      } else if (result.error) {
        // Keep pending_tx — will retry on next reconnect
        setHasPendingTx(true)
        onBroadcastError?.(result.error)
      }
    } catch (err: any) {
      setHasPendingTx(true)
      onBroadcastError?.(err.message)
    } finally {
      setIsChecking(false)
    }
  }

  const manualBroadcast = useCallback(async (): Promise<string | null> => {
    setIsChecking(true)
    try {
      const result = await attemptBroadcast()
      if (result.hash || result.alreadyBroadcast) {
        setHasPendingTx(false)
        return result.hash
      }
      return null
    } finally {
      setIsChecking(false)
    }
  }, [])

  return { isOnline, isChecking, hasPendingTx, manualBroadcast }
}
