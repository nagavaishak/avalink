import * as Crypto from 'expo-crypto'
import { BLE } from '../../constants/avalanche'

const METADATA_PREFIX = 'AVA_META:'
const CHUNK_PREFIX = 'AVA_CHUNK:'
const COMPLETE_PREFIX = 'AVA_DONE:'

interface TransferMeta {
  transferId: string
  totalSize: number
  totalChunks: number
  sha256: string
}

interface PendingTransfer {
  meta: TransferMeta
  chunks: Map<number, string>
  receivedAt: number
}

/**
 * Handles chunking large signed transactions for BLE transport.
 *
 * BLE MTU is typically 20–512 bytes. We chunk at 300 chars and include
 * a SHA-256 integrity check to detect corruption in transit.
 *
 * Protocol:
 *  1. AVA_META:{json} — metadata + integrity hash
 *  2. AVA_CHUNK:{json} — indexed chunk
 *  3. AVA_DONE:{transferId} — signals completion, triggers reassembly + verification
 */
export class AvaLinkTransactionChunker {
  private pendingTransfers = new Map<string, PendingTransfer>()

  /**
   * Chunk and send a signed transaction.
   * `sendFn` is transport-agnostic — inject BLE send here.
   */
  async sendChunkedTransaction(
    signedTx: string,
    sendFn: (msg: string) => Promise<void>
  ): Promise<string> {
    const transferId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const chunks = this.chunkString(signedTx, BLE.CHUNK_SIZE)

    // Compute SHA-256 integrity hash before sending
    const sha256 = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      signedTx
    )

    // 1. Metadata frame — includes hash for receiver-side integrity check
    await sendFn(
      `${METADATA_PREFIX}${JSON.stringify({
        transferId,
        totalSize: signedTx.length,
        totalChunks: chunks.length,
        sha256,
      } as TransferMeta)}`
    )
    await delay(BLE.METADATA_DELAY_MS)

    // 2. Data chunks with inter-chunk delay to avoid BLE stack overflow
    for (let i = 0; i < chunks.length; i++) {
      await sendFn(
        `${CHUNK_PREFIX}${JSON.stringify({
          transferId,
          chunkIndex: i,
          totalChunks: chunks.length,
          data: chunks[i],
        })}`
      )
      if (i < chunks.length - 1) await delay(BLE.CHUNK_DELAY_MS)
    }

    // 3. Completion signal
    await sendFn(`${COMPLETE_PREFIX}${transferId}`)

    return transferId
  }

  /**
   * Process an incoming BLE message.
   * Returns true if the message was part of the AvaLink protocol.
   * Calls onComplete when a full transaction has been reassembled + verified.
   * Calls onError if data is corrupted or invalid.
   */
  async handleIncomingMessage(
    message: string,
    onComplete: (signedTx: string) => void,
    onError: (error: string) => void
  ): Promise<boolean> {
    // Metadata frame — start a new transfer
    if (message.startsWith(METADATA_PREFIX)) {
      const meta = JSON.parse(message.slice(METADATA_PREFIX.length)) as TransferMeta
      this.pendingTransfers.set(meta.transferId, {
        meta,
        chunks: new Map(),
        receivedAt: Date.now(),
      })
      this.cleanupStaleTransfers()
      return true
    }

    // Data chunk — store by index
    if (message.startsWith(CHUNK_PREFIX)) {
      const chunk = JSON.parse(message.slice(CHUNK_PREFIX.length)) as {
        transferId: string
        chunkIndex: number
        totalChunks: number
        data: string
      }
      const pending = this.pendingTransfers.get(chunk.transferId)
      if (pending) {
        pending.chunks.set(chunk.chunkIndex, chunk.data)
      }
      return true
    }

    // Completion signal — reassemble and verify
    if (message.startsWith(COMPLETE_PREFIX)) {
      const transferId = message.slice(COMPLETE_PREFIX.length)
      const pending = this.pendingTransfers.get(transferId)

      if (!pending) return true

      // Check all chunks arrived
      if (pending.chunks.size !== pending.meta.totalChunks) {
        this.pendingTransfers.delete(transferId)
        onError(
          `Missing chunks: received ${pending.chunks.size}/${pending.meta.totalChunks}. Please retry.`
        )
        return true
      }

      // Reassemble in order
      const reassembled = Array.from(
        { length: pending.meta.totalChunks },
        (_, i) => pending.chunks.get(i) ?? ''
      ).join('')

      // Size sanity check
      if (reassembled.length !== pending.meta.totalSize) {
        this.pendingTransfers.delete(transferId)
        onError('Reassembly size mismatch — data corrupted in transit. Please retry.')
        return true
      }

      // SHA-256 integrity verification
      const receivedHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        reassembled
      )

      if (receivedHash !== pending.meta.sha256) {
        this.pendingTransfers.delete(transferId)
        onError('Integrity check failed — data corrupted in transit. Please retry.')
        return true
      }

      // All good — deliver to caller
      this.pendingTransfers.delete(transferId)
      onComplete(reassembled)
      return true
    }

    return false // Not an AvaLink protocol message
  }

  /** Remove transfers that have been pending longer than the timeout. */
  private cleanupStaleTransfers(): void {
    const now = Date.now()
    for (const [id, transfer] of this.pendingTransfers) {
      if (now - transfer.receivedAt > BLE.CHUNK_TIMEOUT_MS) {
        this.pendingTransfers.delete(id)
      }
    }
  }

  private chunkString(str: string, size: number): string[] {
    const chunks: string[] = []
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size))
    }
    return chunks
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// Singleton instance — shared across the app
export const bleChunker = new AvaLinkTransactionChunker()
