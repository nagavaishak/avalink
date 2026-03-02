import { useState, useCallback, useRef } from 'react'
import { bleAdapter, DiscoveredPeer } from '../src/infrastructure/ble/BLEAdapter'

export type SendStatus =
  | 'idle'
  | 'requesting_permissions'
  | 'scanning'
  | 'connecting'
  | 'sending'
  | 'success'
  | 'error'

export interface BLESendState {
  status: SendStatus
  peers: DiscoveredPeer[]
  progress: { current: number; total: number } | null
  error: string | null
}

export interface BLESendActions {
  startScan: () => Promise<void>
  stopScan: () => void
  sendToPeer: (peerId: string, signedTx: string) => Promise<void>
  reset: () => void
}

export function useBLESend(): BLESendState & BLESendActions {
  const [status, setStatus] = useState<SendStatus>('idle')
  const [peers, setPeers] = useState<DiscoveredPeer[]>([])
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scanTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startScan = useCallback(async () => {
    try {
      setStatus('requesting_permissions')
      setError(null)
      setPeers([])

      const granted = await bleAdapter.requestPermissions()
      if (!granted) {
        setError('Bluetooth permissions denied. Please enable in Settings.')
        setStatus('error')
        return
      }

      await bleAdapter.waitForBluetooth()

      setStatus('scanning')
      bleAdapter.setHandlers({
        onPeerDiscovered: (peer) => {
          setPeers((prev) => {
            // Avoid duplicates
            if (prev.find((p) => p.id === peer.id)) return prev
            return [...prev, peer]
          })
        },
        onSendProgress: (current, total) => {
          setProgress({ current, total })
        },
      })

      bleAdapter.startScanning((peer) => {
        setPeers((prev) => {
          if (prev.find((p) => p.id === peer.id)) return prev
          return [...prev, peer]
        })
      })

      // Auto-stop scan after 30s to save battery
      scanTimeoutRef.current = setTimeout(() => {
        bleAdapter.stopScanning()
        if (status === 'scanning') setStatus('idle')
      }, 30_000)
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    }
  }, [status])

  const stopScan = useCallback(() => {
    bleAdapter.stopScanning()
    if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current)
    setStatus('idle')
  }, [])

  const sendToPeer = useCallback(async (peerId: string, signedTx: string) => {
    try {
      setStatus('connecting')
      setError(null)
      setProgress(null)

      bleAdapter.setHandlers({
        onSendProgress: (current, total) => {
          setProgress({ current, total })
          if (status !== 'sending') setStatus('sending')
        },
      })

      setStatus('sending')
      await bleAdapter.sendSignedTransaction(peerId, signedTx)
      setStatus('success')
    } catch (err: any) {
      setError(err.message)
      setStatus('error')
    } finally {
      bleAdapter.disconnect()
    }
  }, [status])

  const reset = useCallback(() => {
    bleAdapter.stopScanning()
    bleAdapter.disconnect()
    setStatus('idle')
    setPeers([])
    setProgress(null)
    setError(null)
  }, [])

  return { status, peers, progress, error, startScan, stopScan, sendToPeer, reset }
}
