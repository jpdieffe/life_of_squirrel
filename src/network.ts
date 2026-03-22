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

  /** Optional callback for progress updates during connection */
  onStatus: ((msg: string) => void) | null = null

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
    // Keep host registered on the signaling server — auto-reconnect if the
    // idle WebSocket drops (common after 30–60 s of waiting).
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
      conn.on('error', err => console.error('[Network] host conn error', err))
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
    this._joinAttempt(roomId, onConnected, 1)
  }

  private _joinAttempt(roomId: string, onConnected: () => void, attempt: number) {
    const MAX_ATTEMPTS = 3
    this.onStatus?.(`Connecting to signaling server (attempt ${attempt}/${MAX_ATTEMPTS})…`)

    this.peer?.destroy()
    this.peer = new Peer(PEER_OPTS)

    let connTimeout: ReturnType<typeof setTimeout> | null = null
    let settled = false              // prevents double-fire

    const settle = () => {
      settled = true
      if (connTimeout) { clearTimeout(connTimeout); connTimeout = null }
    }

    const retry = () => {
      if (settled) return
      settle()
      if (attempt < MAX_ATTEMPTS) {
        this.onStatus?.(`Retrying (${attempt + 1}/${MAX_ATTEMPTS})…`)
        setTimeout(() => this._joinAttempt(roomId, onConnected, attempt + 1), 1500)
      } else {
        this.onError?.('Could not connect after multiple attempts. Make sure the host is still waiting and the room code is correct.')
      }
    }

    const timeout = setTimeout(() => {
      if (!this.peer || settled) return
      retry()
    }, 12000)

    this.peer.on('open', () => {
      clearTimeout(timeout)
      if (settled) return
      this.onStatus?.('Signaling OK — connecting to host…')

      const conn = this.peer!.connect(roomId, { reliable: true })
      this.conn = conn
      this.wireConn(conn)

      connTimeout = setTimeout(() => {
        if (settled) return
        retry()
      }, 12000)

      conn.on('open', () => {
        if (settled) return
        settle()
        this.onStatus?.('Connected!')
        onConnected()
        this.onPeerConnected?.()
      })
      conn.on('error', err => {
        if (settled) return
        console.error('[Network] conn error', err)
        retry()
      })
    })
    this.peer.on('error', (err: any) => {
      clearTimeout(timeout)
      if (settled) return
      console.error('[Network] join error', err)
      if (err.type === 'peer-unavailable') {
        settle()
        this.onError?.('Room not found — the host may have left or the code is wrong.')
      } else {
        retry()
      }
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
    // Note: 'error' is wired per flow (host/join) so connTimeout can be cleared
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
