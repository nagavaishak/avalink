// Avalanche network constants

export const AVALANCHE = {
  FUJI: {
    chainId: 43113,
    chainIdHex: '0xA869',
    name: 'Avalanche Fuji Testnet',
    rpcUrl: 'https://api.avax-test.network/ext/bc/C/rpc',
    explorerUrl: 'https://testnet.snowtrace.io',
    nativeCurrency: {
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18,
    },
  },
  MAINNET: {
    chainId: 43114,
    chainIdHex: '0xA86A',
    name: 'Avalanche C-Chain',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    explorerUrl: 'https://snowtrace.io',
    nativeCurrency: {
      name: 'Avalanche',
      symbol: 'AVAX',
      decimals: 18,
    },
  },
} as const

// Active network for MVP — Fuji testnet
export const ACTIVE_NETWORK = AVALANCHE.FUJI

// Gas configuration
export const GAS = {
  LIMIT_AVAX_TRANSFER: 21000n,
  BUFFER_MULTIPLIER: 2n,       // 2x buffer on cached gas price
  DEFAULT_MAX_FEE_GWEI: 30,    // Fallback if fee data unavailable
  DEFAULT_PRIORITY_FEE_GWEI: 2,
} as const

// Cache settings
export const CACHE = {
  STALENESS_THRESHOLD_MS: 6 * 60 * 60 * 1000, // 6 hours
  NETWORK_CACHE_KEY: 'network_cache',
} as const

// Storage keys
export const STORAGE_KEYS = {
  PENDING_TX: 'pending_tx',
  TX_HISTORY: 'tx_history',
  WALLET_ADDRESS: 'wallet_address',
} as const

// SecureStore keys
export const SECURE_KEYS = {
  PRIVATE_KEY: 'wallet_private_key',
  NETWORK_CACHE: 'network_cache',
} as const

// Chainlink AVAX/USD price feed
export const CHAINLINK = {
  AVAX_USD_FUJI: '0x31CF013A08c6Ac228C94551d7b7Bf79e7Ef8db8F',
  AVAX_USD_MAINNET: '0x0A77230d17318075983913bC2145DB16C7366156',
} as const

// BLE configuration
export const BLE = {
  SERVICE_UUID: '12345678-1234-1234-1234-123456789012',
  TX_CHARACTERISTIC_UUID: '12345678-1234-1234-1234-123456789013',
  RX_CHARACTERISTIC_UUID: '12345678-1234-1234-1234-123456789014',
  CHUNK_SIZE: 300,
  CHUNK_DELAY_MS: 50,
  METADATA_DELAY_MS: 100,
  CHUNK_TIMEOUT_MS: 30000,
  DEVICE_NAME: 'AvaLink',
} as const

// App info
export const APP = {
  NAME: 'AvaLink',
  TAGLINE: 'The internet goes down. Your money doesn\'t.',
  VERSION: '1.0.0',
} as const
