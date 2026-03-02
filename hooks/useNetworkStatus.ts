import { useState, useEffect, useRef, useCallback } from 'react'
import NetInfo from '@react-native-community/netinfo'
import { attemptBroadcast, getPendingTransaction } from '../src/infrastructure/chain/AvalancheBroadcaster'
import { PendingTransaction } from '../src/utils/offlineSigning'

export interface NetworkStatus {
  isOnline: boolean
  isChecking: boolean
  hasPendingTx: boolean
  pendingTxInfo: PendingTransaction | null
  lastBroadcastError: string | null
}

export interface NetworkActions {
  manualBroadcast: () => Promise<string | null>
}

/**
 * Monitors connectivity and auto-broadcasts pending transactions on reconnect.
 *
 * Runs on BOTH sender (Phone A) and relay (Phone B).
 * Whichever device reconnects first broadcasts — the other handles the duplicate gracefully.
 *
 * Day 6 hardening:
 *  - isBroadcastingRef prevents concurrent broadcast attempts
 *  - pendingTxInfo exposes full tx details for UI (amount, to, source, age)
 *  - lastBroadcastError surfaces errors to UI without crashing
 *  - manualBroadcast also calls success/error callbacks for consistent navigation
 */
export function useNetworkStatus(
  onBroadcastSuccess?: (hash: string | null) => void,
  onBroadcastError?: (error: string) => void
): NetworkStatus & NetworkActions {
  const [isOnline, setIsOnline] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  const [hasPendingTx, setHasPendingTx] = useState(false)
  const [pendingTxInfo, setPendingTxInfo] = useState<PendingTransaction | null>(null)
  const [lastBroadcastError, setLastBroadcastError] = useState<string | null>(null)

  const wasOfflineRef = useRef(true) // assume offline on start → first online event triggers broadcast
  const isBroadcastingRef = useRef(false)

  const checkPendingTx = useCallback(async () => {
    const pending = await getPendingTransaction()
    setHasPendingTx(!!pending)
    setPendingTxInfo(pending)
  }, [])

  useEffect(() => {
    checkPendingTx()
    const interval = setInterval(checkPendingTx, 5000)
    return () => clearInterval(interval)
  }, [checkPendingTx])

  // NetInfo listener — triggers broadcast on offline → online transition
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const isNowOnline = !!state.isConnected && !!state.isInternetReachable

      setIsOnline(isNowOnline)

      if (wasOfflineRef.current && isNowOnline) {
        wasOfflineRef.current = false
        await tryBroadcast()
      } else if (!isNowOnline) {
        wasOfflineRef.current = true
      }
    })

    return () => unsubscribe()
  }, [])

  async function tryBroadcast() {
    if (isBroadcastingRef.current) return
    const pending = await getPendingTransaction()
    if (!pending) return

    isBroadcastingRef.current = true
    setIsChecking(true)
    setLastBroadcastError(null)

    try {
      const result = await attemptBroadcast()

      setHasPendingTx(false)
      setPendingTxInfo(null)

      if (result.alreadyBroadcast) {
        onBroadcastSuccess?.(null)
      } else if (result.hash) {
        onBroadcastSuccess?.(result.hash)
      } else if (result.error) {
        setHasPendingTx(true)
        setPendingTxInfo(pending)
        setLastBroadcastError(result.error)
        onBroadcastError?.(result.error)
      }
    } catch (err: any) {
      setHasPendingTx(true)
      setPendingTxInfo(pending)
      setLastBroadcastError(err.message)
      onBroadcastError?.(err.message)
    } finally {
      setIsChecking(false)
      isBroadcastingRef.current = false
    }
  }

  const manualBroadcast = useCallback(async (): Promise<string | null> => {
    if (isBroadcastingRef.current) return null
    isBroadcastingRef.current = true
    setIsChecking(true)
    setLastBroadcastError(null)

    try {
      const result = await attemptBroadcast()
      if (result.hash || result.alreadyBroadcast) {
        setHasPendingTx(false)
        setPendingTxInfo(null)
        onBroadcastSuccess?.(result.hash ?? null)
        return result.hash ?? null
      }
      if (result.error) {
        setLastBroadcastError(result.error)
        onBroadcastError?.(result.error)
      }
      return null
    } catch (err: any) {
      setLastBroadcastError(err.message)
      onBroadcastError?.(err.message)
      return null
    } finally {
      setIsChecking(false)
      isBroadcastingRef.current = false
    }
  }, [onBroadcastSuccess, onBroadcastError])

  return { isOnline, isChecking, hasPendingTx, pendingTxInfo, lastBroadcastError, manualBroadcast }
}
