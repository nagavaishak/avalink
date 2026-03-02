import { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import * as SecureStore from 'expo-secure-store'
import { ACTIVE_NETWORK, SECURE_KEYS, STORAGE_KEYS } from '../constants/avalanche'
import {
  cacheNetworkData,
  getCachedNetworkData,
  CachedNetworkData,
} from '../src/utils/offlineSigning'

export interface WalletState {
  address: string | null
  privateKey: string | null
  balance: string | null
  networkCache: CachedNetworkData | null
  isLoading: boolean
  error: string | null
}

export interface WalletActions {
  createWallet: () => Promise<void>
  importWallet: (privateKey: string) => Promise<void>
  importFromMnemonic: (mnemonic: string) => Promise<void>
  refreshBalance: () => Promise<void>
  refreshNetworkCache: () => Promise<void>
  clearWallet: () => Promise<void>
}

export function useWallet(): WalletState & WalletActions {
  const [address, setAddress] = useState<string | null>(null)
  const [privateKey, setPrivateKey] = useState<string | null>(null)
  const [balance, setBalance] = useState<string | null>(null)
  const [networkCache, setNetworkCache] = useState<CachedNetworkData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Load wallet from SecureStore on mount
  useEffect(() => {
    loadWallet()
  }, [])

  async function loadWallet() {
    try {
      setIsLoading(true)
      const storedKey = await SecureStore.getItemAsync(SECURE_KEYS.PRIVATE_KEY)
      if (storedKey) {
        const wallet = new ethers.Wallet(storedKey)
        setPrivateKey(storedKey)
        setAddress(wallet.address)

        // Load cached network data
        const cached = await getCachedNetworkData()
        setNetworkCache(cached)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  const createWallet = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const wallet = ethers.Wallet.createRandom()
      await SecureStore.setItemAsync(SECURE_KEYS.PRIVATE_KEY, wallet.privateKey)
      setPrivateKey(wallet.privateKey)
      setAddress(wallet.address)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const importWallet = useCallback(async (key: string) => {
    try {
      setIsLoading(true)
      setError(null)
      // Validate the private key
      const wallet = new ethers.Wallet(key)
      await SecureStore.setItemAsync(SECURE_KEYS.PRIVATE_KEY, wallet.privateKey)
      setPrivateKey(wallet.privateKey)
      setAddress(wallet.address)
    } catch (err: any) {
      setError('Invalid private key')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const importFromMnemonic = useCallback(async (mnemonic: string) => {
    try {
      setIsLoading(true)
      setError(null)
      const wallet = ethers.Wallet.fromPhrase(mnemonic.trim())
      await SecureStore.setItemAsync(SECURE_KEYS.PRIVATE_KEY, wallet.privateKey)
      setPrivateKey(wallet.privateKey)
      setAddress(wallet.address)
    } catch (err: any) {
      setError('Invalid recovery phrase')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshBalance = useCallback(async () => {
    if (!address) return
    try {
      const provider = new ethers.JsonRpcProvider(ACTIVE_NETWORK.rpcUrl)
      const raw = await provider.getBalance(address)
      setBalance(ethers.formatEther(raw))
    } catch (err: any) {
      console.warn('[useWallet] Balance fetch failed:', err.message)
    }
  }, [address])

  const refreshNetworkCache = useCallback(async () => {
    if (!address) return
    try {
      const cached = await cacheNetworkData(address)
      setNetworkCache(cached)
    } catch (err: any) {
      console.warn('[useWallet] Network cache refresh failed:', err.message)
    }
  }, [address])

  const clearWallet = useCallback(async () => {
    await SecureStore.deleteItemAsync(SECURE_KEYS.PRIVATE_KEY)
    await SecureStore.deleteItemAsync(SECURE_KEYS.NETWORK_CACHE)
    setPrivateKey(null)
    setAddress(null)
    setBalance(null)
    setNetworkCache(null)
  }, [])

  return {
    address,
    privateKey,
    balance,
    networkCache,
    isLoading,
    error,
    createWallet,
    importWallet,
    importFromMnemonic,
    refreshBalance,
    refreshNetworkCache,
    clearWallet,
  }
}
