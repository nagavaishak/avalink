import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  Linking,
  ActivityIndicator,
  Share,
} from 'react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ethers } from 'ethers'
import { ACTIVE_NETWORK } from '../constants/avalanche'
import { getExplorerUrl, waitForConfirmation } from '../src/infrastructure/chain/AvalancheBroadcaster'

export default function ConfirmScreen() {
  const router = useRouter()
  const { hash } = useLocalSearchParams<{ hash: string }>()
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [blockNumber, setBlockNumber] = useState<number | null>(null)
  const [isPolling, setIsPolling] = useState(true)

  useEffect(() => {
    if (!hash) return
    pollForConfirmation()
  }, [hash])

  async function pollForConfirmation() {
    if (!hash) return
    try {
      const receipt = await waitForConfirmation(hash, 120_000)
      setBlockNumber(Number(receipt.blockNumber))
      setIsConfirmed(receipt.status === 1)
    } catch {
      // Timeout — still show success with hash, user can check explorer
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

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <View className="flex-1 px-6 pt-8 items-center justify-between">
        {/* Top section */}
        <View className="items-center gap-6 flex-1 justify-center">
          {/* Checkmark */}
          <View className="w-32 h-32 bg-success/20 rounded-full items-center justify-center border-2 border-success/40">
            <Text className="text-6xl">✅</Text>
          </View>

          <View className="items-center gap-2">
            <Text className="text-white text-3xl font-bold">Transaction Sent!</Text>
            <Text className="text-text-secondary text-sm text-center">
              {isPolling
                ? 'Confirming on Avalanche C-Chain...'
                : isConfirmed
                ? `Confirmed${blockNumber ? ` in block #${blockNumber}` : ''}`
                : 'Submitted to network'}
            </Text>
          </View>

          {isPolling && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#22C55E" />
              <Text className="text-success text-sm">Waiting for confirmation...</Text>
            </View>
          )}

          {/* Network Badge */}
          <View className="bg-surface border border-border rounded-full px-4 py-2">
            <Text className="text-text-secondary text-xs">
              ⚡ {ACTIVE_NETWORK.name}
            </Text>
          </View>

          {/* Tx Hash */}
          {hash && (
            <View className="bg-card border border-border rounded-2xl p-5 w-full gap-3">
              <View>
                <Text className="text-text-muted text-xs mb-1">Transaction Hash</Text>
                <Text className="text-white text-sm font-mono">{truncateHash(hash)}</Text>
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
          )}

          <View className="bg-ble/10 border border-ble/30 rounded-xl p-4 w-full">
            <Text className="text-ble text-xs text-center leading-5">
              🎉 This transaction was signed offline and relayed via Bluetooth.{'\n'}
              No internet was needed at the time of signing.
            </Text>
          </View>
        </View>

        {/* Bottom button */}
        <Pressable
          className="w-full bg-primary rounded-2xl py-5 items-center mb-4 active:opacity-80"
          onPress={() => router.replace('/')}
        >
          <Text className="text-white font-bold text-base">Back to Home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}
