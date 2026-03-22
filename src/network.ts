import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import type { NetMessage, PlayerState, EnemyState } from './types'

const FRUITS = [
  'apple','apricot','avocado','banana','berry','cherry','clementine',
  'coconut','fig','grape','guava','kiwi','lemon','lime','lychee',
  'mango','melon','nectarine','olive','orange','papaya','peach',
  'pear','pineapple','plum','pomelo','quince','raspberry','starfruit',
  'strawberry','tangerine','watermelon',
]

function fruitId(): string {
  const fruit = FRUITS[Math.floor(Math.random() * FRUITS.length)]
  const num   = Math.floor(Math.random() * 90) + 10   // 10–99
  return `${fruit}-${num}`
}

/**
 * Thin wrapper around PeerJS.
 *
 * One player calls host(), shares the displayed room code, and waits.
 * The other player calls join(code).
 * Once connected, both sides call sendPosition() every ~1/20 s.
 */
export class Network {
  private peer: Peer | null = null
  private conn: DataConnection | null = null

  /** Latest position received from the remote player (null until first packet) */
  lastRemoteState: PlayerState | null = null

  /** Latest enemy state received from host (null until first packet) */
  lastRemoteEnemyState: EnemyState | null = null

  /** Called when a P2P connection is fully established */
  onPeerConnected: (() => void) | null = null

  /** Called when any error occurs (e.g. signaling server unreachable) */
  onError: ((msg: string) => void) | null = null

  /** Called with progress messages during connection */
  onStatus: ((msg: string) => void) | null = null

  static generateRoomCode(): string { return fruitId() }

  // ── Host side ─────────────────────────────────────────────────────────────

  host(onReady: (roomId: string) => void, roomCode?: string) {
    this.destroy()
    this.peer = new Peer(roomCode ?? fruitId())

    const timeout = setTimeout(() => {
      if (!this.peer) return
      this.onError?.('Could not reach PeerJS server. Check your internet connection and try again.')
    }, 12000)

    this.peer.on('open', id => {
      clearTimeout(timeout)
      console.log('[Network] HOST registered as:', id)
      onReady(id)
    })
    // Auto-reconnect if the signaling WebSocket drops (e.g. main thread
    // blocked during heavy scene init)
    this.peer.on('disconnected', () => {
      if (this.peer && !this.peer.destroyed) {
        console.log('[Network] host signaling dropped, reconnecting…')
        this.peer.reconnect()
      }
    })
    this.peer.on('connection', conn => {
      this.conn = conn
      this.wireConn(conn)
      conn.on('open', () => { this.onPeerConnected?.() })
    })
    this.peer.on('error', err => {
      clearTimeout(timeout)
      console.error('[Network] host error', err)
      this.onError?.(`Connection error: ${(err as Error).message ?? err}`)
    })
  }

  // ── Join side ──────────────────────────────────────────────────────────────

  join(roomId: string, onConnected: () => void) {
    this.destroy()
    this.peer = new Peer()
    let attempts = 0
    const MAX_ATTEMPTS = 8
    let connected = false

    const timeout = setTimeout(() => {
      if (!this.peer) return
      this.onError?.('Could not reach PeerJS server. Check your internet connection and try again.')
    }, 12000)

    const tryConnect = () => {
      if (connected || !this.peer || this.peer.destroyed) return
      attempts++
      console.log(`[Network] connection attempt ${attempts}/${MAX_ATTEMPTS} to ${roomId}`)
      if (attempts > 1) this.onStatus?.(`Connecting to host… (attempt ${attempts}/${MAX_ATTEMPTS})`)

      const conn = this.peer!.connect(roomId, { reliable: true })
      this.conn = conn
      this.wireConn(conn)

      const connTimeout = setTimeout(() => {
        if (connected) return
        console.log('[Network] connection attempt timed out')
        if (attempts < MAX_ATTEMPTS) {
          this.onStatus?.('Connection timed out, retrying…')
          tryConnect()
        } else {
          this.onError?.('Could not connect. Make sure the host has started the game and the code is correct.')
        }
      }, 10000)

      conn.on('open', () => {
        connected = true
        clearTimeout(connTimeout)
        onConnected()
        this.onPeerConnected?.()
      })
    }

    this.peer.on('open', (id) => {
      clearTimeout(timeout)
      console.log('[Network] JOINER registered as:', id, '— connecting to room:', roomId)
      tryConnect()
    })
    this.peer.on('error', err => {
      clearTimeout(timeout)
      const errType = (err as any).type ?? ''
      console.error('[Network] join error', errType, err)

      // Host might not be registered yet — retry on peer-unavailable
      if (errType === 'peer-unavailable' && !connected && attempts < MAX_ATTEMPTS) {
        console.log('[Network] host not found yet, retrying in 4 s…')
        this.onStatus?.('Waiting for host to be ready…')
        setTimeout(tryConnect, 4000)
        return
      }

      this.onError?.(`Connection error: ${(err as Error).message ?? err}`)
    })
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private wireConn(conn: DataConnection) {
    conn.on('data', raw => {
      const msg = raw as NetMessage
      if (msg.type === 'state') {
        this.lastRemoteState = msg.state
      } else if (msg.type === 'enemy') {
        this.lastRemoteEnemyState = msg.data
      }
    })
    // 'open' handled by host()/join() directly — not here, to avoid duplicate calls
    conn.on('close', () => {
      console.log('[Network] connection closed')
      this.conn = null
    })
    conn.on('error', err => console.error('[Network] conn error', err))
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  sendPosition(state: PlayerState) {
    if (this.conn?.open) {
      const msg: NetMessage = { type: 'state', state }
      this.conn.send(msg)
    }
  }

  sendEnemyState(data: EnemyState) {
    if (this.conn?.open) {
      const msg: NetMessage = { type: 'enemy', data }
      this.conn.send(msg)
    }
  }

  isConnected(): boolean {
    return this.conn?.open ?? false
  }

  /** Force-reconnect to signaling server (call after heavy main-thread work) */
  ensureSignaling() {
    if (this.peer && !this.peer.destroyed && this.peer.disconnected) {
      console.log('[Network] forcing signaling reconnect')
      this.peer.reconnect()
    }
  }

  destroy() {
    this.peer?.destroy()
  }
}
