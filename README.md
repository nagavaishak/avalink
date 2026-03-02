# AvaLink

> **Send AVAX to anyone nearby. No internet. Just Bluetooth.**

AvaLink enables fully trustless AVAX transfers between two Android phones over Bluetooth Low Energy — with **zero internet connectivity** required at the time of transfer.

Built for **Avalanche Build Games 2026**.

---

## The Problem

Crypto payments break the moment internet breaks. Unstable connectivity, rural areas, crisis zones, crowded venues — any of these kill your ability to send value. Solana partially solved this with Durable Nonces, but required complex on-chain setup and still had ~90s validity windows.

EVM makes this simpler: a nonce is just an incrementing counter. A signed transaction is valid indefinitely.

---

## How It Works

```
Phone A (offline)                    Phone B (relay)
─────────────────                    ───────────────
Enter amount + address
     │
ethers.js signs offline              Open AvaLink → Receive
(private key never leaves)                    │
     │                                        │
Signed tx chunked (SHA-256)    ──BLE──►  Reassembles chunks
     │                                   SHA-256 verify
     │                                   ethers.Transaction.from()
     │                                   validateSignedTransaction()
     │                                   Saves to AsyncStorage
     │
     └── BOTH phones store pending_tx
              │                              │
              ▼ (on reconnect)               ▼ (on reconnect)
       Avalanche C-Chain ◄──── whichever gets online first broadcasts
              │
       < 1 second finality
```

**Why EVM makes this work:**
EVM nonces are simple incrementing counters — not time-limited like Solana blockhashes. A signed EVM transaction stays valid indefinitely, no on-chain setup required.

---

## Security Model

| What is transmitted over BLE | What never leaves the device |
|---|---|
| SHA-256 verified signed tx bytes | Private key |
| Chunked with integrity check | Mnemonic phrase |
| Validated before queuing | Nonce cache (SecureStore) |

- Relay (Phone B) receives signed hex only — cannot derive the private key, cannot alter the transaction, cannot forge a signature
- BLE chunks verified with SHA-256 before the tx is accepted
- Invalid txs rejected: wrong chain ID, bad type, zero value, unrecoverable sender, low gas

---

## Demo Flow

### Setup (one time)
1. Build and install APK on two Android phones
2. Open AvaLink on both → create or import wallets
3. Get test AVAX from the in-app faucet button → `faucet.avax.network`

### The Demo (≈ 90 seconds)

**Phone A (Sender)**
1. Open AvaLink → home screen shows balance
2. Put phone in **airplane mode** ✈️
3. Tap **Send** → enter recipient address + amount (e.g. 0.01 AVAX)
4. Tap **Sign Offline** — transaction signed, nonce incremented in secure storage
5. Tap **Send via Bluetooth** — BLE mesh starts, scanning for peers

**Phone B (Relay)**
1. Open AvaLink → tap **Receive**
2. BLE listener starts advertising

**Transfer**
3. Phone A sees Phone B in peer list → tap to select → transfer begins
4. Progress bar shows chunk 1/1 → ✅ sent

**Phone B receives**
5. SHA-256 verified → `ethers.Transaction.from()` validated
6. "Transaction Received" card appears with from/amount

**Broadcast**
7. Turn off airplane mode on Phone B (or Phone A)
8. First phone to reconnect auto-broadcasts to Avalanche C-Chain
9. Confirm screen shows tx hash + Snowtrace link → confirmed in < 2s

---

## Tech Stack

| Layer | Library |
|---|---|
| Framework | Expo 55, React Native 0.81, expo-router |
| Signing | ethers.js v6 (offline, EIP-1559 type 2) |
| BLE transport | @magicred-1/ble-mesh (AnonMesh-inspired) |
| Key storage | expo-secure-store (hardware-backed) |
| Integrity | expo-crypto (SHA-256) |
| Network | @react-native-community/netinfo |
| State | AsyncStorage (pending tx queue) |

**Avalanche Fuji C-Chain** — chainId 43113, < 1s finality

---

## Project Structure

```
app/
  index.tsx          Home: balance, send/receive, pending tx card
  send.tsx           3-step: details → sign offline → BLE send
  receive.tsx        QR display + BLE listener + progress bar
  confirm.tsx        Tx hash + Snowtrace link
  onboarding.tsx     Create/import wallet
  ble-test.tsx       BLE debug: mesh, self-test, rejection validation

src/
  infrastructure/
    ble/BLEAdapter.ts              BLE mesh transport (chunked, retried)
    chain/AvalancheBroadcaster.ts  broadcast + confirmation polling
  utils/
    offlineSigning.ts              cache → sign → broadcast
    bleTransactionChunking.ts      SHA-256 chunker with retry + progress
    nonceManager.ts                tx validation + nonce health check
  contexts/
    WalletContext.tsx              global wallet + network state

hooks/
  useWallet.ts          create/import, balance, nonce cache
  useBLESend.ts         mesh start, peer list, chunked send
  useBLEReceive.ts      listen, validate, queue, auto-broadcast
  useNetworkStatus.ts   reconnect detection, auto-broadcast, pending tx info
```

---

## BLE Protocol

```
Sender                    Receiver
  │── AVA_META:{json} ──►│  (transferId, totalSize, totalChunks, sha256)
  │── AVA_CHUNK:{json} ──►│  × N  (chunkIndex, data)
  │── AVA_DONE:{id} ─────►│  → reassemble → SHA-256 verify → validate
```

- Chunk size: 300 chars (fits BLE MTU after ble-mesh framing)
- Each chunk retried up to 3× with exponential backoff (200/400/800ms)
- Missing chunk detection on DONE signal

---

## Build

### Prerequisites

```bash
npm install -g eas-cli
npm install
```

### APK (Android)

```bash
# Preview APK — no dev client needed
eas build --platform android --profile preview

# Or: development build with dev client
eas build --platform android --profile development
```

### Local dev (Expo Go doesn't support BLE — use dev client)

```bash
npx expo start --dev-client
```

---

## Validation Checklist

- [x] Offline EIP-1559 signing with ethers.js v6
- [x] BLE chunked transfer with SHA-256 integrity
- [x] Per-chunk retry (3×) + configurable timing
- [x] Chunk progress bar on sender and receiver
- [x] `ethers.Transaction.from()` validates before queuing
- [x] Rejects: wrong chain, bad type, zero value, bad signature, low gas
- [x] Both devices store pending tx + attempt broadcast on reconnect
- [x] Concurrent broadcast guard (`isBroadcastingRef`)
- [x] `already known` / `nonce too low` handled gracefully (race win)
- [x] Nonce health check + auto-refresh when stale
- [x] Nonce cache synced after every broadcast
- [x] Local pipeline self-test (no second phone needed)
- [x] Pending tx card on home screen with age + Broadcast Now button

---

*"The internet goes down. Your money doesn't."*

Submission deadline: March 9, 2026
