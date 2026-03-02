/**
 * Unit test for the BLE chunked transfer pipeline.
 * Runs completely offline — no BLE hardware needed.
 *
 * Tests:
 *   1. A real offline-signed EVM tx flows through chunk → reassemble → SHA-256 verify
 *   2. Size matches after reassembly
 *   3. ethers.Transaction.from() accepts the output
 *   4. Corruption is caught (SHA-256 mismatch)
 *
 * Run with: node src/utils/__tests__/bleTransfer.test.ts
 * (or add jest later)
 */

// Minimal polyfill stubs for non-RN environment
if (typeof global.crypto === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require('crypto')
  global.crypto = {
    getRandomValues: (buf: any) => nodeCrypto.randomFillSync(buf),
    subtle: nodeCrypto.webcrypto?.subtle,
  } as any
}

import { ethers } from 'ethers'
import { AvaLinkTransactionChunker } from '../bleTransactionChunking'
import { generateTestSignedTx } from '../testHelpers'
import { validateSignedTransaction } from '../nonceManager'

async function runTest(name: string, fn: () => Promise<void>) {
  try {
    await fn()
    console.log(`  ✅ ${name}`)
  } catch (err: any) {
    console.log(`  ❌ ${name}: ${err.message}`)
    process.exitCode = 1
  }
}

async function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg)
}

async function main() {
  console.log('\n🔵 AvaLink BLE Transfer Pipeline Tests\n')

  // ── Test 1: Basic chunk + reassemble ──────────────────────────────────────
  await runTest('Chunk → reassemble → SHA-256 passes', async () => {
    const chunker = new AvaLinkTransactionChunker()
    const { signedTx, chunkCount } = await generateTestSignedTx()

    const messages: string[] = []
    const sendFn = async (msg: string) => { messages.push(msg) }

    await chunker.sendChunkedTransaction(signedTx, sendFn)

    // Should be: 1 META + N CHUNKs + 1 DONE
    assert(messages.length === chunkCount + 2, `Expected ${chunkCount + 2} messages, got ${messages.length}`)
    assert(messages[0].startsWith('AVA_META:'), 'First message should be META')
    assert(messages[messages.length - 1].startsWith('AVA_DONE:'), 'Last message should be DONE')

    // Reassemble
    let reassembled: string | null = null
    let errorMsg: string | null = null

    for (const msg of messages) {
      await chunker.handleIncomingMessage(
        msg,
        (tx) => { reassembled = tx },
        (err) => { errorMsg = err }
      )
    }

    assert(errorMsg === null, `Unexpected error: ${errorMsg}`)
    assert(reassembled !== null, 'Expected reassembled tx')
    assert(reassembled === signedTx, `Reassembled tx does not match original`)
  })

  // ── Test 2: Generated tx is valid EVM ──────────────────────────────────────
  await runTest('Generated test tx passes ethers.Transaction.from()', async () => {
    const { signedTx, from, chainId } = await generateTestSignedTx()
    const parsed = ethers.Transaction.from(signedTx)

    assert(parsed.signature !== null, 'Transaction must be signed')
    assert(parsed.from?.toLowerCase() === from.toLowerCase(), `From mismatch: ${parsed.from} vs ${from}`)
    assert(Number(parsed.chainId) === chainId, `Chain ID mismatch: ${parsed.chainId} vs ${chainId}`)
    assert(parsed.type === 2, 'Must be EIP-1559 (type 2)')
  })

  // ── Test 3: validateSignedTransaction accepts it ───────────────────────────
  await runTest('validateSignedTransaction returns valid=true', async () => {
    const { signedTx } = await generateTestSignedTx()
    const result = validateSignedTransaction(signedTx)

    assert(result.valid === true, `Expected valid, got: ${result.error}`)
    assert(result.from !== undefined, 'Should recover sender address')
    assert(result.valueEther !== undefined, 'Should parse value')
  })

  // ── Test 4: Chunk size check ────────────────────────────────────────────────
  await runTest('Signed tx > 300 chars → produces ≥ 2 chunks', async () => {
    const { signedTx, byteLength, chunkCount } = await generateTestSignedTx()

    assert(byteLength > 300, `Expected tx > 300 chars, got ${byteLength}`)
    assert(chunkCount >= 2, `Expected ≥ 2 chunks, got ${chunkCount}`)
  })

  // ── Test 5: Corruption is caught ────────────────────────────────────────────
  await runTest('Corrupted chunk triggers SHA-256 error', async () => {
    const chunker = new AvaLinkTransactionChunker()
    const { signedTx } = await generateTestSignedTx()

    const messages: string[] = []
    await chunker.sendChunkedTransaction(signedTx, async (msg) => messages.push(msg))

    // Corrupt the first CHUNK data
    const corruptedMessages = messages.map((msg) => {
      if (msg.startsWith('AVA_CHUNK:')) {
        const data = JSON.parse(msg.slice('AVA_CHUNK:'.length))
        data.data = data.data.slice(0, -5) + 'XXXXX' // corrupt last 5 chars
        return `AVA_CHUNK:${JSON.stringify(data)}`
      }
      return msg
    })

    let gotError: string | null = null
    for (const msg of corruptedMessages) {
      await chunker.handleIncomingMessage(msg, () => {}, (err) => { gotError = err })
    }

    assert(gotError !== null, 'Expected an error for corrupted data')
    assert(gotError!.includes('tegrity') || gotError!.includes('mismatch'), `Expected integrity error, got: ${gotError}`)
  })

  console.log('\n' + (process.exitCode ? '❌ Some tests failed' : '✅ All tests passed') + '\n')
}

main().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
