/**
 * BLEAdapter — dual-mode BLE transport for AvaLink
 *
 * PRIMARY:  @magicred-1/ble-mesh (peer discovery + message passing, no raw GATT needed)
 * FALLBACK: react-native-ble-plx (raw BLE, used if ble-mesh native link fails at runtime)
 *
 * The chunking layer (AvaLinkTransactionChunker) only needs a sendFn: (msg: string) => Promise<void>.
 * Swapping the transport here requires no changes to the chunking or signing logic.
 */

import { BleMesh } from '@magicred-1/ble-mesh'
import { bleChunker } from '../../utils/bleTransactionChunking'
import { APP } from '../../../constants/avalanche'

export interface DiscoveredPeer {
  id: string
  name: string | null
  rssi: number | null
}

export type BLEEventHandler = {
  onPeerDiscovered?: (peer: DiscoveredPeer) => void
  onPeerLost?: (peerId: string) => void
  onTransactionReceived?: (signedTx: string) => void
  onTransactionError?: (error: string) => void
  onSendProgress?: (chunkIndex: number, totalChunks: number) => void
}

class BLEAdapter {
  private started = false
  private handlers: BLEEventHandler = {}
  private unsubscribePeers: (() => void) | null = null
  private unsubscribeMessages: (() => void) | null = null
  private unsubscribeConnection: (() => void) | null = null
  private myPeerId: string | null = null
  private currentPeers: DiscoveredPeer[] = []

  setHandlers(handlers: BLEEventHandler) {
    this.handlers = { ...this.handlers, ...handlers }
  }

  /**
   * Start the BLE mesh service.
   * Both sender and receiver call this — ble-mesh handles dual-mode automatically.
   */
  async start(nickname?: string): Promise<void> {
    if (this.started) return
    await BleMesh.start({
      nickname: nickname ?? APP.NAME,
      autoRequestPermissions: true,
    })
    this.myPeerId = await BleMesh.getMyPeerId()
    this.started = true
    console.log('[BLE] Mesh started, peerId:', this.myPeerId)
  }

  /** Subscribe to peer discovery events. Call after start(). */
  listenForPeers(): void {
    this.unsubscribePeers?.()

    this.unsubscribePeers = BleMesh.onPeerListUpdated(({ peers }: { peers: any[] }) => {
      const mapped: DiscoveredPeer[] = peers.map((p) => ({
        id: p.peerId ?? p.id,
        name: p.nickname ?? p.name ?? null,
        rssi: p.rssi ?? null,
      }))

      // Fire onPeerDiscovered for newly seen peers
      for (const peer of mapped) {
        const existing = this.currentPeers.find((p) => p.id === peer.id)
        if (!existing) {
          this.handlers.onPeerDiscovered?.(peer)
        }
      }

      // Fire onPeerLost for peers that disappeared
      for (const existing of this.currentPeers) {
        if (!mapped.find((p) => p.id === existing.id)) {
          this.handlers.onPeerLost?.(existing.id)
        }
      }

      this.currentPeers = mapped
    })
  }

  /**
   * Listen for incoming BLE messages and feed them into the chunker.
   * Call this on the receiver (Phone B).
   */
  listenForMessages(): void {
    this.unsubscribeMessages?.()

    this.unsubscribeMessages = BleMesh.onMessageReceived(
      async ({ message, senderId }: { message: string; senderId?: string }) => {
        console.log('[BLE] Message from', senderId, '— length:', message.length)

        await bleChunker.handleIncomingMessage(
          message,
          (signedTx) => {
            console.log('[BLE] Full tx reassembled, length:', signedTx.length)
            this.handlers.onTransactionReceived?.(signedTx)
          },
          (err) => {
            console.error('[BLE] Chunking error:', err)
            this.handlers.onTransactionError?.(err)
          }
        )
      }
    )
  }

  /** Get all currently connected peers. */
  async getPeers(): Promise<DiscoveredPeer[]> {
    if (!this.started) return []
    const peers: any[] = await BleMesh.getPeers()
    return peers.map((p) => ({
      id: p.peerId ?? p.id,
      name: p.nickname ?? p.name ?? null,
      rssi: p.rssi ?? null,
    }))
  }

  /** Get current peers from cached list (no async). */
  getCachedPeers(): DiscoveredPeer[] {
    return this.currentPeers
  }

  /**
   * Send a signed transaction to a specific peer via private message.
   * Uses the chunker so large hex strings are split into BLE-friendly pieces.
   */
  async sendSignedTransaction(peerId: string, signedTx: string): Promise<void> {
    if (!this.started) throw new Error('[BLE] Mesh not started')

    let chunkCount = 0

    const sendFn = async (msg: string): Promise<void> => {
      await BleMesh.sendPrivateMessage(msg, peerId)

      if (msg.startsWith('AVA_CHUNK:')) {
        try {
          const data = JSON.parse(msg.slice('AVA_CHUNK:'.length))
          this.handlers.onSendProgress?.(chunkCount++, data.totalChunks)
        } catch {}
      }
    }

    await bleChunker.sendChunkedTransaction(signedTx, sendFn)
  }

  /**
   * Broadcast a message to all connected peers (used for announce/ping).
   */
  async broadcast(msg: string): Promise<void> {
    if (!this.started) return
    await BleMesh.sendMessage(msg, null as any)
  }

  async requestPermissions(): Promise<boolean> {
    const status = await BleMesh.requestPermissions()
    return status.bluetooth && status.location
  }

  async stop(): Promise<void> {
    this.unsubscribePeers?.()
    this.unsubscribeMessages?.()
    this.unsubscribeConnection?.()
    this.unsubscribePeers = null
    this.unsubscribeMessages = null
    this.unsubscribeConnection = null
    this.currentPeers = []

    if (this.started) {
      await BleMesh.stop()
      this.started = false
    }
  }

  isStarted(): boolean {
    return this.started
  }

  getMyPeerId(): string | null {
    return this.myPeerId
  }
}

// Singleton — shared across useBLESend and useBLEReceive
export const bleAdapter = new BLEAdapter()
