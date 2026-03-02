import { useState, useCallback } from 'react'
import { bleAdapter } from '../src/infrastructure/ble/BLEAdapter'
import { validateSignedTransaction } from '../src/utils/nonceManager'
import { savePendingTransaction } from '../src/infrastructure/chain/AvalancheBroadcaster'
import { broadcastTransaction } from '../src/utils/offlineSigning'

export type ReceiveStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'receiving'   // chunks arriving
  | 'validating'  // reassembly complete, checking signature + chain
  | 'rejected'    // reassembly OK but validation failed (bad chain, sig, value, etc.)
  | 'queued'      // stored, waiting for internet
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
  /** Chunks received so far in the active incoming transfer */
  chunksReceived: number
  /** Total chunks expected in the active incoming transfer */
  totalChunks: number
  error: string | null
}

export interface BLEReceiveActions {
  startListening: () => Promise<void>
  stopListening: () => void
  reset: () => void
}

/**
 * Receiver side (Phone B):
 * - Starts BLE mesh (advertising happens automatically in ble-mesh)
 * - Reassembles chunked incoming transaction
 * - Exposes real-time chunk progress (chunksReceived / totalChunks)
 * - Validates signed tx (chain ID, signature, recipient)
 * - Queues in AsyncStorage for auto-broadcast
 * - Auto-broadcasts if already online when tx arrives
 */
export function useBLEReceive(isOnline: boolean): BLEReceiveState & BLEReceiveActions {
  const [status, setStatus] = useState<ReceiveStatus>('idle')
  const [receivedTx, setReceivedTx] = useState<ReceivedTxInfo | null>(null)
  const [myPeerId, setMyPeerId] = useState<string | null>(null)
  const [chunksReceived, setChunksReceived] = useState(0)
  const [totalChunks, setTotalChunks] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const handleIncomingTx = useCallback(
    async (signedTx: string) => {
      setStatus('validating')
      setChunksReceived(0)
      setTotalChunks(0)
      console.log('[Receive] Full tx reassembled, validating...')

      const validation = validateSignedTransaction(signedTx)
      if (!validation.valid) {
        console.error('[Receive] Rejected tx:', validation.error)
        setError(validation.error ?? 'Invalid transaction received')
        setStatus('rejected')
        return
      }

      const txInfo: ReceivedTxInfo = {
        signedTx,
        from: validation.from,
        to: validation.to,
        valueEther: validation.valueEther,
        hash: null,
      }

      // Persist for auto-broadcast on reconnect (relay source)
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
      setChunksReceived(0)
      setTotalChunks(0)

      // Wire handlers BEFORE start() to avoid missing early events
      bleAdapter.setHandlers({
        onTransactionReceived: (tx) => {
          setStatus('receiving')
          handleIncomingTx(tx)
        },
        onTransactionError: (err) => {
          setError(err)
          setStatus('error')
        },
        onReceiveProgress: (received, total) => {
          setStatus('receiving')
          setChunksReceived(received)
          setTotalChunks(total)
        },
      })

      await bleAdapter.start()
      setMyPeerId(bleAdapter.getMyPeerId())
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
    setChunksReceived(0)
    setTotalChunks(0)
    setError(null)
  }, [])

  return {
    status,
    receivedTx,
    myPeerId,
    chunksReceived,
    totalChunks,
    error,
    startListening,
    stopListening,
    reset,
  }
}
