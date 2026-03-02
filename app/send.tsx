import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import { useWalletContext } from '../src/contexts/WalletContext'
import { signOffline, isCacheStale } from '../src/utils/offlineSigning'
import { savePendingTransaction } from '../src/infrastructure/chain/AvalancheBroadcaster'
import { useBLESend } from '../hooks/useBLESend'
import { SECURE_KEYS, ACTIVE_NETWORK } from '../constants/avalanche'
import { ethers } from 'ethers'

type SendStep = 'details' | 'signed' | 'ble_scan' | 'sending'

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

export default function SendScreen() {
  const router = useRouter()
  const { address, networkCache, isOnline, refreshNetworkCache } = useWalletContext()

  const [step, setStep] = useState<SendStep>('details')
  const [toAddress, setToAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [signedTx, setSignedTx] = useState<string | null>(null)
  const [nonceUsed, setNonceUsed] = useState<number | null>(null)
  const [isSigning, setIsSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)

  const bleSend = useBLESend()

  const estimatedGasEth = networkCache
    ? ethers.formatEther(
        BigInt(networkCache.maxFeePerGas) * 21000n
      )
    : null

  const cacheStale = networkCache ? isCacheStale(networkCache) : false

  const validateInputs = (): string | null => {
    if (!toAddress || !ethers.isAddress(toAddress)) return 'Invalid recipient address'
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      return 'Invalid amount'
    if (!networkCache) return 'No cached network data. Connect to internet first.'
    return null
  }

  const handleSign = async () => {
    const validationError = validateInputs()
    if (validationError) {
      Alert.alert('Error', validationError)
      return
    }

    if (!networkCache || !address) return

    try {
      setIsSigning(true)
      setSignError(null)

      const privateKey = await SecureStore.getItemAsync(SECURE_KEYS.PRIVATE_KEY)
      if (!privateKey) throw new Error('No private key found')

      const { signedTx: signed, nonceUsed: nonce } = await signOffline(
        privateKey,
        toAddress,
        amount,
        networkCache
      )

      // Persist pending tx on the sender side too
      await savePendingTransaction({
        signedTx: signed,
        params: {
          to: toAddress,
          amountEther: amount,
          from: address,
          nonceUsed: nonce,
        },
        createdAt: Date.now(),
        source: 'sender',
      })

      setSignedTx(signed)
      setNonceUsed(nonce)
      setStep('signed')
    } catch (err: any) {
      setSignError(err.message)
    } finally {
      setIsSigning(false)
    }
  }

  const handleSendViaBLE = async () => {
    setStep('ble_scan')
    await bleSend.startMesh()
  }

  const handleSelectPeer = async (peerId: string) => {
    if (!signedTx) return
    bleSend.stopScan()
    setStep('sending')
    await bleSend.sendToPeer(peerId, signedTx)
  }

  const handleBroadcastNow = async () => {
    // If online, just navigate home — useNetworkStatus will auto-broadcast
    router.replace('/')
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView className="flex-1 px-6 pt-4">

          {/* Step indicator */}
          <View className="flex-row items-center gap-2 mb-6">
            {(['details', 'signed', 'ble_scan'] as SendStep[]).map((s, i) => (
              <React.Fragment key={s}>
                <View
                  className={`w-8 h-8 rounded-full items-center justify-center ${
                    step === s
                      ? 'bg-primary'
                      : ['signed', 'ble_scan', 'sending'].indexOf(step) > i
                      ? 'bg-success'
                      : 'bg-card border border-border'
                  }`}
                >
                  <Text className="text-white text-xs font-bold">{i + 1}</Text>
                </View>
                {i < 2 && <View className="flex-1 h-0.5 bg-border" />}
              </React.Fragment>
            ))}
          </View>

          {/* ── Step 1: Enter Details ── */}
          {step === 'details' && (
            <View className="gap-5">
              <Text className="text-white text-2xl font-bold">Send AVAX</Text>

              {cacheStale && (
                <View className="bg-warning/10 border border-warning/30 rounded-xl p-3">
                  <Text className="text-warning text-xs">
                    ⚠️ Network data is 6+ hours old. Gas prices may be stale.
                    {isOnline ? ' Refreshing...' : ' Reconnect to refresh.'}
                  </Text>
                </View>
              )}

              <View>
                <Text className="text-text-secondary text-sm mb-2">Recipient Address</Text>
                <TextInput
                  className="bg-card border border-border rounded-xl px-4 py-3 text-white font-mono text-sm"
                  placeholder="0x..."
                  placeholderTextColor="#4A5568"
                  value={toAddress}
                  onChangeText={setToAddress}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              <View>
                <Text className="text-text-secondary text-sm mb-2">Amount</Text>
                <View className="flex-row items-center bg-card border border-border rounded-xl px-4">
                  <TextInput
                    className="flex-1 py-3 text-white text-xl font-bold"
                    placeholder="0.00"
                    placeholderTextColor="#4A5568"
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                  />
                  <Text className="text-text-secondary font-semibold">AVAX</Text>
                </View>
              </View>

              {/* Gas estimate */}
              {estimatedGasEth && (
                <View className="bg-surface rounded-xl p-3 border border-border">
                  <View className="flex-row justify-between">
                    <Text className="text-text-muted text-xs">Estimated Gas (2x buffer)</Text>
                    <Text className="text-text-secondary text-xs font-mono">
                      ~{parseFloat(estimatedGasEth).toFixed(8)} AVAX
                    </Text>
                  </View>
                  <View className="flex-row justify-between mt-1">
                    <Text className="text-text-muted text-xs">Network</Text>
                    <Text className="text-text-secondary text-xs">
                      {ACTIVE_NETWORK.name}
                    </Text>
                  </View>
                </View>
              )}

              {signError && (
                <Text className="text-error text-sm">{signError}</Text>
              )}

              <Pressable
                className="bg-primary rounded-2xl py-5 items-center active:opacity-80"
                onPress={handleSign}
                disabled={isSigning}
              >
                {isSigning ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <>
                    <Text className="text-white font-bold text-base">Sign Offline</Text>
                    <Text className="text-white/60 text-xs mt-1">
                      No internet required for signing
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          )}

          {/* ── Step 2: Signed ── */}
          {step === 'signed' && (
            <View className="gap-5">
              <View className="items-center py-6">
                <View className="w-20 h-20 bg-success/20 rounded-full items-center justify-center mb-4">
                  <Text className="text-4xl">✅</Text>
                </View>
                <Text className="text-white text-2xl font-bold mb-2">Transaction Signed</Text>
                <Text className="text-text-secondary text-sm text-center">
                  Signed completely offline. Your private key never left this device.
                </Text>
              </View>

              {/* Tx Summary */}
              <View className="bg-card border border-border rounded-2xl p-4 gap-3">
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-sm">To</Text>
                  <Text className="text-white text-sm font-mono">
                    {truncateAddress(toAddress)}
                  </Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-sm">Amount</Text>
                  <Text className="text-white text-sm font-bold">{amount} AVAX</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-sm">Nonce</Text>
                  <Text className="text-text-secondary text-sm font-mono">{nonceUsed}</Text>
                </View>
                <View className="flex-row justify-between">
                  <Text className="text-text-muted text-sm">Status</Text>
                  <Text className="text-warning text-sm font-semibold">Pending Relay</Text>
                </View>
              </View>

              <Pressable
                className="bg-ble/20 border border-ble/40 rounded-2xl py-5 items-center active:opacity-80"
                onPress={handleSendViaBLE}
              >
                <Text className="text-ble font-bold text-base">📡 Send via Bluetooth</Text>
                <Text className="text-ble/60 text-xs mt-1">
                  Relay to a nearby phone that has internet
                </Text>
              </Pressable>

              {isOnline && (
                <Pressable
                  className="bg-success/20 border border-success/40 rounded-2xl py-4 items-center active:opacity-80"
                  onPress={handleBroadcastNow}
                >
                  <Text className="text-success font-bold">Broadcast Now (Online)</Text>
                  <Text className="text-success/60 text-xs mt-1">
                    You're connected — submit to chain directly
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* ── Step 3: BLE Scan ── */}
          {step === 'ble_scan' && (
            <View className="gap-5">
              <Text className="text-white text-2xl font-bold">Find Nearby Device</Text>
              <Text className="text-text-secondary text-sm">
                Ask the recipient to open AvaLink and tap "Receive"
              </Text>

              {(bleSend.status === 'starting' || bleSend.status === 'scanning') && (
                <View className="items-center py-8">
                  <ActivityIndicator size="large" color="#8B5CF6" />
                  <Text className="text-ble mt-4">
                    {bleSend.status === 'starting'
                      ? 'Starting BLE mesh...'
                      : 'Scanning for AvaLink devices...'}
                  </Text>
                </View>
              )}

              {bleSend.peers.length === 0 && bleSend.status === 'scanning' && (
                <Text className="text-text-muted text-center text-sm">
                  No devices found yet. Make sure the other phone is on the Receive screen.
                </Text>
              )}

              {/* Peer list */}
              {bleSend.peers.map((peer) => (
                <Pressable
                  key={peer.id}
                  className="bg-card border border-border rounded-2xl p-4 flex-row items-center justify-between active:opacity-80"
                  onPress={() => handleSelectPeer(peer.id)}
                >
                  <View className="flex-row items-center gap-3">
                    <View className="w-10 h-10 bg-ble/20 rounded-full items-center justify-center">
                      <Text>📱</Text>
                    </View>
                    <View>
                      <Text className="text-white font-semibold">
                        {peer.name ?? 'AvaLink Device'}
                      </Text>
                      <Text className="text-text-muted text-xs font-mono">
                        {peer.id.slice(0, 16)}...
                      </Text>
                    </View>
                  </View>
                  <View className="items-end">
                    <Text className="text-text-secondary text-xs">
                      {peer.rssi ? `${peer.rssi} dBm` : ''}
                    </Text>
                    <Text className="text-success text-xs">Connect →</Text>
                  </View>
                </Pressable>
              ))}

              {bleSend.error && (
                <Text className="text-error text-sm">{bleSend.error}</Text>
              )}

              {bleSend.myPeerId && (
                <View className="bg-surface rounded-xl p-3 border border-border">
                  <Text className="text-text-muted text-xs mb-1">Your Peer ID</Text>
                  <Text className="text-text-secondary text-xs font-mono" selectable>
                    {bleSend.myPeerId.slice(0, 20)}...
                  </Text>
                </View>
              )}

              <Pressable
                className="border border-border rounded-xl py-3 items-center"
                onPress={() => { bleSend.reset(); setStep('signed') }}
              >
                <Text className="text-text-secondary">Cancel</Text>
              </Pressable>
            </View>
          )}

          {/* ── Step 4: Sending ── */}
          {(step === 'sending' || bleSend.status === 'success') && (
            <View className="items-center py-12 gap-6">
              {bleSend.status === 'sending' && (
                <>
                  <ActivityIndicator size="large" color="#8B5CF6" />
                  <Text className="text-white text-xl font-bold">Sending via Bluetooth</Text>
                  {bleSend.progress && (
                    <Text className="text-ble">
                      Chunk {bleSend.progress.current} of {bleSend.progress.total}
                    </Text>
                  )}
                </>
              )}
              {bleSend.status === 'success' && (
                <>
                  <View className="w-24 h-24 bg-success/20 rounded-full items-center justify-center">
                    <Text className="text-5xl">✅</Text>
                  </View>
                  <Text className="text-white text-2xl font-bold">Relayed!</Text>
                  <Text className="text-text-secondary text-sm text-center">
                    Transaction sent to nearby device.{'\n'}
                    It will broadcast to Avalanche C-Chain when online.
                  </Text>
                  <Pressable
                    className="bg-primary rounded-2xl py-4 px-8 active:opacity-80"
                    onPress={() => router.replace('/')}
                  >
                    <Text className="text-white font-bold">Back to Home</Text>
                  </Pressable>
                </>
              )}
              {bleSend.status === 'error' && (
                <>
                  <Text className="text-error text-2xl font-bold">Send Failed</Text>
                  <Text className="text-error/70 text-sm text-center">{bleSend.error}</Text>
                  <Pressable
                    className="bg-card border border-border rounded-xl py-3 px-6"
                    onPress={() => { bleSend.reset(); setStep('ble_scan') }}
                  >
                    <Text className="text-white">Try Again</Text>
                  </Pressable>
                </>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
