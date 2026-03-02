import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  Linking,
  ActivityIndicator,
  Share,
  ScrollView,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ACTIVE_NETWORK } from '../constants/avalanche'
import { getExplorerUrl, waitForConfirmation } from '../src/infrastructure/chain/AvalancheBroadcaster'

export default function ConfirmScreen() {
  const router = useRouter()
  const { hash } = useLocalSearchParams<{ hash: string }>()
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)
  const [isPolling, setIsPolling] = useState(true)

  useEffect(() => {
    if (!hash) { setIsPolling(false); return }
    pollForConfirmation()
  }, [hash])

  async function pollForConfirmation() {
    if (!hash) return
    try {
      const receipt = await waitForConfirmation(hash, 120_000)
      setBlockNumber(Number(receipt.blockNumber))
      setIsConfirmed(receipt.status === 1)
    } catch {
      // Timeout — still show success, user can check explorer
      setIsConfirmed(true)
    } finally {
      setIsPolling(false)
    }
  }

  function truncateHash(h: string): string {
    return `${h.slice(0, 10)}...${h.slice(-8)}`
  }

  function copyHash() {
    Share.share({ message: hash ?? '' })
  }

  function openExplorer() {
    if (!hash) return
    Linking.openURL(getExplorerUrl(hash))
  }

  // Relay device / already-broadcast case: no hash available
  if (!hash) {
    return (
      <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
        <View className="flex-1 px-6 items-center justify-center gap-6">
          <View className="w-28 h-28 bg-success/20 rounded-full items-center justify-center border-2 border-success/40">
            <Text className="text-5xl">✅</Text>
          </View>
          <View className="items-center gap-2">
            <Text className="text-white text-2xl font-bold">Transaction Broadcast</Text>
            <Text className="text-text-secondary text-sm text-center">
              The sender device broadcast the transaction to Avalanche C-Chain.
            </Text>
          </View>
          <View className="bg-ble/10 border border-ble/30 rounded-xl p-4 w-full">
            <Text className="text-ble text-xs text-center leading-5">
              Your role as relay is complete. Check your balance shortly to confirm the transfer.
            </Text>
          </View>
          <Pressable
            className="w-full bg-primary rounded-2xl py-5 items-center active:opacity-80"
            onPress={() => router.replace('/')}
          >
            <Text className="text-white font-bold text-base">Back to Home</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView className="flex-1">
        <View className="flex-1 px-6 pt-8 pb-8 items-center gap-6">

          {/* Status icon */}
          <View className="w-32 h-32 bg-success/20 rounded-full items-center justify-center border-2 border-success/40">
            <Text className="text-6xl">✅</Text>
          </View>

          {/* Headline */}
          <View className="items-center gap-2">
            <Text className="text-white text-3xl font-bold">Transaction Sent!</Text>
            <Text className="text-text-secondary text-sm text-center">
              {isPolling
                ? 'Confirming on Avalanche C-Chain...'
                : isConfirmed && blockNumber
                ? `Confirmed in block #${blockNumber}`
                : isConfirmed
                ? 'Submitted to network'
                : 'Check Snowtrace for status'}
            </Text>
          </View>

          {/* Polling indicator */}
          {isPolling && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#22C55E" />
              <Text className="text-success text-sm">Waiting for confirmation...</Text>
            </View>
          )}

          {/* Network badge */}
          <View className="bg-surface border border-border rounded-full px-4 py-2">
            <Text className="text-text-secondary text-xs">⚡ {ACTIVE_NETWORK.name}</Text>
          </View>

          {/* Tx hash card */}
          <View className="bg-card border border-border rounded-2xl p-5 w-full gap-4">
            <View>
              <Text className="text-text-muted text-xs mb-1">Transaction Hash</Text>
              <Text className="text-white text-sm font-mono" selectable>
                {truncateHash(hash)}
              </Text>
            </View>

            <View className="flex-row gap-3">
              <Pressable
                className="flex-1 bg-surface border border-border rounded-xl py-3 items-center active:opacity-80"
                onPress={copyHash}
              >
                <Text className="text-text-secondary text-sm">📋 Copy</Text>
              </Pressable>

              <Pressable
                className="flex-1 bg-primary/20 border border-primary/40 rounded-xl py-3 items-center active:opacity-80"
                onPress={openExplorer}
              >
                <Text className="text-primary text-sm">🔍 Snowtrace</Text>
              </Pressable>
            </View>
          </View>

          {/* How this worked */}
          <View className="bg-ble/10 border border-ble/30 rounded-xl p-4 w-full gap-2">
            <Text className="text-ble text-xs font-semibold">How this worked</Text>
            <Text className="text-ble/80 text-xs leading-5">
              1. Tx signed offline — private key never left your device{'\n'}
              2. Signed bytes relayed via Bluetooth to a nearby phone{'\n'}
              3. Relay broadcast to Avalanche C-Chain when online
            </Text>
          </View>

          {/* Back button */}
          <Pressable
            className="w-full bg-primary rounded-2xl py-5 items-center active:opacity-80"
            onPress={() => router.replace('/')}
          >
            <Text className="text-white font-bold text-base">Back to Home</Text>
          </Pressable>

        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
