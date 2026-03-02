import React, { createContext, useContext, ReactNode } from 'react'
import { useWallet, WalletState, WalletActions } from '../../hooks/useWallet'
import { useNetworkStatus, NetworkStatus, NetworkActions } from '../../hooks/useNetworkStatus'
import { useRouter } from 'expo-router'

interface WalletContextValue extends WalletState, WalletActions, NetworkStatus, NetworkActions {
  lastBroadcastHash: string | null
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const wallet = useWallet()
  const [lastBroadcastHash, setLastBroadcastHash] = React.useState<string | null>(null)

  const network = useNetworkStatus(
    (hash) => {
      setLastBroadcastHash(hash)
      // Navigate to confirm only for auto-broadcast (not manual — home screen handles that)
      if (hash) {
        router.push({ pathname: '/confirm', params: { hash } })
      }
      // Re-sync nonce + balance after any broadcast (ours or the other device's)
      if (wallet.address) {
        wallet.refreshNetworkCache()
        wallet.refreshBalance()
      }
    },
    (error) => {
      console.warn('[AvaLink] Broadcast failed:', error)
    }
  )

  // Refresh balance + network cache when coming online
  React.useEffect(() => {
    if (network.isOnline && wallet.address) {
      wallet.refreshBalance()
      wallet.refreshNetworkCache()
    }
  }, [network.isOnline, wallet.address])

  const value: WalletContextValue = {
    ...wallet,
    ...network,
    lastBroadcastHash,
  }

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWalletContext(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWalletContext must be used inside WalletProvider')
  return ctx
}
