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

// ICE servers: multiple STUN servers + a free public TURN relay so WebRTC
// can punch through NAT even when direct STUN hole-punching fails.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Open Relay — free public TURN server for open-source / indie projects
  { urls: 'turn:openrelay.metered.ca:80',           username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443',          username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

const PEER_OPTS = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  debug: 1,
  config: { iceServers: ICE_SERVERS },
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

  // ── Host side ─────────────────────────────────────────────────────────────

  host(onReady: (roomId: string) => void) {
    this.destroy()
    this.peer = new Peer(fruitId(), PEER_OPTS)

    const timeout = setTimeout(() => {
      if (!this.peer) return
      this.onError?.('Could not reach PeerJS server. Check your internet connection and try again.')
    }, 12000)

    this.peer.on('open', id => {
      clearTimeout(timeout)
      onReady(id)
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
    this.peer = new Peer(PEER_OPTS)

    const timeout = setTimeout(() => {
      if (!this.peer) return
      this.onError?.('Could not reach PeerJS server. Check your internet connection and try again.')
    }, 12000)

    this.peer.on('open', () => {
      clearTimeout(timeout)
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

  destroy() {
    this.peer?.destroy()
  }
}
