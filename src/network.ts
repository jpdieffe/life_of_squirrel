import Peer from 'peerjs'
import type { DataConnection } from 'peerjs'
import type { NetMessage, PlayerState, EnemyState, AcornPos } from './types'

const PEER_SERVER = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:stun.relay.metered.ca:80' },
      { urls: 'turn:standard.relay.metered.ca:80', username: '1149240b8a0d6b7c28fe6c30', credential: 'D/2XqOd5kT9ew842' },
      { urls: 'turn:standard.relay.metered.ca:80?transport=tcp', username: '1149240b8a0d6b7c28fe6c30', credential: 'D/2XqOd5kT9ew842' },
      { urls: 'turn:standard.relay.metered.ca:443', username: '1149240b8a0d6b7c28fe6c30', credential: 'D/2XqOd5kT9ew842' },
      { urls: 'turns:standard.relay.metered.ca:443?transport=tcp', username: '1149240b8a0d6b7c28fe6c30', credential: 'D/2XqOd5kT9ew842' },
    ]
  }
}

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

  /** Acorn positions received from host (null until first packet) */
  lastAcornPositions: AcornPos[] | null = null

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
    this.peer = new Peer(roomCode ?? fruitId(), PEER_SERVER)

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
    this.peer = new Peer(PEER_SERVER as any)

    const timeout = setTimeout(() => {
      if (!this.peer) return
      this.onError?.('Could not reach PeerJS server. Check your internet connection and try again.')
    }, 12000)

    this.peer.on('open', (id) => {
      clearTimeout(timeout)
      console.log('[Network] JOINER registered as:', id, '— connecting to room:', roomId)
      const conn = this.peer!.connect(roomId, { reliable: true })
      this.conn = conn
      this.wireConn(conn)

      const connTimeout = setTimeout(() => {
        this.onError?.('Could not connect to that room code. Make sure the host is waiting and the code is correct.')
      }, 15000)

      conn.on('open', () => {
        clearTimeout(connTimeout)
        onConnected()
        this.onPeerConnected?.()
      })
    })
    this.peer.on('error', err => {
      clearTimeout(timeout)
      console.error('[Network] join error', err)
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
      } else if (msg.type === 'acorns') {
        this.lastAcornPositions = msg.positions
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

  sendAcornPositions(positions: AcornPos[]) {
    if (this.conn?.open) {
      const msg: NetMessage = { type: 'acorns', positions }
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
