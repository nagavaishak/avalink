/**
 * Test utilities for Day 3 BLE string transfer verification.
 *
 * Generates a REAL offline-signed Fuji testnet transaction using a known
 * test-only private key. No network call required — this exercises the exact
 * same code path as production signing (ethers.js Wallet with no provider).
 *
 * The resulting hex is ~420 chars — spans 2 BLE chunks at CHUNK_SIZE=300.
 * This validates the full pipeline: sign → chunk → transmit → reassemble → verify.
 *
 * WARNING: This private key is public / test-only. Never fund it with real AVAX.
 */

import { ethers } from 'ethers'
import { ACTIVE_NETWORK, GAS } from '../../constants/avalanche'

// Deterministic test-only key — known, never use for real funds
export const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

export const TEST_WALLET = new ethers.Wallet(TEST_PRIVATE_KEY)
export const TEST_ADDRESS = TEST_WALLET.address // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

export const CHUNK_SIZE_OVERRIDE = 80 // Smaller chunks for testing multi-chunk path in dev

export interface TestSignedTx {
  signedTx: string        // Full RLP-encoded hex string
  from: string
  to: string
  amountEther: string
  nonce: number
  chainId: number
  byteLength: number
  chunkCount: number      // How many 300-char chunks it will produce
  chunkCountSmall: number // At 80-char chunk size (forces multi-chunk in test)
}

/**
 * Generate a real offline-signed Fuji EIP-1559 transaction.
 * Uses cached/default gas values — no RPC call needed.
 */
export async function generateTestSignedTx(
  toAddress?: string,
  amountEther?: string,
  nonce?: number
): Promise<TestSignedTx> {
  const to = toAddress ?? '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // known test addr
  const amount = amountEther ?? '0.001'
  const txNonce = nonce ?? 42 // arbitrary test nonce

  // Default gas — 2x buffered (same formula as production cacheNetworkData)
  const maxFeePerGas = ethers.parseUnits('60', 'gwei')       // 30 gwei * 2
  const maxPriorityFeePerGas = ethers.parseUnits('4', 'gwei') // 2 gwei * 2

  const signedTx = await TEST_WALLET.signTransaction({
    to,
    value: ethers.parseEther(amount),
    nonce: txNonce,
    gasLimit: GAS.LIMIT_AVAX_TRANSFER,
    maxFeePerGas,
    maxPriorityFeePerGas,
    chainId: ACTIVE_NETWORK.chainId, // 43113 Fuji
    type: 2,
  })

  const CHUNK_SIZE = 300
  const chunkCount = Math.ceil(signedTx.length / CHUNK_SIZE)
  const chunkCountSmall = Math.ceil(signedTx.length / CHUNK_SIZE_OVERRIDE)

  return {
    signedTx,
    from: TEST_ADDRESS,
    to,
    amountEther: amount,
    nonce: txNonce,
    chainId: ACTIVE_NETWORK.chainId,
    byteLength: signedTx.length,
    chunkCount,
    chunkCountSmall,
  }
}

/**
 * Generate a large multi-chunk test payload by repeating a signed tx.
 * At CHUNK_SIZE=300, this forces 3+ chunks for stress testing.
 */
export async function generateMultiChunkPayload(): Promise<TestSignedTx> {
  const base = await generateTestSignedTx()
  // Repeat the signed tx hex 3x to simulate larger payload (e.g. with data field in future)
  const signedTx = base.signedTx + base.signedTx.slice(2) + base.signedTx.slice(2)
  const CHUNK_SIZE = 300
  return {
    ...base,
    signedTx,
    byteLength: signedTx.length,
    chunkCount: Math.ceil(signedTx.length / CHUNK_SIZE),
    chunkCountSmall: Math.ceil(signedTx.length / CHUNK_SIZE_OVERRIDE),
  }
}

/**
 * Generate a stress-test payload of a given character length.
 * Used to test the chunker with non-tx data of arbitrary size.
 */
export function generateStringPayload(lengthChars: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < lengthChars; i++) {
    result += chars[i % chars.length]
  }
  return result
}
