import { ethers } from 'ethers'
import * as SecureStore from 'expo-secure-store'
import { ACTIVE_NETWORK, GAS, CACHE, SECURE_KEYS } from '../../constants/avalanche'

export interface CachedNetworkData {
  nonce: number
  maxFeePerGas: string
  maxPriorityFeePerGas: string
  cachedAt: number
}

export interface StoredTxParams {
  to: string
  amountEther: string
  from: string
  nonceUsed: number
}

export interface PendingTransaction {
  signedTx: string
  params: StoredTxParams
  createdAt: number
  source: 'sender' | 'relay'
}

/**
 * Fetch nonce + gas from Avalanche Fuji and cache in SecureStore.
 * Call this while online — before going offline.
 */
export async function cacheNetworkData(address: string): Promise<CachedNetworkData> {
  const provider = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl)
  const [nonce, feeData] = await Promise.all([
    provider.getTransactionCount(address),
    provider.getFeeData(),
  ])

  const cached: CachedNetworkData = {
    nonce,
    // 2x buffer so cached gas price stays competitive even if market moves
    maxFeePerGas: (
      (feeData.maxFeePerGas ?? ethers.parseUnits(String(GAS.DEFAULT_MAX_FEE_GWEI), 'gwei')) *
      GAS.BUFFER_MULTIPLIER
    ).toString(),
    maxPriorityFeePerGas: (
      (feeData.maxPriorityFeePerGas ?? ethers.parseUnits(String(GAS.DEFAULT_PRIORITY_FEE_GWEI), 'gwei')) *
      GAS.BUFFER_MULTIPLIER
    ).toString(),
    cachedAt: Date.now(),
  }

  await SecureStore.setItemAsync(SECURE_KEYS.NETWORK_CACHE, JSON.stringify(cached))
  return cached
}

/** Returns the currently cached network data, or null if none stored yet. */
export async function getCachedNetworkData(): Promise<CachedNetworkData | null> {
  const raw = await SecureStore.getItemAsync(SECURE_KEYS.NETWORK_CACHE)
  if (!raw) return null
  return JSON.parse(raw) as CachedNetworkData
}

/** True when cached data is older than 6 hours. */
export function isCacheStale(cached: CachedNetworkData): boolean {
  return Date.now() - cached.cachedAt > CACHE.STALENESS_THRESHOLD_MS
}

/**
 * Sign a transaction completely offline — no network call.
 * Uses cached nonce and gas, then immediately increments nonce in cache
 * so subsequent offline signs use the correct next nonce.
 */
export async function signOffline(
  privateKey: string,
  to: string,
  amountEther: string,
  cached: CachedNetworkData
): Promise<{ signedTx: string; nonceUsed: number }> {
  // Wallet with no provider = purely offline
  const wallet = new ethers.Wallet(privateKey)
  const nonceUsed = cached.nonce

  const signedTx = await wallet.signTransaction({
    to,
    value: ethers.parseEther(amountEther),
    nonce: nonceUsed,
    gasLimit: GAS.LIMIT_AVAX_TRANSFER,
    maxFeePerGas: BigInt(cached.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(cached.maxPriorityFeePerGas),
    chainId: ACTIVE_NETWORK.chainId,
    type: 2, // EIP-1559
  })

  // CRITICAL: Increment nonce immediately so the next offline sign uses nonce+1
  cached.nonce += 1
  await SecureStore.setItemAsync(SECURE_KEYS.NETWORK_CACHE, JSON.stringify(cached))

  return { signedTx, nonceUsed }
}

/**
 * Submit signed transaction to Avalanche C-Chain.
 * Handles:
 *  - Already broadcast by other device (returns null, caller should clear pending)
 *  - Stale nonce: re-signs with fresh nonce if privateKey + params provided
 *  - Real errors: rethrows
 */
export async function broadcastTransaction(
  signedTx: string,
  privateKey?: string,
  params?: StoredTxParams
): Promise<string | null> {
  const provider = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl)

  try {
    const txResponse = await provider.sendTransaction(signedTx)
    // Don't await .wait() — return hash immediately, let UI poll for confirmation
    return txResponse.hash
  } catch (err: any) {
    // Other device already broadcast — this is expected and fine
    if (
      err.message?.includes('already known') ||
      err.message?.includes('nonce too low') ||
      err.code === 'REPLACEMENT_UNDERPRICED'
    ) {
      console.log('[AvaLink] Tx already broadcast by other device')
      return null
    }

    // Nonce is stale — re-sign with fresh nonce if we have the private key
    if (
      privateKey &&
      params &&
      (err.code === 'NONCE_EXPIRED' || err.message?.includes('nonce too low'))
    ) {
      console.warn('[AvaLink] Nonce stale — re-signing with fresh nonce')
      const freshCache = await cacheNetworkData(params.from)
      const { signedTx: freshSignedTx } = await signOffline(
        privateKey,
        params.to,
        params.amountEther,
        freshCache
      )
      const txResponse = await provider.sendTransaction(freshSignedTx)
      return txResponse.hash
    }

    throw err
  }
}

/** Derive the sender address from a signed transaction (no private key needed). */
export function getSenderFromSignedTx(signedTx: string): string | null {
  try {
    const parsed = ethers.Transaction.from(signedTx)
    return parsed.from ?? null
  } catch {
    return null
  }
}
