/**
 * BLE Test Screen — Day 2 debug tool
 *
 * Purpose: verify two Android phones discover each other via @magicred-1/ble-mesh
 * before wiring up the full transaction flow.
 *
 * Access: navigate to /ble-test from the home screen (dev only)
 */
import React, { useState, useEffect, useRef } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { BleMesh } from '@magicred-1/ble-mesh'

interface LogEntry {
  ts: number
  level: 'info' | 'success' | 'error' | 'warn'
  msg: string
}

interface Peer {
  id: string
  name: string | null
}

export default function BLETestScreen() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [myPeerId, setMyPeerId] = useState<string | null>(null)
  const [peers, setPeers] = useState<Peer[]>([])
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [testMessage, setTestMessage] = useState('ping from AvaLink')
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)
  const unsubRefs = useRef<Array<() => void>>([])

  function log(msg: string, level: LogEntry['level'] = 'info') {
    const entry: LogEntry = { ts: Date.now(), level, msg }
    setLogs((prev) => [entry, ...prev].slice(0, 100))
    console.log(`[BLE-TEST][${level}] ${msg}`)
  }

  async function startMesh() {
    try {
      log('Requesting permissions...')
      const perms = await BleMesh.requestPermissions()
      log(`Permissions: BT=${perms.bluetooth} LOC=${perms.location}`, perms.bluetooth && perms.location ? 'success' : 'error')

      if (!perms.bluetooth || !perms.location) {
        log('Permissions denied — enable in Settings', 'error')
        return
      }

      log('Starting BleMesh...')
      await BleMesh.start({ nickname: 'AvaLink-Test', autoRequestPermissions: false })
      const peerId = await BleMesh.getMyPeerId()
      setMyPeerId(peerId)
      log(`Started! My peer ID: ${peerId.slice(0, 16)}...`, 'success')
      setRunning(true)

      // Peer discovery
      const unsubPeers = BleMesh.onPeerListUpdated(({ peers: newPeers }: { peers: any[] }) => {
        const mapped: Peer[] = newPeers.map((p: any) => ({
          id: p.peerId ?? p.id,
          name: p.nickname ?? p.name ?? 'Unknown',
        }))
        setPeers(mapped)
        log(`Peer list updated: ${mapped.length} peer(s) — [${mapped.map(p => p.name).join(', ')}]`, mapped.length > 0 ? 'success' : 'info')
      })
      unsubRefs.current.push(unsubPeers)

      // Message receive
      const unsubMsg = BleMesh.onMessageReceived(({ message, senderId }: any) => {
        log(`Message from ${senderId?.slice(0, 8) ?? '?'}: "${message}"`, 'success')
      })
      unsubRefs.current.push(unsubMsg)

      // Connection state
      const unsubConn = BleMesh.onConnectionStateChanged(({ peerId: pid, state }: any) => {
        log(`Connection: ${pid?.slice(0, 8)}... → ${state}`, state === 'connected' ? 'success' : 'warn')
      })
      unsubRefs.current.push(unsubConn)

      log('Listening for peers...', 'info')
    } catch (err: any) {
      log(`Error: ${err.message}`, 'error')
    }
  }

  async function stopMesh() {
    for (const unsub of unsubRefs.current) unsub()
    unsubRefs.current = []
    await BleMesh.stop()
    setRunning(false)
    setMyPeerId(null)
    setPeers([])
    log('Mesh stopped', 'warn')
  }

  async function sendTestMessage(peerId?: string) {
    try {
      if (peerId) {
        log(`Sending private msg to ${peerId.slice(0, 8)}...`)
        await BleMesh.sendPrivateMessage(testMessage, peerId)
        log('Private message sent!', 'success')
      } else {
        log('Broadcasting to all peers...')
        await BleMesh.sendMessage(testMessage, null as any)
        log('Broadcast sent!', 'success')
      }
    } catch (err: any) {
      log(`Send failed: ${err.message}`, 'error')
    }
  }

  async function refreshPeers() {
    try {
      const fresh: any[] = await BleMesh.getPeers()
      const mapped: Peer[] = fresh.map((p) => ({
        id: p.peerId ?? p.id,
        name: p.nickname ?? p.name ?? 'Unknown',
      }))
      setPeers(mapped)
      log(`Refreshed: ${mapped.length} peer(s)`)
    } catch (err: any) {
      log(`Refresh failed: ${err.message}`, 'error')
    }
  }

  function logColor(level: LogEntry['level']): string {
    switch (level) {
      case 'success': return '#22C55E'
      case 'error': return '#EF4444'
      case 'warn': return '#F59E0B'
      default: return '#8B9AB2'
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView className="flex-1">
        {/* Header */}
        <View className="px-4 pt-4 pb-3 flex-row items-center justify-between border-b border-border">
          <View>
            <Text className="text-white font-bold text-lg">BLE Peer Discovery</Text>
            <Text className="text-text-muted text-xs">Day 2 test — @magicred-1/ble-mesh</Text>
          </View>
          <Pressable onPress={() => router.back()} className="px-3 py-1.5 bg-card rounded-lg border border-border">
            <Text className="text-text-secondary text-sm">← Back</Text>
          </Pressable>
        </View>

        <View className="px-4 py-4 gap-4">
          {/* Status */}
          <View className="bg-card border border-border rounded-xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <View className="flex-row items-center gap-2">
                <View className={`w-2.5 h-2.5 rounded-full ${running ? 'bg-success' : 'bg-error'}`} />
                <Text className="text-white font-semibold">
                  {running ? 'Mesh Running' : 'Mesh Stopped'}
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
              <View>
                <Text className="text-text-muted text-xs mb-1">My Peer ID</Text>
                <Text className="text-text-secondary text-xs font-mono" selectable>
                  {myPeerId}
                </Text>
              </View>
            )}
          </View>

          {/* Peers */}
          <View className="bg-card border border-border rounded-xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-white font-semibold">
                Peers ({peers.length})
              </Text>
              {running && (
                <Pressable
                  className="px-3 py-1 bg-surface border border-border rounded-lg"
                  onPress={refreshPeers}
                >
                  <Text className="text-text-secondary text-xs">Refresh</Text>
                </Pressable>
              )}
            </View>

            {peers.length === 0 ? (
              <View className="py-4 items-center">
                {running ? (
                  <>
                    <ActivityIndicator size="small" color="#8B5CF6" />
                    <Text className="text-text-muted text-xs mt-2">
                      Waiting for nearby AvaLink devices...
                    </Text>
                    <Text className="text-text-muted text-xs mt-1">
                      Open this screen on another phone
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
                    className={`p-3 rounded-xl border ${selectedPeer === peer.id ? 'border-ble bg-ble/10' : 'border-border bg-surface'}`}
                    onPress={() => setSelectedPeer(peer.id === selectedPeer ? null : peer.id)}
                  >
                    <View className="flex-row items-center justify-between">
                      <View className="flex-row items-center gap-2">
                        <View className="w-2 h-2 rounded-full bg-success" />
                        <Text className="text-white text-sm font-semibold">
                          {peer.name ?? 'AvaLink Device'}
                        </Text>
                      </View>
                      <Text className="text-text-muted text-xs">
                        {selectedPeer === peer.id ? '✓ selected' : 'tap to select'}
                      </Text>
                    </View>
                    <Text className="text-text-muted text-xs font-mono mt-1">
                      {peer.id.slice(0, 24)}...
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Send test message */}
          <View className="bg-card border border-border rounded-xl p-4 gap-3">
            <Text className="text-white font-semibold">Send Test Message</Text>
            <TextInput
              className="bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm"
              value={testMessage}
              onChangeText={setTestMessage}
              placeholder="Test message..."
              placeholderTextColor="#4A5568"
            />
            <View className="flex-row gap-2">
              <Pressable
                className="flex-1 bg-ble/20 border border-ble/40 rounded-lg py-2.5 items-center"
                onPress={() => sendTestMessage(selectedPeer ?? undefined)}
                disabled={!running}
              >
                <Text className="text-ble text-sm font-semibold">
                  {selectedPeer ? '→ Send Private' : '→ Broadcast'}
                </Text>
              </Pressable>
            </View>
            {!selectedPeer && (
              <Text className="text-text-muted text-xs text-center">
                Select a peer above to send privately, or broadcast to all
              </Text>
            )}
          </View>

          {/* Logs */}
          <View className="bg-card border border-border rounded-xl p-4">
            <View className="flex-row items-center justify-between mb-3">
              <Text className="text-white font-semibold">Log</Text>
              <Pressable onPress={() => setLogs([])} className="px-2 py-1">
                <Text className="text-text-muted text-xs">Clear</Text>
              </Pressable>
            </View>
            <View className="gap-1">
              {logs.length === 0 ? (
                <Text className="text-text-muted text-xs">No logs yet. Start the mesh.</Text>
              ) : (
                logs.map((entry) => (
                  <View key={entry.ts + entry.msg} className="flex-row gap-2">
                    <Text className="text-text-muted text-xs w-16" style={{ fontSize: 10 }}>
                      {new Date(entry.ts).toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </Text>
                    <Text
                      className="text-xs flex-1"
                      style={{ color: logColor(entry.level), fontSize: 11 }}
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
