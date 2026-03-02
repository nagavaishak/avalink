import { useState, useCallback, useEffect, useRef } from 'react'
import { bleAdapter, DiscoveredPeer } from '../src/infrastructure/ble/BLEAdapter'

export type SendStatus =
  | 'idle'
  | 'starting'
  | 'scanning'
  | 'sending'
  | 'success'
  | 'error'

export interface BLESendState {
  status: SendStatus
  peers: DiscoveredPeer[]
  progress: { current: number; total: number } | null
  myPeerId: string | null
  error: string | null
}

export interface BLESendActions {
  startMesh: () => Promise<void>
  sendToPeer: (peerId: string, signedTx: string) => Promise<void>
  refreshPeers: () => Promise<void>
  reset: () => void
}

export function useBLESend(): BLESendState & BLESendActions {
  const [status, setStatus] = useState<SendStatus>('idle')
  const [peers, setPeers] = useState<DiscoveredPeer[]>([])
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [myPeerId, setMyPeerId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep peers reactive via handler
  useEffect(() => {
    bleAdapter.setHandlers({
      onPeerDiscovered: (peer) => {
        setPeers((prev) => {
          if (prev.find((p) => p.id === peer.id)) return prev
          return [...prev, peer]
        })
      },
      onPeerLost: (peerId) => {
        setPeers((prev) => prev.filter((p) => p.id !== peerId))
      },
      onSendProgress: (current, total) => {
        setProgress({ current, total })
      },
    })
  }, [])

  const startMesh = useCallback(async () => {
    try {
      setStatus('starting')
      setError(null)
      setPeers([])

      await bleAdapter.start()
      setMyPeerId(bleAdapter.getMyPeerId())

      // Start peer discovery
      bleAdapter.listenForPeers()
      setStatus('scanning')

      // Grab any peers already connected
      const existing = await bleAdapter.getPeers()
      if (existing.length > 0) setPeers(existing)
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }, [])

  const refreshPeers = useCallback(async () => {
    const fresh = await bleAdapter.getPeers()
    setPeers(fresh)
  }, [])

  const sendToPeer = useCallback(async (peerId: string, signedTx: string) => {
    try {
      setStatus('sending')
      setError(null)
      setProgress({ current: 0, total: 0 })

      bleAdapter.setHandlers({
        onSendProgress: (current, total) => setProgress({ current, total }),
      })

      await bleAdapter.sendSignedTransaction(peerId, signedTx)
      setStatus('success')
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }, [])

  const reset = useCallback(() => {
    setStatus('idle')
    setPeers([])
    setProgress(null)
    setError(null)
  }, [])

  return { status, peers, progress, myPeerId, error, startMesh, sendToPeer, refreshPeers, reset }
}
