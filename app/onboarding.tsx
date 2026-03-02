import React, { useState } from 'react'
import {
  View,
  Text,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ethers } from 'ethers'
import { useWalletContext } from '../src/contexts/WalletContext'

type OnboardingStep = 'choose' | 'import_key' | 'import_mnemonic'

export default function OnboardingScreen() {
  const router = useRouter()
  const { createWallet, importWallet, importFromMnemonic, isLoading, error } =
    useWalletContext()
  const [step, setStep] = useState<OnboardingStep>('choose')
  const [inputValue, setInputValue] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  async function handleCreate() {
    setLocalError(null)
    await createWallet()
    router.replace('/')
  }

  async function handleImportKey() {
    setLocalError(null)
    const trimmed = inputValue.trim()
    try {
      // Validate key format synchronously before calling context
      new ethers.Wallet(trimmed)
      await importWallet(trimmed)
      router.replace('/')
    } catch {
      setLocalError('Invalid private key — must be a 64-char hex string starting with 0x')
    }
  }

  async function handleImportMnemonic() {
    setLocalError(null)
    const trimmed = inputValue.trim()
    try {
      ethers.Wallet.fromPhrase(trimmed)
      await importFromMnemonic(trimmed)
      router.replace('/')
    } catch {
      setLocalError('Invalid recovery phrase — check your 12 or 24 word phrase')
    }
  }

  const displayError = localError ?? error

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }}>
          <View className="flex-1 px-6 pt-16 pb-8">

            {/* Logo */}
            <View className="items-center mb-12">
              <View className="w-20 h-20 bg-primary/20 border-2 border-primary rounded-3xl items-center justify-center mb-4">
                <Text className="text-4xl">⚡</Text>
              </View>
              <Text className="text-white text-4xl font-bold mb-2">AvaLink</Text>
              <Text className="text-text-secondary text-sm text-center">
                The internet goes down.{'\n'}Your money doesn't.
              </Text>
            </View>

            {/* ── Choose flow ── */}
            {step === 'choose' && (
              <View className="gap-4">
                <Text className="text-text-secondary text-center mb-4 text-sm">
                  Send AVAX to anyone nearby via Bluetooth.{'\n'}No internet required.
                </Text>

                <Pressable
                  className="bg-primary rounded-2xl py-5 items-center active:opacity-80"
                  onPress={handleCreate}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Text className="text-white text-base font-bold">Create New Wallet</Text>
                      <Text className="text-white/60 text-xs mt-1">
                        Generate a fresh Avalanche wallet
                      </Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  className="bg-card border border-border rounded-2xl py-5 items-center active:opacity-80"
                  onPress={() => { setStep('import_key'); setInputValue(''); setLocalError(null) }}
                >
                  <Text className="text-white text-base font-bold">Import Private Key</Text>
                  <Text className="text-text-secondary text-xs mt-1">
                    Already have a wallet? Import it
                  </Text>
                </Pressable>

                <Pressable
                  className="bg-surface border border-border rounded-2xl py-5 items-center active:opacity-80"
                  onPress={() => { setStep('import_mnemonic'); setInputValue(''); setLocalError(null) }}
                >
                  <Text className="text-white text-base font-bold">Import Recovery Phrase</Text>
                  <Text className="text-text-secondary text-xs mt-1">12 or 24 word phrase</Text>
                </Pressable>
              </View>
            )}

            {/* ── Import private key ── */}
            {step === 'import_key' && (
              <View className="gap-4">
                <Pressable onPress={() => setStep('choose')} className="mb-2">
                  <Text className="text-text-secondary">← Back</Text>
                </Pressable>
                <Text className="text-white text-xl font-bold mb-2">Import Private Key</Text>
                <Text className="text-text-muted text-xs mb-2">
                  Your key stays on this device in hardware-backed secure storage.
                </Text>

                <TextInput
                  className="bg-card border border-border rounded-xl p-4 text-white font-mono text-sm"
                  placeholder="0x..."
                  placeholderTextColor="#4A5568"
                  value={inputValue}
                  onChangeText={(t) => { setInputValue(t); setLocalError(null) }}
                  multiline
                  numberOfLines={3}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {displayError && (
                  <View className="bg-error/10 border border-error/30 rounded-xl p-3">
                    <Text className="text-error text-sm">{displayError}</Text>
                  </View>
                )}

                <Pressable
                  className={`rounded-2xl py-4 items-center active:opacity-80 ${
                    isLoading || !inputValue ? 'bg-surface border border-border' : 'bg-primary'
                  }`}
                  onPress={handleImportKey}
                  disabled={isLoading || !inputValue}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className={`font-bold text-base ${!inputValue ? 'text-text-muted' : 'text-white'}`}>
                      Import Wallet
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* ── Import mnemonic ── */}
            {step === 'import_mnemonic' && (
              <View className="gap-4">
                <Pressable onPress={() => setStep('choose')} className="mb-2">
                  <Text className="text-text-secondary">← Back</Text>
                </Pressable>
                <Text className="text-white text-xl font-bold mb-2">Import Recovery Phrase</Text>
                <Text className="text-text-muted text-xs mb-2">
                  Enter your 12 or 24 word phrase, separated by spaces.
                </Text>

                <TextInput
                  className="bg-card border border-border rounded-xl p-4 text-white text-sm"
                  placeholder="word1 word2 word3 ..."
                  placeholderTextColor="#4A5568"
                  value={inputValue}
                  onChangeText={(t) => { setInputValue(t); setLocalError(null) }}
                  multiline
                  numberOfLines={4}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {displayError && (
                  <View className="bg-error/10 border border-error/30 rounded-xl p-3">
                    <Text className="text-error text-sm">{displayError}</Text>
                  </View>
                )}

                <Pressable
                  className={`rounded-2xl py-4 items-center active:opacity-80 ${
                    isLoading || !inputValue ? 'bg-surface border border-border' : 'bg-primary'
                  }`}
                  onPress={handleImportMnemonic}
                  disabled={isLoading || !inputValue}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className={`font-bold text-base ${!inputValue ? 'text-text-muted' : 'text-white'}`}>
                      Import Wallet
                    </Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* Security note */}
            <View className="mt-8 bg-surface rounded-xl p-4 border border-border gap-2">
              <Text className="text-text-secondary text-xs font-semibold">🔒 Security</Text>
              <Text className="text-text-muted text-xs leading-5">
                Private key stored in hardware-backed secure storage — never in the cloud or transmitted over BLE. Only the signed transaction bytes leave this device.
              </Text>
            </View>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
