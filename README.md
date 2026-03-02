# AvaLink

**Send AVAX to anyone nearby. No internet. Just Bluetooth.**

AvaLink is a React Native mobile app that enables fully trustless AVAX transfers between two phones using Bluetooth Low Energy (BLE), with zero internet connectivity required.

Built for Avalanche Build Games 2026.

---

## How It Works

```
Phone A (offline)
  → User enters address + amount
  → ethers.js signs transaction completely offline
  → Signed tx bytes chunked and sent via Bluetooth
        ↓
Phone B (relay)
  → Receives + reassembles signed tx bytes
  → Validates with ethers.Transaction.from()
  → Stores in local queue
        ↓ (on reconnect — BOTH phones attempt broadcast)
Avalanche C-Chain
  → Transaction confirms in < 1 second
```

## Why It Works on EVM

EVM transactions reference the sender's nonce (incrementing counter), not a recent blockhash. A signed EVM transaction stays valid indefinitely — no special on-chain setup required. Solana required complex Durable Nonce accounts for the same thing.

---

## Tech Stack

- **React Native** + Expo 55 + expo-router
- **ethers.js v6** — offline signing
- **@magicred-1/ble-mesh** — BLE peer discovery + mesh messaging (primary)
- **react-native-ble-plx** — raw BLE fallback
- **expo-secure-store** — private key storage (hardware-backed)
- **expo-crypto** — SHA-256 integrity checks

## Network

- **Testnet:** Avalanche Fuji C-Chain (chainId: 43113)
- **Explorer:** https://testnet.snowtrace.io

---

## Getting Started

### Prerequisites

- Node.js 18+
- Android phone (x2 for testing)
- EAS CLI: `npm install -g eas-cli`

### Install

```bash
npm install
```

### Build APK (for physical device testing)

```bash
# Development build (includes dev client)
eas build --platform android --profile development

# Preview APK
eas build --platform android --profile preview
```

### Run on Device

After installing the APK:
1. Open AvaLink on both phones
2. Create or import a wallet (Fuji testnet)
3. Go to the **BLE Test** screen to verify peer discovery
4. Once both phones see each other, test the full send flow in airplane mode

---

## Project Structure

```
app/
  _layout.tsx       Root layout + pending tx banner
  index.tsx         Home: balance, send/receive, status
  send.tsx          3-step: enter → sign offline → BLE send
  receive.tsx       QR display + BLE listener
  confirm.tsx       Tx confirmed + Snowtrace link
  ble-test.tsx      Day 2 debug: peer discovery test
  onboarding.tsx    Create/import wallet

src/
  infrastructure/
    ble/BLEAdapter.ts           ble-mesh primary transport
    chain/AvalancheBroadcaster.ts  broadcast + confirmation
  utils/
    offlineSigning.ts           cache → sign → broadcast
    bleTransactionChunking.ts   SHA-256 integrity chunker
    nonceManager.ts             tx validation
  contexts/
    WalletContext.tsx           global wallet + network state

hooks/
  useWallet.ts                  create/import, balance
  useBLESend.ts                 mesh start, peer list, send
  useBLEReceive.ts              listen, validate, queue
  useNetworkStatus.ts           auto-broadcast on reconnect

constants/
  avalanche.ts                  RPC, chain IDs, gas, BLE config
```

---

## Security Model

- Private key stored in hardware-backed `expo-secure-store` only
- Private key **never** transmitted over BLE — only signed tx bytes
- Relay (Phone B) receives signed hex only — cannot derive key, cannot alter tx
- BLE chunks verified with SHA-256 before queuing

---

## Build Games 2026

> *"The internet goes down. Your money doesn't."*

Submission deadline: March 9, 2026
