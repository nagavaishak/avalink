import { ethers } from 'ethers'
import { ACTIVE_NETWORK } from '../../constants/avalanche'

export interface TxValidationResult {
  valid: boolean
  parsedTx?: ethers.Transaction
  from?: string
  to?: string
  valueEther?: string
  error?: string
}

/**
 * Parse and validate a signed EVM transaction.
 * Used by the relay (Phone B) before queuing an incoming BLE transaction.
 */
export function validateSignedTransaction(signedTx: string): TxValidationResult {
  try {
    const parsed = ethers.Transaction.from(signedTx)

    if (!parsed.to) {
      return { valid: false, error: 'Missing recipient address' }
    }
    if (!parsed.signature) {
      return { valid: false, error: 'Transaction is not signed' }
    }
    if (
      parsed.chainId !== BigInt(ACTIVE_NETWORK.chainId) &&
      parsed.chainId !== 43114n // also accept mainnet sigs
    ) {
      return { valid: false, error: `Wrong chain ID: ${parsed.chainId} (expected ${ACTIVE_NETWORK.chainId})` }
    }

    const valueEther = ethers.formatEther(parsed.value ?? 0n)

    return {
      valid: true,
      parsedTx: parsed,
      from: parsed.from ?? undefined,
      to: parsed.to,
      valueEther,
    }
  } catch (err: any) {
    return { valid: false, error: `Invalid transaction format: ${err.message}` }
  }
}

/**
 * Check whether a transaction hash has been confirmed on-chain.
 * Returns null if not yet found, or the receipt if confirmed.
 */
export async function checkConfirmation(
  txHash: string
): Promise<ethers.TransactionReceipt | null> {
  try {
    const provider = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl)
    return await provider.getTransactionReceipt(txHash)
  } catch {
    return null
  }
}
