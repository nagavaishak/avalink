import React, { useEffect } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useWalletContext } from '../src/contexts/WalletContext'
import { isCacheStale } from '../src/utils/offlineSigning'

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

export default function HomeScreen() {
  const router = useRouter()
  const {
    address,
    balance,
    isLoading,
    isOnline,
    hasPendingTx,
    networkCache,
    refreshBalance,
    refreshNetworkCache,
  } = useWalletContext()

  const [refreshing, setRefreshing] = React.useState(false)

  // Redirect to onboarding if no wallet
  useEffect(() => {
    if (!isLoading && !address) {
      router.replace('/onboarding')
    }
  }, [isLoading, address])

  const onRefresh = async () => {
    setRefreshing(true)
    await Promise.all([refreshBalance(), refreshNetworkCache()])
    setRefreshing(false)
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color="#E84142" />
      </View>
    )
  }

  if (!address) return null

  const cacheStale = networkCache ? isCacheStale(networkCache) : false

  return (
    <SafeAreaView className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#E84142"
          />
        }
      >
        {/* Header */}
        <View className="px-6 pt-8 pb-6">
          <View className="flex-row items-center justify-between mb-2">
            <Text className="text-white text-3xl font-bold tracking-tight">AvaLink</Text>
            <View
              className={`flex-row items-center gap-1.5 px-3 py-1 rounded-full ${
                isOnline ? 'bg-success/20' : 'bg-error/20'
              }`}
            >
              <View
                className={`w-2 h-2 rounded-full ${isOnline ? 'bg-success' : 'bg-error'}`}
              />
              <Text
                className={`text-xs font-semibold ${isOnline ? 'text-success' : 'text-error'}`}
              >
                {isOnline ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
          <Text className="text-text-secondary text-sm">The internet goes down. Your money doesn't.</Text>
        </View>

        {/* Balance Card */}
        <View className="mx-6 mb-6 bg-card rounded-2xl p-6 border border-border">
          <Text className="text-text-secondary text-sm mb-1">AVAX Balance</Text>
          <Text className="text-white text-4xl font-bold mb-1">
            {balance ? parseFloat(balance).toFixed(4) : '—'}
          </Text>
          <Text className="text-text-secondary text-xs mb-4">AVAX</Text>

          <View className="border-t border-border pt-4">
            <Text className="text-text-muted text-xs mb-1">Wallet Address</Text>
            <Text className="text-text-secondary text-sm font-mono">
              {truncateAddress(address)}
            </Text>
          </View>
        </View>

        {/* Stale Cache Warning */}
        {cacheStale && !hasPendingTx && (
          <View className="mx-6 mb-4 bg-warning/10 border border-warning/30 rounded-xl p-4">
            <Text className="text-warning text-sm font-semibold mb-1">
              ⚠️ Gas data is stale
            </Text>
            <Text className="text-warning/80 text-xs">
              Network data is 6+ hours old. Gas prices may have changed. Reconnect to refresh.
            </Text>
          </View>
        )}

        {/* Offline Mode Info */}
        {!isOnline && !hasPendingTx && (
          <View className="mx-6 mb-4 bg-ble/10 border border-ble/30 rounded-xl p-4">
            <Text className="text-ble text-sm font-semibold mb-1">
              📡 Offline Mode Active
            </Text>
            <Text className="text-ble/80 text-xs">
              You can still sign and send transactions via Bluetooth. They'll broadcast when either device reconnects.
            </Text>
          </View>
        )}

        {/* Action Buttons */}
        <View className="mx-6 flex-row gap-4 mb-6">
          <Pressable
            className="flex-1 bg-primary rounded-2xl py-5 items-center active:opacity-80"
            onPress={() => router.push('/send')}
          >
            <Text className="text-2xl mb-1">↑</Text>
            <Text className="text-white font-bold text-base">Send</Text>
            <Text className="text-white/60 text-xs">via Bluetooth</Text>
          </Pressable>

          <Pressable
            className="flex-1 bg-card border border-border rounded-2xl py-5 items-center active:opacity-80"
            onPress={() => router.push('/receive')}
          >
            <Text className="text-2xl mb-1">↓</Text>
            <Text className="text-white font-bold text-base">Receive</Text>
            <Text className="text-text-secondary text-xs">show QR / listen</Text>
          </Pressable>
        </View>

        {/* Network Cache Info */}
        {networkCache && (
          <View className="mx-6 mb-6 bg-surface rounded-xl p-4 border border-border">
            <Text className="text-text-secondary text-xs font-semibold mb-2">
              CACHED NETWORK DATA
            </Text>
            <View className="flex-row justify-between mb-1">
              <Text className="text-text-muted text-xs">Next Nonce</Text>
              <Text className="text-text-secondary text-xs font-mono">{networkCache.nonce}</Text>
            </View>
            <View className="flex-row justify-between mb-1">
              <Text className="text-text-muted text-xs">Cached</Text>
              <Text className="text-text-secondary text-xs">
                {new Date(networkCache.cachedAt).toLocaleTimeString()}
              </Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-text-muted text-xs">Status</Text>
              <Text className={`text-xs font-semibold ${cacheStale ? 'text-warning' : 'text-success'}`}>
                {cacheStale ? 'Stale' : 'Fresh'}
              </Text>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
