import { useState, useCallback, useEffect } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { bleAdapter } from '../src/infrastructure/ble/BLEAdapter'
import { bleChunker } from '../src/utils/bleTransactionChunking'
import { validateSignedTransaction } from '../src/utils/nonceManager'
import { savePendingTransaction } from '../src/infrastructure/chain/AvalancheBroadcaster'
import { broadcastTransaction } from '../src/utils/offlineSigning'
import { STORAGE_KEYS } from '../constants/avalanche'

export type ReceiveStatus =
  | 'idle'
  | 'requesting_permissions'
  | 'listening'
  | 'receiving'
  | 'validating'
  | 'queued'
  | 'broadcasting'
  | 'confirmed'
  | 'error'

export interface ReceivedTxInfo {
  signedTx: string
  from: string | undefined
  to: string | undefined
  valueEther: string | undefined
  hash: string | null
}

export interface BLEReceiveState {
  status: ReceiveStatus
  receivedTx: ReceivedTxInfo | null
  error: string | null
}

export interface BLEReceiveActions {
  startListening: () => Promise<void>
  stopListening: () => void
  reset: () => void
}

/**
 * Manages the receiver side (Phone B):
 * - Opens BLE in receive mode
 * - Reassembles chunked transaction
 * - Validates the signed tx
 * - Queues in AsyncStorage
 * - Auto-broadcasts if online
 */
export function useBLEReceive(isOnline: boolean): BLEReceiveState & BLEReceiveActions {
  const [status, setStatus] = useState<ReceiveStatus>('idle')
  const [receivedTx, setReceivedTx] = useState<ReceivedTxInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleIncomingTx = useCallback(
    async (signedTx: string) => {
      setStatus('validating')

      const validation = validateSignedTransaction(signedTx)
      if (!validation.valid) {
        setError(validation.error ?? 'Invalid transaction received')
        setStatus('error')
        return
      }

      const txInfo: ReceivedTxInfo = {
        signedTx,
        from: validation.from,
        to: validation.to,
        valueEther: validation.valueEther,
        hash: null,
      }

      // Persist to AsyncStorage for auto-broadcast on reconnect
      await savePendingTransaction({
        signedTx,
        params: {
          to: validation.to ?? '',
          amountEther: validation.valueEther ?? '0',
          from: validation.from ?? '',
          nonceUsed: validation.parsedTx?.nonce ?? 0,
        },
        createdAt: Date.now(),
        source: 'relay',
      })

      setReceivedTx(txInfo)

      // If we're already online, broadcast immediately
      if (isOnline) {
        setStatus('broadcasting')
        try {
          const hash = await broadcastTransaction(signedTx)
          setReceivedTx((prev) => (prev ? { ...prev, hash: hash ?? null } : prev))
          setStatus('confirmed')
        } catch (err: any) {
          // Broadcast failed — queued for retry
          setStatus('queued')
        }
      } else {
        setStatus('queued')
      }
    },
    [isOnline]
  )

  const startListening = useCallback(async () => {
    try {
      setStatus('requesting_permissions')
      setError(null)

      const granted = await bleAdapter.requestPermissions()
      if (!granted) {
        setError('Bluetooth permissions denied')
        setStatus('error')
        return
      }

      await bleAdapter.waitForBluetooth()

      // Set up chunker handlers — triggered when a full tx is reassembled
      bleAdapter.setHandlers({
        onTransactionReceived: handleIncomingTx,
        onTransactionError: (err) => {
          setError(err)
          setStatus('error')
        },
      })

      setStatus('listening')
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }, [handleIncomingTx])

  const stopListening = useCallback(() => {
    bleAdapter.disconnect()
    setStatus('idle')
  }, [])

  const reset = useCallback(() => {
    bleAdapter.disconnect()
    setStatus('idle')
    setReceivedTx(null)
    setError(null)
  }, [])

  return { status, receivedTx, error, startListening, stopListening, reset }
}
