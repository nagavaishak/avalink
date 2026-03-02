import * as Crypto from 'expo-crypto'
import { BLE } from '../../constants/avalanche'

const METADATA_PREFIX = 'AVA_META:'
const CHUNK_PREFIX = 'AVA_CHUNK:'
const COMPLETE_PREFIX = 'AVA_DONE:'
const ACK_PREFIX = 'AVA_ACK:'

const MAX_SEND_RETRIES = 3
const RETRY_DELAY_MS = 200

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
  lastChunkAt: number
}

export interface ChunkProgress {
  transferId: string
  received: number
  total: number
}

export interface SendOptions {
  /** Override inter-chunk delay in ms (default: BLE.CHUNK_DELAY_MS = 50) */
  chunkDelayMs?: number
  /** Override post-metadata delay in ms (default: BLE.METADATA_DELAY_MS = 100) */
  metaDelayMs?: number
  /** Max retries per chunk on send failure (default: 3) */
  maxRetries?: number
}

/**
 * AvaLink BLE chunking protocol — Day 4 hardened version.
 *
 * Changes from Day 3:
 *  - Retry logic: each chunk retried up to MAX_SEND_RETRIES times on failure
 *  - Progress callback: onProgress(received, total) fires as chunks arrive
 *  - Configurable timing: chunkDelayMs / metaDelayMs overrides for device tuning
 *  - Per-chunk logging: transferId + index tracked throughout
 *  - Missing chunk detection on DONE: lists which indices are absent
 *
 * Protocol (unchanged — backward compat):
 *  1. AVA_META:{json}    — metadata + SHA-256 hash
 *  2. AVA_CHUNK:{json}   — indexed data chunk
 *  3. AVA_DONE:{id}      — completion signal → triggers reassembly + verify
 */
export class AvaLinkTransactionChunker {
  private pendingTransfers = new Map<string, PendingTransfer>()

  /**
   * Chunk and send a signed transaction with retry per chunk.
   * `sendFn` is transport-agnostic (BLE, mock, local loop).
   * Returns the transferId.
   */
  async sendChunkedTransaction(
    signedTx: string,
    sendFn: (msg: string) => Promise<void>,
    options: SendOptions = {}
  ): Promise<string> {
    const {
      chunkDelayMs = BLE.CHUNK_DELAY_MS,
      metaDelayMs = BLE.METADATA_DELAY_MS,
      maxRetries = MAX_SEND_RETRIES,
    } = options

    const transferId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const chunks = this.chunkString(signedTx, BLE.CHUNK_SIZE)

    const sha256 = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      signedTx
    )

    // 1. Metadata
    await this.sendWithRetry(
      `${METADATA_PREFIX}${JSON.stringify({
        transferId,
        totalSize: signedTx.length,
        totalChunks: chunks.length,
        sha256,
      } as TransferMeta)}`,
      sendFn,
      maxRetries
    )
    await delay(metaDelayMs)

    // 2. Data chunks — each retried independently
    for (let i = 0; i < chunks.length; i++) {
      await this.sendWithRetry(
        `${CHUNK_PREFIX}${JSON.stringify({
          transferId,
          chunkIndex: i,
          totalChunks: chunks.length,
          data: chunks[i],
        })}`,
        sendFn,
        maxRetries
      )
      if (i < chunks.length - 1) await delay(chunkDelayMs)
    }

    // 3. Completion signal
    await this.sendWithRetry(`${COMPLETE_PREFIX}${transferId}`, sendFn, maxRetries)

