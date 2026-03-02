import { BleManager, Device, State, Characteristic } from 'react-native-ble-plx'
import { Platform, PermissionsAndroid } from 'react-native'
import { BLE } from '../../../constants/avalanche'
import { bleChunker } from '../../utils/bleTransactionChunking'
import { Buffer } from 'buffer'

export type BLERole = 'central' | 'peripheral' | 'idle'

export interface DiscoveredPeer {
  id: string
  name: string | null
  rssi: number | null
}

export type BLEEventHandler = {
  onPeerDiscovered?: (peer: DiscoveredPeer) => void
  onPeerLost?: (peerId: string) => void
  onTransactionReceived?: (signedTx: string) => void
  onTransactionError?: (error: string) => void
  onSendProgress?: (chunkIndex: number, totalChunks: number) => void
}

/**
 * Transport-agnostic BLE adapter.
 *
 * Acts as Central (scanner) when sending — scans for AvaLink peripherals.
 * Acts as Peripheral (advertiser) when receiving — waits for incoming connections.
 *
 * The chunking layer is injected via bleChunker and is completely
 * decoupled from the transport — swap out the BLE library here only.
 */
export class BLEAdapter {
  private manager: BleManager
  private role: BLERole = 'idle'
  private connectedDevice: Device | null = null
  private handlers: BLEEventHandler = {}

  constructor() {
    this.manager = new BleManager()
  }

  setHandlers(handlers: BLEEventHandler) {
    this.handlers = handlers
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true

    const apiLevel = parseInt(Platform.Version.toString(), 10)

    if (apiLevel >= 31) {
      // Android 12+
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ])
      return Object.values(results).every((r) => r === PermissionsAndroid.RESULTS.GRANTED)
    } else {
      // Android < 12
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      )
      return result === PermissionsAndroid.RESULTS.GRANTED
    }
  }

  async waitForBluetooth(): Promise<void> {
    return new Promise((resolve) => {
      const sub = this.manager.onStateChange((state) => {
        if (state === State.PoweredOn) {
          sub.remove()
          resolve()
        }
      }, true)
    })
  }

  /** Scan for nearby AvaLink devices (Central role — sender side). */
  startScanning(onPeer: (peer: DiscoveredPeer) => void): void {
    this.role = 'central'
    const seen = new Set<string>()

    this.manager.startDeviceScan(
      [BLE.SERVICE_UUID],
      { allowDuplicates: false },
      (error, device) => {
        if (error) {
          console.error('[BLE] Scan error:', error.message)
          return
        }
        if (!device) return

        // Filter to AvaLink devices only
        if (!seen.has(device.id)) {
          seen.add(device.id)
          onPeer({ id: device.id, name: device.name, rssi: device.rssi })
          this.handlers.onPeerDiscovered?.({ id: device.id, name: device.name, rssi: device.rssi })
        }
      }
    )
  }

  stopScanning(): void {
    this.manager.stopDeviceScan()
  }

  /** Connect to a peer and get a send function (Central role). */
  async connectToPeer(peerId: string): Promise<(msg: string) => Promise<void>> {
    const device = await this.manager.connectToDevice(peerId)
    await device.discoverAllServicesAndCharacteristics()
    this.connectedDevice = device

    const sendFn = async (msg: string): Promise<void> => {
      const encoded = Buffer.from(msg, 'utf-8').toString('base64')
      await device.writeCharacteristicWithResponseForService(
        BLE.SERVICE_UUID,
        BLE.TX_CHARACTERISTIC_UUID,
        encoded
      )
    }

    return sendFn
  }

  /**
   * Send a signed transaction to a connected peer via BLE chunking.
   * Tracks progress via onSendProgress handler.
   */
  async sendSignedTransaction(
    peerId: string,
    signedTx: string
  ): Promise<void> {
    const sendFn = await this.connectToPeer(peerId)

    let chunkIndex = 0
    const wrappedSendFn = async (msg: string): Promise<void> => {
      await sendFn(msg)
      if (msg.startsWith('AVA_CHUNK:')) {
        const data = JSON.parse(msg.slice('AVA_CHUNK:'.length))
        this.handlers.onSendProgress?.(chunkIndex++, data.totalChunks)
      }
    }

    await bleChunker.sendChunkedTransaction(signedTx, wrappedSendFn)
  }

  /**
   * Start listening for incoming transactions (Peripheral role — receiver side).
   * NOTE: Full peripheral mode requires native module support.
   * For MVP, we use Central scanning + characteristic subscription.
   */
  async startListening(deviceId: string): Promise<void> {
    this.role = 'peripheral'

    const device = await this.manager.connectToDevice(deviceId)
    await device.discoverAllServicesAndCharacteristics()
    this.connectedDevice = device

    device.monitorCharacteristicForService(
      BLE.SERVICE_UUID,
      BLE.RX_CHARACTERISTIC_UUID,
      async (error, characteristic) => {
        if (error) {
          console.error('[BLE] Monitor error:', error.message)
          return
        }
        if (!characteristic?.value) return

        const message = Buffer.from(characteristic.value, 'base64').toString('utf-8')
        await bleChunker.handleIncomingMessage(
          message,
          (signedTx) => this.handlers.onTransactionReceived?.(signedTx),
          (err) => this.handlers.onTransactionError?.(err)
        )
      }
    )
  }

  disconnect(): void {
    if (this.connectedDevice) {
      this.connectedDevice.cancelConnection()
      this.connectedDevice = null
    }
    this.role = 'idle'
  }

  destroy(): void {
    this.disconnect()
    this.manager.destroy()
  }
}

// Singleton BLE adapter
export const bleAdapter = new BLEAdapter()
