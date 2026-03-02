import React, { useEffect } from 'react'
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import QRCode from 'react-native-qrcode-svg'
import { useWalletContext } from '../src/contexts/WalletContext'
import { useBLEReceive } from '../hooks/useBLEReceive'

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`
}

export default function ReceiveScreen() {
  const router = useRouter()
  const { address, isOnline } = useWalletContext()
  const bleReceive = useBLEReceive(isOnline)

  useEffect(() => {
    bleReceive.startListening()
    return () => bleReceive.stopListening()
  }, [])

  // Navigate to confirm screen when tx is broadcast
  useEffect(() => {
    if (bleReceive.status === 'confirmed' && bleReceive.receivedTx?.hash) {
      router.replace({
        pathname: '/confirm',
        params: { hash: bleReceive.receivedTx.hash },
      })
    }
  }, [bleReceive.status, bleReceive.receivedTx?.hash])

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['bottom']}>
      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-white text-2xl font-bold mb-2">Receive AVAX</Text>
        <Text className="text-text-secondary text-sm mb-6">
          Share your address or let AvaLink listen for incoming Bluetooth transfers
        </Text>

        {/* QR Code */}
        {address && (
          <View className="bg-white rounded-3xl p-6 items-center mb-6 mx-4">
            <QRCode
              value={address}
              size={200}
              backgroundColor="white"
              color="#0A0E1A"
            />
            <Text className="text-background text-xs font-mono mt-4 text-center">
              {truncateAddress(address)}
            </Text>
          </View>
        )}

        {/* BLE Listen Status */}
        <View className="bg-card border border-border rounded-2xl p-5 mb-4">
          <View className="flex-row items-center gap-3 mb-3">
            <View
              className={`w-3 h-3 rounded-full ${
                bleReceive.status === 'listening' ? 'bg-ble' : 'bg-text-muted'
              }`}
            />
            <Text className="text-white font-semibold">Bluetooth Listener</Text>
          </View>

          {bleReceive.status === 'requesting_permissions' && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#8B5CF6" />
              <Text className="text-ble text-sm">Requesting permissions...</Text>
            </View>
          )}

          {bleReceive.status === 'listening' && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#8B5CF6" />
              <Text className="text-ble text-sm">
                Listening for nearby AvaLink transfers...
              </Text>
            </View>
          )}

          {bleReceive.status === 'receiving' && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#F59E0B" />
              <Text className="text-warning text-sm">Receiving transaction data...</Text>
            </View>
          )}

          {bleReceive.status === 'validating' && (
            <View className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color="#3B82F6" />
              <Text className="text-info text-sm">Validating transaction...</Text>
            </View>
          )}

          {bleReceive.status === 'error' && (
            <View>
              <Text className="text-error text-sm mb-2">{bleReceive.error}</Text>
              <Pressable
                className="bg-card border border-border rounded-lg py-2 px-4 self-start"
                onPress={() => { bleReceive.reset(); bleReceive.startListening() }}
              >
                <Text className="text-white text-sm">Retry</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Received Tx Preview */}
        {bleReceive.receivedTx && (
          <View className="bg-success/10 border border-success/30 rounded-2xl p-5 mb-4">
            <Text className="text-success font-bold text-base mb-3">
              ✅ Transaction Received!
            </Text>
            <View className="gap-2">
              <View className="flex-row justify-between">
                <Text className="text-text-muted text-sm">From</Text>
                <Text className="text-white text-sm font-mono">
                  {bleReceive.receivedTx.from
                    ? truncateAddress(bleReceive.receivedTx.from)
                    : 'Unknown'}
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-text-muted text-sm">Amount</Text>
                <Text className="text-white text-sm font-bold">
                  {bleReceive.receivedTx.valueEther} AVAX
                </Text>
              </View>
              <View className="flex-row justify-between">
                <Text className="text-text-muted text-sm">Status</Text>
                <Text
                  className={`text-sm font-semibold ${
                    bleReceive.status === 'queued'
                      ? 'text-warning'
                      : bleReceive.status === 'broadcasting'
                      ? 'text-info'
                      : bleReceive.status === 'confirmed'
                      ? 'text-success'
                      : 'text-text-secondary'
                  }`}
                >
                  {bleReceive.status === 'queued' && 'Queued — waiting for internet'}
                  {bleReceive.status === 'broadcasting' && 'Broadcasting...'}
                  {bleReceive.status === 'confirmed' && 'Confirmed on chain ✅'}
                </Text>
              </View>
            </View>

            {bleReceive.status === 'broadcasting' && (
              <View className="mt-3 flex-row items-center gap-2">
                <ActivityIndicator size="small" color="#3B82F6" />
                <Text className="text-info text-xs">Submitting to Avalanche C-Chain...</Text>
              </View>
            )}
          </View>
        )}

        {/* Offline queue info */}
        {bleReceive.status === 'queued' && (
          <View className="bg-warning/10 border border-warning/30 rounded-xl p-4 mb-4">
            <Text className="text-warning text-sm font-semibold mb-1">
              📴 Transaction Queued
            </Text>
            <Text className="text-warning/80 text-xs">
              Transaction stored securely. It will automatically broadcast to Avalanche
              C-Chain when this phone reconnects to the internet.
            </Text>
          </View>
        )}

        <Pressable
          className="border border-border rounded-xl py-3 items-center mb-8"
          onPress={() => router.back()}
        >
          <Text className="text-text-secondary">Done</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  )
}
