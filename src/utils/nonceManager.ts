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
 *
 * Rejection reasons (Day 5):
 *   - Unparseable hex (malformed / corrupted in transit)
 *   - Not signed / signature unrecoverable
 *   - Wrong chain ID (not Fuji 43113 or mainnet 43114)
 *   - Not EIP-1559 type 2 (we never sign legacy txs)
 *   - Gas limit below ETH transfer minimum (21 000)
 *   - Zero-value transfer (nothing to relay)
 *   - Cannot recover sender address (broken signature)
 */
export function validateSignedTransaction(signedTx: string): TxValidationResult {
  try {
    const parsed = ethers.Transaction.from(signedTx)

    if (!parsed.signature) {
      return { valid: false, error: 'Transaction is not signed' }
    }

    if (!parsed.to) {
      return { valid: false, error: 'Missing recipient address' }
    }

    if (
      parsed.chainId !== BigInt(ACTIVE_NETWORK.chainId) &&
      parsed.chainId !== 43114n
    ) {
      return {
        valid: false,
        error: `Wrong chain ID: ${parsed.chainId} (expected ${ACTIVE_NETWORK.chainId})`,
      }
    }

    // Only relay EIP-1559 transactions (type 2) — we never produce legacy txs
    if (parsed.type !== 2) {
      return {
        valid: false,
        error: `Invalid tx type: ${parsed.type} (expected 2 / EIP-1559)`,
      }
    }

    // Gas limit must cover a basic ETH transfer
    if ((parsed.gasLimit ?? 0n) < 21000n) {
      return {
        valid: false,
        error: `Gas limit too low: ${parsed.gasLimit} (min 21 000)`,
      }
    }

    // Refuse zero-value transactions — nothing useful to relay
    if ((parsed.value ?? 0n) === 0n) {
      return { valid: false, error: 'Zero-value transaction — nothing to relay' }
    }

    // from is recovered from the signature by ethers; null means the sig is broken
    if (!parsed.from) {
      return { valid: false, error: 'Cannot recover sender — signature is invalid' }
    }

    const valueEther = ethers.formatEther(parsed.value)

    return {
      valid: true,
      parsedTx: parsed,
      from: parsed.from,
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