    return transferId
  }

  /**
   * Process one incoming BLE message.
   * Returns true if this was an AvaLink protocol message.
   *
   * @param onComplete   Called when full tx is reassembled and SHA-256 verified
   * @param onError      Called on corruption, missing chunks, or parse failure
   * @param onProgress   Called after each chunk arrives: (receivedCount, totalChunks)
   */
  async handleIncomingMessage(
    message: string,
    onComplete: (signedTx: string) => void,
    onError: (error: string) => void,
    onProgress?: (received: number, total: number) => void
  ): Promise<boolean> {
    // META — initialize transfer state
    if (message.startsWith(METADATA_PREFIX)) {
      try {
        const meta = JSON.parse(message.slice(METADATA_PREFIX.length)) as TransferMeta
        this.pendingTransfers.set(meta.transferId, {
          meta,
          chunks: new Map(),
          receivedAt: Date.now(),
          lastChunkAt: Date.now(),
        })
        this.cleanupStaleTransfers()
      } catch {
        onError('Malformed META message')
      }
      return true
    }

    // CHUNK — accumulate by index
    if (message.startsWith(CHUNK_PREFIX)) {
      try {
        const chunk = JSON.parse(message.slice(CHUNK_PREFIX.length)) as {
          transferId: string
          chunkIndex: number
          totalChunks: number
          data: string
        }
        const pending = this.pendingTransfers.get(chunk.transferId)
        if (pending) {
          pending.chunks.set(chunk.chunkIndex, chunk.data)
          pending.lastChunkAt = Date.now()
          onProgress?.(pending.chunks.size, pending.meta.totalChunks)
        }
      } catch {
        // Malformed chunk — don't crash, let DONE detect missing chunks
      }
      return true
    }

    // DONE — reassemble + verify
    if (message.startsWith(COMPLETE_PREFIX)) {
      const transferId = message.slice(COMPLETE_PREFIX.length)
      const pending = this.pendingTransfers.get(transferId)

      if (!pending) return true

      // Detect missing chunks
      if (pending.chunks.size !== pending.meta.totalChunks) {
        const missing: number[] = []
        for (let i = 0; i < pending.meta.totalChunks; i++) {
          if (!pending.chunks.has(i)) missing.push(i)
        }
        this.pendingTransfers.delete(transferId)
        onError(
          `Missing chunks [${missing.join(', ')}] — got ${pending.chunks.size}/${pending.meta.totalChunks}. Please retry.`
        )
        return true
      }

      // Reassemble in index order
      const reassembled = Array.from(
        { length: pending.meta.totalChunks },
        (_, i) => pending.chunks.get(i) ?? ''
      ).join('')

      // Size check
      if (reassembled.length !== pending.meta.totalSize) {
        this.pendingTransfers.delete(transferId)
        onError(
          `Size mismatch: expected ${pending.meta.totalSize}, got ${reassembled.length}. Data corrupted in transit.`
        )
        return true
      }

      // SHA-256 integrity check
      const receivedHash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        reassembled
      )

      if (receivedHash !== pending.meta.sha256) {
        this.pendingTransfers.delete(transferId)
        onError('SHA-256 integrity check FAILED — data corrupted in transit. Please retry.')
        return true
      }

      // All checks pass
      this.pendingTransfers.delete(transferId)
      onComplete(reassembled)
      return true
    }

    return false // Not an AvaLink protocol message
  }

  /** How many chunks have been received for the active transfer, if any. */
  getActiveTransferProgress(): ChunkProgress | null {
    for (const [transferId, transfer] of this.pendingTransfers) {
      return {
        transferId,
        received: transfer.chunks.size,
        total: transfer.meta.totalChunks,
      }
    }
    return null
  }

  /** Send with up to `maxRetries` attempts, exponential backoff. */
  private async sendWithRetry(
    msg: string,
    sendFn: (msg: string) => Promise<void>,
    maxRetries: number
  ): Promise<void> {
    let lastErr: Error | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await sendFn(msg)
        return
      } catch (err: any) {
        lastErr = err
        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * Math.pow(2, attempt)) // 200ms, 400ms, 800ms
        }
      }
    }
    throw new Error(`Send failed after ${maxRetries + 1} attempts: ${lastErr?.message}`)
  }

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

export const bleChunker = new AvaLinkTransactionChunker()
