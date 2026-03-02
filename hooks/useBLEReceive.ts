import { useState, useCallback, useEffect } from 'react'
import { bleAdapter } from '../src/infrastructure/ble/BLEAdapter'
import { validateSignedTransaction } from '../src/utils/nonceManager'
import { savePendingTransaction } from '../src/infrastructure/chain/AvalancheBroadcaster'
import { broadcastTransaction } from '../src/utils/offlineSigning'

export type ReceiveStatus =
  | 'idle'
  | 'starting'
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
  myPeerId: string | null
  error: string | null
}

export interface BLEReceiveActions {
  startListening: () => Promise<void>
  stopListening: () => void
  reset: () => void
}

/**
 * Receiver side (Phone B):
 * - Starts BLE mesh, advertises presence automatically
 * - Reassembles chunked incoming transaction
 * - Validates signed tx (chain ID, signature, recipient)
 * - Queues in AsyncStorage for auto-broadcast
 * - Auto-broadcasts immediately if already online
 */
export function useBLEReceive(isOnline: boolean): BLEReceiveState & BLEReceiveActions {
  const [status, setStatus] = useState<ReceiveStatus>('idle')
  const [receivedTx, setReceivedTx] = useState<ReceivedTxInfo | null>(null)
  const [myPeerId, setMyPeerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleIncomingTx = useCallback(
    async (signedTx: string) => {
      setStatus('validating')
      console.log('[Receive] Got full tx, validating...')

      const validation = validateSignedTransaction(signedTx)
      if (!validation.valid) {
        console.error('[Receive] Invalid tx:', validation.error)
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

      // Persist for auto-broadcast on reconnect
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

      if (isOnline) {
        setStatus('broadcasting')
        try {
          const hash = await broadcastTransaction(signedTx)
          setReceivedTx((prev) => (prev ? { ...prev, hash: hash ?? null } : prev))
          setStatus('confirmed')
        } catch (err: any) {
          console.warn('[Receive] Broadcast failed, queued:', err.message)
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
      setStatus('starting')
      setError(null)

      // Set message handler BEFORE starting so we don't miss any
      bleAdapter.setHandlers({
        onTransactionReceived: (tx) => {
          setStatus('receiving')
          handleIncomingTx(tx)
        },
        onTransactionError: (err) => {
          setError(err)
          setStatus('error')
        },
      })

      await bleAdapter.start()
      setMyPeerId(bleAdapter.getMyPeerId())

      // Start listening for incoming chunked messages
      bleAdapter.listenForMessages()

      setStatus('listening')
      console.log('[Receive] BLE mesh started, listening for transfers...')
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }, [handleIncomingTx])

  const stopListening = useCallback(() => {
    bleAdapter.stop()
    setStatus('idle')
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setReceivedTx(null)
    setError(null)
  }, [])

  return { status, receivedTx, myPeerId, error, startListening, stopListening, reset }
}
