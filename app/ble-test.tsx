/**
 * BLE Transfer Test Screen — Day 2 + Day 3 + Day 4
 *
 * Day 2 goal: Two phones discover each other (peer list updates)
 * Day 3 goal: Full chunked string transfer Phone A → Phone B with SHA-256 verification
 * Day 4 goal: Local pipeline self-test (no second phone needed), chunk progress bar, retry hardening
 *
 * The test exercises the exact same pipeline as production:
 *   signedTx → AvaLinkTransactionChunker → BLE messages → reassemble → SHA-256 verify → ethers.Transaction.from()
 */
import React, { useState, useRef, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Switch,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { BleMesh } from '@magicred-1/ble-mesh'
import { bleAdapter } from '../src/infrastructure/ble/BLEAdapter'
import { bleChunker } from '../src/utils/bleTransactionChunking'
import { validateSignedTransaction } from '../src/utils/nonceManager'
import { generateTestSignedTx, generateMultiChunkPayload, TestSignedTx } from '../src/utils/testHelpers'

// ─── Types ───────────────────────────────────────────────────────────────────

interface LogEntry {
  id: number
  ts: number
  level: 'info' | 'success' | 'error' | 'warn' | 'chunk'
  msg: string
}

interface Peer {
  id: string
  name: string | null
}

type TransferStatus =
  | 'idle'
  | 'generating'
  | 'sending'
  | 'done'
  | 'failed'

interface ChunkProgress {
  sent: number
  total: number
}

// ─── Component ───────────────────────────────────────────────────────────────

let logId = 0

export default function BLETestScreen() {
  const router = useRouter()

  // Mesh state
  const [running, setRunning] = useState(false)
  const [myPeerId, setMyPeerId] = useState<string | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)

  // Transfer state
  const [testPayload, setTestPayload] = useState<TestSignedTx | null>(null)
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('idle')
  const [chunkProgress, setChunkProgress] = useState<ChunkProgress | null>(null)
  const [receivedResult, setReceivedResult] = useState<{
    raw: string
    valid: boolean
    error?: string
    from?: string
    to?: string
    valueEther?: string
  } | null>(null)

  // Mode: receiver listens for chunks, sender sends
  const [isReceiver, setIsReceiver] = useState(false)

  // Local self-test (Day 4)
  const [selfTestStatus, setSelfTestStatus] = useState<'idle' | 'running' | 'pass' | 'fail'>('idle')
  const [selfTestResult, setSelfTestResult] = useState<{
    sha256: boolean
    validation: boolean
    from?: string
    valueEther?: string
    payloadLen: number
    chunks: number
    error?: string
  } | null>(null)

  // Validation rejection test (Day 5)
  const [rejectionResults, setRejectionResults] = useState<Array<{
    label: string
    rejected: boolean
    reason: string
  }> | null>(null)

  // Simple ping test
  const [pingMsg, setPingMsg] = useState('ping')

  // Logs
  const [logs, setLogs] = useState<LogEntry[]>([])
  const unsubRefs = useRef<Array<() => void>>([])

  // ── Logging ──────────────────────────────────────────────────────────────

  const log = useCallback((msg: string, level: LogEntry['level'] = 'info') => {
    const entry: LogEntry = { id: ++logId, ts: Date.now(), level, msg }
    setLogs((prev) => [entry, ...prev].slice(0, 150))
    console.log(`[BLE-DAY3][${level}] ${msg}`)
  }, [])

  // ── Mesh lifecycle ────────────────────────────────────────────────────────

  async function startMesh() {
    try {
      log('Requesting BLE permissions...')
      const perms = await BleMesh.requestPermissions()
      log(
        `Permissions — BT:${perms.bluetooth} LOC:${perms.location}`,
        perms.bluetooth && perms.location ? 'success' : 'error'
      )
      if (!perms.bluetooth || !perms.location) return

      log('Starting BleMesh...')
      await BleMesh.start({ nickname: 'AvaLink', autoRequestPermissions: false })
      const pid = await BleMesh.getMyPeerId()
      setMyPeerId(pid)
      log(`Mesh started — my ID: ${pid.slice(0, 16)}...`, 'success')
      setRunning(true)

      // Peer discovery
      const u1 = BleMesh.onPeerListUpdated(({ peers: newPeers }: { peers: any[] }) => {
        const mapped: Peer[] = newPeers.map((p: any) => ({
          id: p.peerId ?? p.id,
          name: p.nickname ?? p.name ?? 'AvaLink Device',
        }))
        setPeers(mapped)
        if (mapped.length > 0) {
          log(`${mapped.length} peer(s): ${mapped.map((p) => p.name).join(', ')}`, 'success')
        }
      })
      unsubRefs.current.push(u1)

      // Connection state
      const u2 = BleMesh.onConnectionStateChanged(({ peerId: pid2, state }: any) => {
        log(`${state.toUpperCase()}: ${pid2?.slice(0, 12)}...`, state === 'connected' ? 'success' : 'warn')
      })
      unsubRefs.current.push(u2)

      // ── Receive side: feed ALL incoming messages into the chunker ──
      const u3 = BleMesh.onMessageReceived(async ({ message, senderId }: any) => {
        const isChunkProtocol =
          message.startsWith('AVA_META:') ||
          message.startsWith('AVA_CHUNK:') ||
          message.startsWith('AVA_DONE:')

        if (isChunkProtocol) {
          // Determine chunk type for logging
          if (message.startsWith('AVA_META:')) {
            log(`[RX] META received — starting reassembly`, 'chunk')
          } else if (message.startsWith('AVA_CHUNK:')) {
            try {
              const d = JSON.parse(message.slice('AVA_CHUNK:'.length))
              log(`[RX] Chunk ${d.chunkIndex + 1}/${d.totalChunks} received`, 'chunk')
            } catch {}
          } else if (message.startsWith('AVA_DONE:')) {
            log(`[RX] DONE signal — verifying SHA-256...`, 'chunk')
          }

          // Hand off to chunker — it handles reassembly + SHA-256 check
          await bleChunker.handleIncomingMessage(
            message,
            (signedTx) => {
              log(`[RX] ✅ Reassembled ${signedTx.length} chars — verifying...`, 'success')
              const validation = validateSignedTransaction(signedTx)
              if (validation.valid) {
                log(`[RX] ✅ Valid EVM tx — from ${validation.from?.slice(0, 10)}...`, 'success')
                log(`[RX] Amount: ${validation.valueEther} AVAX to ${validation.to?.slice(0, 10)}...`, 'success')
                setReceivedResult({
                  raw: signedTx,
                  valid: true,
                  from: validation.from,
                  to: validation.to,
                  valueEther: validation.valueEther,
                })
              } else {
                log(`[RX] ❌ Validation failed: ${validation.error}`, 'error')
                setReceivedResult({ raw: signedTx, valid: false, error: validation.error })
              }
            },
            (err) => {
              log(`[RX] ❌ Chunk integrity error: ${err}`, 'error')
              setReceivedResult({ raw: '', valid: false, error: err })
            }
          )
        } else {
          // Plain message (ping)
          log(`[RX] "${message}" from ${senderId?.slice(0, 8) ?? '?'}`, 'success')
        }
      })
      unsubRefs.current.push(u3)

      log('Ready — select a peer to begin transfer test', 'info')
    } catch (err: any) {
      log(`Start failed: ${err.message}`, 'error')
    }
  }

  async function stopMesh() {
    for (const u of unsubRefs.current) u()
    unsubRefs.current = []
    await BleMesh.stop()
    setRunning(false)
    setMyPeerId(null)
    setPeers([])
    setSelectedPeer(null)
    setTestPayload(null)
    setTransferStatus('idle')
    setChunkProgress(null)
    log('Mesh stopped', 'warn')
  }

  // ── Ping test ─────────────────────────────────────────────────────────────

  async function sendPing(peerId?: string) {
    try {
      if (peerId) {
        await BleMesh.sendPrivateMessage(pingMsg, peerId)
        log(`[TX] Ping → ${peerId.slice(0, 8)}...`, 'info')
      } else {
        await BleMesh.sendMessage(pingMsg, null as any)
        log(`[TX] Broadcast: "${pingMsg}"`, 'info')
      }
    } catch (err: any) {
      log(`Ping failed: ${err.message}`, 'error')
    }
  }

  // ── Full transfer test ────────────────────────────────────────────────────

  async function generatePayload() {
    try {
      setTransferStatus('generating')
      log('Generating real offline-signed Fuji tx...')
      const payload = await generateTestSignedTx()
      setTestPayload(payload)
      log(`Generated: ${payload.byteLength} chars → ${payload.chunkCount} chunk(s) @ 300 chars`, 'success')
      log(`From: ${payload.from.slice(0, 10)}...  To: ${payload.to.slice(0, 10)}...  ${payload.amountEther} AVAX`, 'info')
      setTransferStatus('idle')
    } catch (err: any) {
      log(`Generate failed: ${err.message}`, 'error')
      setTransferStatus('failed')
    }
  }

  async function generateMultiChunkTestPayload() {
    try {
      setTransferStatus('generating')
      log('Generating multi-chunk stress payload...')
      const payload = await generateMultiChunkPayload()
      setTestPayload(payload)
      log(`Generated: ${payload.byteLength} chars → ${payload.chunkCount} chunk(s) @ 300 chars`, 'success')
      log(`(Stress test: tx repeated to force multi-chunk path)`, 'info')
      setTransferStatus('idle')
    } catch (err: any) {
      log(`Generate failed: ${err.message}`, 'error')
      setTransferStatus('failed')
    }
  }

  async function runTransferTest() {
    if (!selectedPeer) { log('Select a peer first', 'warn'); return }
    if (!testPayload) { log('Generate payload first', 'warn'); return }

    try {
      setTransferStatus('sending')
      setChunkProgress({ sent: 0, total: testPayload.chunkCount })
      setReceivedResult(null)
      log(`[TX] Starting chunked transfer to ${selectedPeer.slice(0, 8)}...`)
      log(`[TX] Payload: ${testPayload.byteLength} chars → ${testPayload.chunkCount} chunks`)

      // Use bleAdapter which wraps the chunker with sendPrivateMessage
      bleAdapter.setHandlers({
        onSendProgress: (current, total) => {
          setChunkProgress({ sent: current + 1, total })
          log(`[TX] Chunk ${current + 1}/${total} sent`, 'chunk')
        },
      })

      await bleAdapter.sendSignedTransaction(selectedPeer, testPayload.signedTx)

      log(`[TX] ✅ All chunks sent — waiting for receiver to reassemble`, 'success')
      setTransferStatus('done')
    } catch (err: any) {
      log(`[TX] Transfer failed: ${err.message}`, 'error')
      setTransferStatus('failed')
    }
  }

  // ── Local self-test (Day 4) ───────────────────────────────────────────────

  async function runLocalSelfTest() {
    setSelfTestStatus('running')
    setSelfTestResult(null)
    log('[SELF] Starting local pipeline self-test...', 'info')

    try {
      const payload = await generateTestSignedTx()
      log(`[SELF] Generated: ${payload.byteLength} chars → ${payload.chunkCount} chunk(s)`, 'info')

      let completed = false
      let failed = false
      let resultFrom: string | undefined
      let resultValueEther: string | undefined
      let resultError: string | undefined

      // Loopback sendFn: each message is immediately fed back into the chunker
      const loopbackSendFn = async (msg: string): Promise<void> => {
        await bleChunker.handleIncomingMessage(
          msg,
          (signedTx) => {
            log(`[SELF] ✅ Reassembled ${signedTx.length} chars — SHA-256 passed`, 'success')
            const v = validateSignedTransaction(signedTx)
            if (v.valid) {
              completed = true
              resultFrom = v.from
              resultValueEther = v.valueEther
              log(`[SELF] ✅ Signature valid — from ${v.from?.slice(0, 10)}... ${v.valueEther} AVAX`, 'success')
            } else {
              failed = true
              resultError = v.error
              log(`[SELF] ❌ Validation failed: ${v.error}`, 'error')
            }
          },
          (err) => {
            failed = true
            resultError = err
            log(`[SELF] ❌ Chunk error: ${err}`, 'error')
          }
        )
      }

      await bleChunker.sendChunkedTransaction(payload.signedTx, loopbackSendFn)

      if (completed) {
        setSelfTestStatus('pass')
        setSelfTestResult({
          sha256: true,
          validation: true,
          from: resultFrom,
          valueEther: resultValueEther,
          payloadLen: payload.byteLength,
          chunks: payload.chunkCount,
        })
        log('[SELF] ✅ ALL CHECKS PASSED — pipeline is solid', 'success')
      } else if (failed) {
        setSelfTestStatus('fail')
        setSelfTestResult({
          sha256: false,
          validation: false,
          payloadLen: payload.byteLength,
          chunks: payload.chunkCount,
          error: resultError,
        })
        log(`[SELF] ❌ Self-test failed: ${resultError}`, 'error')
      } else {
        setSelfTestStatus('fail')
        setSelfTestResult({
          sha256: false,
          validation: false,
          payloadLen: payload.byteLength,
          chunks: payload.chunkCount,
          error: 'No completion callback fired — chunker did not call onComplete',
        })
        log('[SELF] ❌ No completion callback fired', 'error')
      }
    } catch (err: any) {
      setSelfTestStatus('fail')
      setSelfTestResult({
        sha256: false,
        validation: false,
        payloadLen: 0,
        chunks: 0,
        error: err.message,
      })
      log(`[SELF] ❌ Exception: ${err.message}`, 'error')
    }
  }

  // ── Validation rejection test (Day 5) ────────────────────────────────────

  function runRejectionTest() {
    log('[VAL] Running validation rejection tests...', 'info')

    const cases: Array<{ label: string; input: string }> = [
      { label: 'Random garbage bytes', input: 'not_a_tx_at_all' },
      { label: 'Empty string', input: '' },
      { label: 'Truncated hex', input: '0x02f8' },
      { label: 'All zeros (64 bytes)', input: '0x' + '00'.repeat(64) },
    ]

    const results = cases.map(({ label, input }) => {
      const result = validateSignedTransaction(input)
      const rejected = !result.valid
      const reason = rejected ? (result.error ?? 'unknown') : 'ACCEPTED (unexpected!)'
      if (rejected) {
        log(`[VAL] ✅ "${label}" → rejected: ${reason}`, 'success')
      } else {
        log(`[VAL] ❌ "${label}" → SHOULD have been rejected`, 'error')
      }
      return { label, rejected, reason }
    })

    setRejectionResults(results)
    const allRejected = results.every((r) => r.rejected)
    log(
      allRejected
        ? '[VAL] ✅ All malformed inputs correctly rejected'
        : '[VAL] ❌ Some inputs were not rejected — check validation logic',
      allRejected ? 'success' : 'error'
    )
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  function logColor(level: LogEntry['level']): string {
    switch (level) {
      case 'success': return '#22C55E'
      case 'error':   return '#EF4444'
      case 'warn':    return '#F59E0B'
      case 'chunk':   return '#8B5CF6'
      default:        return '#8B9AB2'
    }
  }

  function statusColor(s: TransferStatus): string {
    switch (s) {
      case 'done':      return '#22C55E'
      case 'failed':    return '#EF4444'
      case 'sending':   return '#8B5CF6'
      case 'generating': return '#F59E0B'
      default:          return '#8B9AB2'
    }
  }

  const sendDisabled = !running || !selectedPeer || !testPayload || transferStatus === 'sending'

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView className="flex-1">

        {/* Header */}
        <View className="px-4 pt-4 pb-3 flex-row items-center justify-between border-b border-border">
          <View>
            <Text className="text-white font-bold text-lg">BLE Transfer Test</Text>
            <Text className="text-text-muted text-xs">Day 4 — retry hardening + local self-test</Text>
          </View>
          <Pressable
            onPress={() => router.back()}
            className="px-3 py-1.5 bg-card rounded-lg border border-border"
          >
            <Text className="text-text-secondary text-sm">← Back</Text>
          </Pressable>
        </View>

        <View className="px-4 py-4 gap-4">

          {/* ── 1. Mesh Control ── */}
          <View className="bg-card border border-border rounded-xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                <View className={`w-2.5 h-2.5 rounded-full ${running ? 'bg-success' : 'bg-error'}`} />
                <Text className="text-white font-semibold">
                  {running ? 'Mesh Active' : 'Mesh Stopped'}
                </Text>
              </View>
              <Pressable
                className={`px-4 py-2 rounded-lg ${running ? 'bg-error/20 border border-error/40' : 'bg-primary'}`}
                onPress={running ? stopMesh : startMesh}
              >
                <Text className={`font-bold text-sm ${running ? 'text-error' : 'text-white'}`}>
                  {running ? 'Stop' : 'Start Mesh'}
                </Text>
              </Pressable>
            </View>

            {myPeerId && (
              <View className="bg-surface rounded-lg p-2 border border-border">
                <Text className="text-text-muted text-xs mb-0.5">My Peer ID</Text>
                <Text className="text-text-secondary font-mono text-xs" selectable numberOfLines={1}>
                  {myPeerId}
                </Text>
              </View>
            )}
          </View>

          {/* ── 2. Peers ── */}
          <View className="bg-card border border-border rounded-xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-white font-semibold">
                Peers ({peers.length})
              </Text>
              {running && (
                <Pressable
                  className="px-3 py-1 bg-surface border border-border rounded-lg"
                  onPress={async () => {
                    const fresh: any[] = await BleMesh.getPeers()
                    setPeers(fresh.map((p) => ({ id: p.peerId ?? p.id, name: p.nickname ?? 'AvaLink' })))
                  }}
                >
                  <Text className="text-text-secondary text-xs">↻ Refresh</Text>
                </Pressable>
              )}
            </View>

            {peers.length === 0 ? (
              <View className="py-4 items-center gap-2">
                {running ? (
                  <>
                    <ActivityIndicator size="small" color="#8B5CF6" />
                    <Text className="text-text-muted text-xs text-center">
                      Scanning for nearby AvaLink devices...{'\n'}
                      Open this screen on the other phone.
                    </Text>
                  </>
                ) : (
                  <Text className="text-text-muted text-xs">Start mesh to discover peers</Text>
                )}
              </View>
            ) : (
              <View className="gap-2">
                {peers.map((peer) => (
                  <Pressable
                    key={peer.id}
                    className={`p-3 rounded-xl border ${
                      selectedPeer === peer.id
                        ? 'border-ble bg-ble/10'
                        : 'border-border bg-surface'
                    }`}
                    onPress={() =>
                      setSelectedPeer(peer.id === selectedPeer ? null : peer.id)
                    }
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <View className="w-2 h-2 rounded-full bg-success" />
                        <Text className="text-white font-semibold text-sm">
                          {peer.name ?? 'AvaLink Device'}
                        </Text>
                      </View>
                      <Text className="text-text-muted text-xs">
                        {selectedPeer === peer.id ? '✓ selected' : 'tap'}
                      </Text>
                    </View>
                    <Text className="text-text-muted font-mono mt-1" style={{ fontSize: 10 }}>
                      {peer.id.slice(0, 28)}...
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* ── 3. Ping test ── */}
          <View className="bg-card border border-border rounded-xl p-4 gap-3">
            <Text className="text-white font-semibold">① Ping Test (short message)</Text>
            <TextInput
              className="bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm"
              value={pingMsg}
              onChangeText={setPingMsg}
              placeholder="ping message..."
              placeholderTextColor="#4A5568"
            />
            <Pressable
              className={`rounded-lg py-2.5 items-center border ${
                running ? 'bg-ble/20 border-ble/40' : 'bg-surface border-border opacity-50'
              }`}
              onPress={() => sendPing(selectedPeer ?? undefined)}
              disabled={!running}
            >
              <Text className="text-ble text-sm font-semibold">
                {selectedPeer ? `→ Send Private to ${selectedPeer.slice(0, 8)}...` : '→ Broadcast'}
              </Text>
            </Pressable>
          </View>

          {/* ── 4. Full Transfer Test ── */}
          <View className="bg-card border border-border rounded-xl p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-white font-semibold">② Chunked Tx Transfer Test</Text>
              <View className="bg-ble/20 px-2 py-0.5 rounded-full">
                <Text className="text-ble text-xs">Day 3</Text>
              </View>
            </View>
            <Text className="text-text-muted text-xs">
              Generates a real offline-signed EVM tx → chunks at 300 chars → sends → receiver reassembles → SHA-256 verified → ethers.Transaction.from() validated
            </Text>

            {/* Step 1: Generate — two options */}
            <View className="flex-row gap-2">
              <Pressable
                className="flex-1 bg-surface border border-border rounded-lg py-2.5 px-3 items-center"
                onPress={generatePayload}
                disabled={transferStatus === 'generating'}
              >
                <Text className="text-white text-xs font-semibold">Real Signed Tx</Text>
                <Text className="text-text-muted text-xs">~240 chars · 1 chunk</Text>
              </Pressable>
              <Pressable
                className="flex-1 bg-surface border border-ble/40 rounded-lg py-2.5 px-3 items-center"
                onPress={generateMultiChunkTestPayload}
                disabled={transferStatus === 'generating'}
              >
                <Text className="text-ble text-xs font-semibold">Multi-Chunk Stress</Text>
                <Text className="text-text-muted text-xs">~470 chars · 2 chunks</Text>
              </Pressable>
            </View>
            {transferStatus === 'generating' && (
              <View className="flex-row items-center gap-2 justify-center">
                <ActivityIndicator size="small" color="#F59E0B" />
                <Text className="text-warning text-xs">Signing offline...</Text>
              </View>
            )}

            {/* Payload preview */}
            {testPayload && (
              <View className="bg-surface border border-border rounded-lg p-3 gap-1">
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-xs">From (test key)</Text>
                  <Text className="text-text-secondary font-mono text-xs">
                    {testPayload.from.slice(0, 10)}...
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-xs">To</Text>
                  <Text className="text-text-secondary font-mono text-xs">
                    {testPayload.to.slice(0, 10)}...
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-xs">Amount</Text>
                  <Text className="text-white text-xs">{testPayload.amountEther} AVAX</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-xs">Chain</Text>
                  <Text className="text-text-secondary text-xs">Fuji ({testPayload.chainId})</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-xs">Payload size</Text>
                  <Text className="text-ble text-xs">
                    {testPayload.byteLength} chars → {testPayload.chunkCount} BLE chunks
                  </Text>
                </View>
              </View>
            )}

            {/* Step 2: Send */}
            <Pressable
              className={`rounded-lg py-3 px-4 items-center ${
                sendDisabled
                  ? 'bg-surface border border-border opacity-40'
                  : 'bg-primary'
              }`}
              onPress={runTransferTest}
              disabled={sendDisabled}
            >
              {transferStatus === 'sending' ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#fff" />
                  <Text className="text-white font-bold">
                    Sending chunk {chunkProgress?.sent ?? 0}/{chunkProgress?.total ?? 0}...
                  </Text>
                </View>
              ) : (
                <Text className="text-white font-bold">
                  {!selectedPeer
                    ? '2. Select a peer first ↑'
                    : !testPayload
                    ? '2. Generate payload first ↑'
                    : '2. Send Chunked Transfer →'}
                </Text>
              )}
            </Pressable>

            {/* Progress bar */}
            {chunkProgress && chunkProgress.total > 0 && (
              <View>
                <View className="h-2 bg-surface rounded-full overflow-hidden border border-border">
                  <View
                    className="h-full bg-ble rounded-full"
                    style={{ width: `${(chunkProgress.sent / chunkProgress.total) * 100}%` }}
                  />
                </View>
                <Text className="text-ble text-xs mt-1 text-center">
                  {chunkProgress.sent}/{chunkProgress.total} chunks transmitted
                </Text>
              </View>
            )}

            {/* Transfer outcome */}
            {transferStatus === 'done' && (
              <View className="bg-success/10 border border-success/30 rounded-lg p-3">
                <Text className="text-success font-bold text-sm">✅ Transfer Complete</Text>
                <Text className="text-success/70 text-xs mt-1">
                  All chunks sent. Check the log on the receiver device.
                </Text>
              </View>
            )}
            {transferStatus === 'failed' && (
              <View className="bg-error/10 border border-error/30 rounded-lg p-3">
                <Text className="text-error font-bold text-sm">❌ Transfer Failed</Text>
                <Text className="text-error/70 text-xs mt-1">See log for details.</Text>
              </View>
            )}
          </View>

          {/* ── 4.5 Local Pipeline Self-Test (Day 4) ── */}
          <View className="bg-card border border-border rounded-xl p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-white font-semibold">③ Local Pipeline Self-Test</Text>
              <View className="bg-primary/20 px-2 py-0.5 rounded-full">
                <Text className="text-primary text-xs">Day 4</Text>
              </View>
            </View>
            <Text className="text-text-muted text-xs">
              Runs the full chunk → SHA-256 → validate pipeline on a single device. No BLE or second phone needed.
            </Text>

            <Pressable
              className={`rounded-lg py-3 px-4 items-center ${
                selfTestStatus === 'running' ? 'bg-surface border border-border opacity-60' : 'bg-ble'
              }`}
              onPress={runLocalSelfTest}
              disabled={selfTestStatus === 'running'}
            >
              {selfTestStatus === 'running' ? (
                <View className="flex-row items-center gap-2">
                  <ActivityIndicator size="small" color="#fff" />
                  <Text className="text-white font-bold">Running self-test...</Text>
                </View>
              ) : (
                <Text className="text-white font-bold">Run Local Self-Test</Text>
              )}
            </Pressable>

            {selfTestResult && (
              <View
                className={`border rounded-lg p-3 gap-2 ${
                  selfTestStatus === 'pass'
                    ? 'bg-success/10 border-success/30'
                    : 'bg-error/10 border-error/30'
                }`}
              >
                <Text
                  className={`font-bold text-sm ${selfTestStatus === 'pass' ? 'text-success' : 'text-error'}`}
                >
                  {selfTestStatus === 'pass' ? '✅ All checks passed' : '❌ Self-test failed'}
                </Text>
                {selfTestStatus === 'pass' ? (
                  <View className="gap-1">
                    <Text className="text-success/80 text-xs">SHA-256 integrity: PASS</Text>
                    <Text className="text-success/80 text-xs">ethers.Transaction.from(): PASS</Text>
                    <Text className="text-success/80 text-xs">
                      Payload: {selfTestResult.payloadLen} chars · {selfTestResult.chunks} chunk(s)
                    </Text>
                    {selfTestResult.from && (
                      <Text className="text-success/80 text-xs">
                        From: {selfTestResult.from.slice(0, 16)}...
                      </Text>
                    )}
                    {selfTestResult.valueEther && (
                      <Text className="text-success/80 text-xs">
                        Amount: {selfTestResult.valueEther} AVAX
                      </Text>
                    )}
                  </View>
                ) : (
                  <Text className="text-error/80 text-xs">{selfTestResult.error}</Text>
                )}
              </View>
            )}
          </View>

          {/* ── 4.6 Validation Rejection Test (Day 5) ── */}
          <View className="bg-card border border-border rounded-xl p-4 gap-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-white font-semibold">④ Rejection Validation Test</Text>
              <View className="bg-error/20 px-2 py-0.5 rounded-full">
                <Text className="text-error text-xs">Day 5</Text>
              </View>
            </View>
            <Text className="text-text-muted text-xs">
              Passes malformed inputs through validateSignedTransaction to confirm each is correctly rejected.
            </Text>

            <Pressable
              className="bg-error/20 border border-error/40 rounded-lg py-3 px-4 items-center"
              onPress={runRejectionTest}
            >
              <Text className="text-error font-bold">Run Rejection Tests</Text>
            </Pressable>

            {rejectionResults && (
              <View className="gap-1.5">
                {rejectionResults.map(({ label, rejected, reason }) => (
                  <View
                    key={label}
                    className={`border rounded-lg p-2.5 ${
                      rejected ? 'bg-success/10 border-success/20' : 'bg-error/10 border-error/30'
                    }`}
                  >
                    <View className="flex-row items-center gap-2 mb-0.5">
                      <Text className={`text-xs font-bold ${rejected ? 'text-success' : 'text-error'}`}>
                        {rejected ? '✅' : '❌'}
                      </Text>
                      <Text className="text-white text-xs font-semibold">{label}</Text>
                    </View>
                    <Text className={`text-xs ${rejected ? 'text-success/70' : 'text-error/70'}`}>
                      {reason}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* ── 5. Received Result (Receiver Side) ── */}
          {receivedResult && (
            <View
              className={`border rounded-xl p-4 gap-2 ${
                receivedResult.valid
                  ? 'bg-success/10 border-success/30'
                  : 'bg-error/10 border-error/30'
              }`}
            >
              <Text
                className={`font-bold text-base ${receivedResult.valid ? 'text-success' : 'text-error'}`}
              >
                {receivedResult.valid ? '✅ Transaction Received & Valid' : '❌ Received but Invalid'}
              </Text>
              {receivedResult.valid ? (
                <View className="gap-1">
                  <Text className="text-success/80 text-xs">
                    SHA-256 integrity: PASS
                  </Text>
                  <Text className="text-success/80 text-xs">
                    ethers.Transaction.from(): PASS
                  </Text>
                  <Text className="text-success/80 text-xs">
                    From: {receivedResult.from?.slice(0, 16)}...
                  </Text>
                  <Text className="text-success/80 text-xs">
                    Amount: {receivedResult.valueEther} AVAX
                  </Text>
                  <Text className="text-success/80 text-xs">
                    Payload length: {receivedResult.raw.length} chars
                  </Text>
                </View>
              ) : (
                <Text className="text-error/80 text-xs">{receivedResult.error}</Text>
              )}
            </View>
          )}

          {/* ── 6. Log ── */}
          <View className="bg-card border border-border rounded-xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-white font-semibold">Event Log</Text>
              <Pressable onPress={() => setLogs([])} className="px-2 py-1">
                <Text className="text-text-muted text-xs">Clear</Text>
              </Pressable>
            </View>

            {/* Legend */}
            <View className="flex-row gap-3 mb-3 flex-wrap">
              {[
                { color: '#22C55E', label: 'success' },
                { color: '#EF4444', label: 'error' },
                { color: '#8B5CF6', label: 'chunk' },
                { color: '#F59E0B', label: 'warn' },
                { color: '#8B9AB2', label: 'info' },
              ].map(({ color, label }) => (
                <View key={label} className="flex-row items-center gap-1">
                  <View className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                  <Text className="text-text-muted" style={{ fontSize: 10 }}>{label}</Text>
                </View>
              ))}
            </View>

            <View className="gap-0.5">
              {logs.length === 0 ? (
                <Text className="text-text-muted text-xs">Start mesh to begin logging.</Text>
              ) : (
                logs.map((entry) => (
                  <View key={entry.id} className="flex-row gap-2 py-0.5">
                    <Text className="text-text-muted w-14" style={{ fontSize: 10 }}>
                      {new Date(entry.ts).toLocaleTimeString('en', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </Text>
                    <Text
                      className="flex-1 text-xs"
                      style={{ color: logColor(entry.level), fontSize: 11, lineHeight: 16 }}
                    >
                      {entry.msg}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </View>

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
