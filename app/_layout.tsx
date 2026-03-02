import '../global.css'
import 'react-native-get-random-values'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { WalletProvider } from '../src/contexts/WalletContext'
import { View, Text, Pressable } from 'react-native'
import { useWalletContext } from '../src/contexts/WalletContext'
import { isCacheStale } from '../src/utils/offlineSigning'

function PendingTxBanner() {
  const { hasPendingTx, networkCache } = useWalletContext()

  const cacheStale = networkCache ? isCacheStale(networkCache) : false

  return (
    <>
      {hasPendingTx && (
        <View className="bg-warning/20 border-b border-warning/30 px-4 py-2">
          <Text className="text-warning text-xs font-semibold text-center">
            ⚠️ Pending offline transaction — do not send from this wallet until confirmed
          </Text>
        </View>
      )}
      {cacheStale && !hasPendingTx && (
        <View className="bg-info/20 border-b border-info/30 px-4 py-2">
          <Text className="text-info text-xs text-center">
            ℹ️ Network data is 6+ hours old. Reconnect briefly to refresh gas prices.
          </Text>
        </View>
      )}
    </>
  )
}

function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" backgroundColor="#0A0E1A" />
      <PendingTxBanner />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#131929' },
          headerTintColor: '#FFFFFF',
          headerTitleStyle: { fontWeight: '700', color: '#FFFFFF' },
          contentStyle: { backgroundColor: '#0A0E1A' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'AvaLink', headerShown: false }} />
        <Stack.Screen name="send" options={{ title: 'Send AVAX' }} />
        <Stack.Screen name="receive" options={{ title: 'Receive' }} />
        <Stack.Screen name="confirm" options={{ title: 'Confirmed', headerLeft: () => null }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        <Stack.Screen name="ble-test" options={{ title: '📡 BLE Test', headerStyle: { backgroundColor: '#131929' }, headerTintColor: '#fff' }} />
      </Stack>
    </SafeAreaProvider>
  )
}

export default function App() {
  return (
    <WalletProvider>
      <RootLayout />
    </WalletProvider>
  )
}
