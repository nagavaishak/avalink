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
import { useWalletContext } from '../src/contexts/WalletContext'

type OnboardingStep = 'choose' | 'import_key' | 'import_mnemonic'

export default function OnboardingScreen() {
  const router = useRouter()
  const { createWallet, importWallet, importFromMnemonic, isLoading, error } =
    useWalletContext()
  const [step, setStep] = useState<OnboardingStep>('choose')
  const [inputValue, setInputValue] = useState('')

  async function handleCreate() {
    await createWallet()
    router.replace('/')
  }

  async function handleImportKey() {
    await importWallet(inputValue.trim())
    if (!error) router.replace('/')
  }

  async function handleImportMnemonic() {
    await importFromMnemonic(inputValue.trim())
    if (!error) router.replace('/')
  }

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
                  onPress={() => setStep('import_key')}
                >
                  <Text className="text-white text-base font-bold">Import Private Key</Text>
                  <Text className="text-text-secondary text-xs mt-1">
                    Already have a wallet? Import it
                  </Text>
                </Pressable>

                <Pressable
                  className="bg-surface border border-border rounded-2xl py-5 items-center active:opacity-80"
                  onPress={() => setStep('import_mnemonic')}
                >
                  <Text className="text-white text-base font-bold">Import Recovery Phrase</Text>
                  <Text className="text-text-secondary text-xs mt-1">12 or 24 word phrase</Text>
                </Pressable>
              </View>
            )}

            {step === 'import_key' && (
              <View className="gap-4">
                <Pressable onPress={() => setStep('choose')} className="mb-2">
                  <Text className="text-text-secondary">← Back</Text>
                </Pressable>
                <Text className="text-white text-xl font-bold mb-2">Import Private Key</Text>

                <TextInput
                  className="bg-card border border-border rounded-xl p-4 text-white font-mono text-sm"
                  placeholder="0x..."
                  placeholderTextColor="#4A5568"
                  value={inputValue}
                  onChangeText={setInputValue}
                  multiline
                  numberOfLines={3}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {error && (
                  <Text className="text-error text-sm">{error}</Text>
                )}

                <Pressable
                  className="bg-primary rounded-2xl py-4 items-center active:opacity-80"
                  onPress={handleImportKey}
                  disabled={isLoading || !inputValue}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-white font-bold text-base">Import Wallet</Text>
                  )}
                </Pressable>
              </View>
            )}

            {step === 'import_mnemonic' && (
              <View className="gap-4">
                <Pressable onPress={() => setStep('choose')} className="mb-2">
                  <Text className="text-text-secondary">← Back</Text>
                </Pressable>
                <Text className="text-white text-xl font-bold mb-2">Import Recovery Phrase</Text>

                <TextInput
                  className="bg-card border border-border rounded-xl p-4 text-white text-sm"
                  placeholder="Enter your 12 or 24 word recovery phrase..."
                  placeholderTextColor="#4A5568"
                  value={inputValue}
                  onChangeText={setInputValue}
                  multiline
                  numberOfLines={4}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {error && (
                  <Text className="text-error text-sm">{error}</Text>
                )}

                <Pressable
                  className="bg-primary rounded-2xl py-4 items-center active:opacity-80"
                  onPress={handleImportMnemonic}
                  disabled={isLoading || !inputValue}
                >
                  {isLoading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text className="text-white font-bold text-base">Import Wallet</Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* Security note */}
            <View className="mt-8 bg-surface rounded-xl p-4 border border-border">
              <Text className="text-text-secondary text-xs text-center leading-5">
                🔒 Your private key is stored on-device only in hardware-backed secure storage.
                It never leaves your phone. AvaLink never has access to your funds.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
