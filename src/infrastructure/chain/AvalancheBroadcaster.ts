import { ethers } from 'ethers'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { ACTIVE_NETWORK, STORAGE_KEYS, SECURE_KEYS } from '../../../constants/avalanche'
import {
  broadcastTransaction,
  cacheNetworkData,
  PendingTransaction,
} from '../../utils/offlineSigning'

/**
 * Read pending transaction from AsyncStorage.
 */
export async function getPendingTransaction(): Promise<PendingTransaction | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_TX)
  if (!raw) return null
  return JSON.parse(raw) as PendingTransaction
}

/**
 * Persist a pending transaction to AsyncStorage.
 */
export async function savePendingTransaction(tx: PendingTransaction): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.PENDING_TX, JSON.stringify(tx))
}

/**
 * Remove pending transaction after successful broadcast or confirmation that
 * the other device already broadcast it.
 */
export async function clearPendingTransaction(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_TX)
}

export interface BroadcastResult {
  hash: string | null
  alreadyBroadcast: boolean
  error?: string
}

/**
 * Attempt to broadcast the pending transaction.
 *
 * Logic:
 * - If sender: try re-sign fallback with private key if nonce is stale
 * - If relay: broadcast as-is (no private key available)
 * - Handles "already known" / "nonce too low" from duplicate broadcast gracefully
 */
export async function attemptBroadcast(): Promise<BroadcastResult> {
  const pending = await getPendingTransaction()
  if (!pending) {
    return { hash: null, alreadyBroadcast: false, error: 'No pending transaction' }
  }

  let privateKey: string | null = null
  if (pending.source === 'sender') {
    privateKey = await SecureStore.getItemAsync(SECURE_KEYS.PRIVATE_KEY)
  }

  try {
    const hash = await broadcastTransaction(
      pending.signedTx,
      privateKey ?? undefined,
      pending.params
    )

    await clearPendingTransaction()

    if (hash === null) {
      // null = already broadcast by the other device
      return { hash: null, alreadyBroadcast: true }
    }

    return { hash, alreadyBroadcast: false }
  } catch (err: any) {
    return { hash: null, alreadyBroadcast: false, error: err.message }
  }
}

/**
 * Poll Avalanche for transaction confirmation.
 * Resolves when the tx has >= 1 confirmation, or rejects after timeout.
 */
export async function waitForConfirmation(
  txHash: string,
  timeoutMs = 60_000
): Promise<ethers.TransactionReceipt> {
  const provider = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const receipt = await provider.getTransactionReceipt(txHash)
    if (receipt && receipt.status !== null) {
      return receipt
    }
    await new Promise<void>((r) => setTimeout(r, 2000))
  }

  throw new Error(`Transaction not confirmed within ${timeoutMs / 1000}s`)
}

/** Build the Snowtrace explorer link for a transaction. */
export function getExplorerUrl(txHash: string): string {
  return `${ACTIVE_NETWORK.explorerUrl}/tx/${txHash}`
}
