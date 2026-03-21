import { Engine, Scene } from '@babylonjs/core'
import { World } from './world'
import { Player } from './player'
import { RemotePlayer } from './remote'
import { Network } from './network'
import { DebugPanel } from './debug'
import { MonsterManager } from './monsters'
import type { MapDef } from './types'

// ── Lobby UI (initialized immediately — no engine needed) ──────────────────
const canvas      = document.getElementById('renderCanvas') as HTMLCanvasElement
const lobbyEl     = document.getElementById('lobby')!
const roomCodeEl  = document.getElementById('roomCode')!
const roomInput   = document.getElementById('roomInput') as HTMLInputElement
const statusEl    = document.getElementById('status')!
const connBadgeEl = document.getElementById('connBadge')!

const network = new Network()

function setStatus(msg: string) {
  statusEl.textContent = msg
}

function showConnected() {
  connBadgeEl.style.display = 'block'
}

function networkError(msg: string) {
  setStatus(`⚠ ${msg}`)
  statusEl.style.color = '#ff6b6b'
}

async function loadActiveMap(): Promise<MapDef | undefined> {
  // Editor saves to localStorage — use that map once, then clear it
  try {
    const saved = localStorage.getItem('rooftopMap')
    if (saved) {
      localStorage.removeItem('rooftopMap')
      return JSON.parse(saved) as MapDef
    }
  } catch { /* fall through */ }

  // Randomly pick from the maps folder
  try {
    const manifest: string[] = await fetch('./maps/manifest.json').then(r => r.json())
    const file = manifest[Math.floor(Math.random() * manifest.length)]
    return await fetch(`./maps/${file}`).then(r => r.json()) as MapDef
  } catch { /* use defaults */ }

  return undefined
}

async function startGame() {
  // ── Engine & Scene ────────────────────────────────────────────────────────
  let engine: Engine | undefined
  // Try WebGL2, then WebGL1 as fallback
  for (const noWebGL2 of [false, true]) {
    try {
      engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        disableWebGL2Support: noWebGL2,
      })
      break
    } catch {
      // try next
    }
  }
  if (!engine) {
    // Give the user actionable steps
    const hint = [
      'WebGL failed to start. Try:',
      '1. Chrome → Settings → System → turn on "Use hardware acceleration"',
      '2. Type chrome://flags → search "WebGL" → enable',
      '3. Restart the browser after changing settings',
    ].join(' ')
    networkError(hint)
    return
  }

  lobbyEl.style.display = 'none'
  canvas.requestPointerLock()

  const scene   = new Scene(engine)

  // ── Game objects ──────────────────────────────────────────────────────────
  const activeMap = await loadActiveMap()

  const world    = new World(scene, activeMap)
  const player   = new Player(scene, world.buildings)
  const remote   = new RemotePlayer(scene)
  const debug    = new DebugPanel(canvas)
  const monsters = new MonsterManager(scene, world.buildings, activeMap?.monsterSpawns ?? [])

  // Wire attack hits → monster damage
  player.attackSystem.onHit = (pos, radius, damage) =>
    monsters.checkHit(pos, radius, damage)

  // Wire player death → respawn
  player.health.onDeath = () => player.respawn()

  // Sync attacks over the network so both players see each other's attack effects
  player.onAttack = (cls, alpha, beta) => network.sendAttack(cls, alpha, beta)
  network.onAttack = (cls, alpha, beta) => remote.triggerAttack(cls, alpha, beta)

  // Reflect the randomly-chosen starting character in the debug panel
  debug.setCharacter(player.currentClass)

  // ── Crosshair management ─────────────────────────────────────────────────
  const xhArcher = document.getElementById('crosshairArcher')!
  const xhWizard = document.getElementById('crosshairWizard')!
  let crosshairClass = player.currentClass

  function refreshCrosshair() {
    const locked = document.pointerLockElement === canvas
    const fp = player.isFirstPerson
    xhArcher.classList.toggle('visible', locked && fp && crosshairClass === 'archer')
    xhWizard.classList.toggle('visible', locked && fp && crosshairClass === 'wizard')
  }

  document.addEventListener('pointerlockchange', refreshCrosshair)

  // Wire character selection to the player
  debug.onCharacterChange = cls => {
    player.loadCharacter(cls)
    debug.setCharacter(cls)
    crosshairClass = cls
    refreshCrosshair()
  }

  // Wire camera toggle
  debug.onCameraToggle = fp => { player.setFirstPerson(fp); refreshCrosshair() }

  // ── Game loop ─────────────────────────────────────────────────────────────
  const SEND_INTERVAL = 1 / 20   // 20 Hz network updates
  let sendTimer = 0

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)

    player.update(dt)
    monsters.update(dt, player.position, player.health, player.attackSystem)

    sendTimer += dt
    if (sendTimer >= SEND_INTERVAL) {
      sendTimer = 0
      if (network.isConnected()) {
        network.sendPosition(player.getState())
      }
    }

    if (network.lastRemoteState) {
      remote.updateTarget(network.lastRemoteState)
      remote.update(dt)
    }

    scene.render()
  })

  window.addEventListener('resize', () => engine.resize())
}

// Host button
const hostBtn = document.getElementById('hostBtn')! as HTMLButtonElement
hostBtn.addEventListener('click', () => {
  // Second click (after code is shown) → enter the game
  if (hostBtn.dataset.ready === '1') {
    startGame()
    return
  }

  statusEl.style.color = ''
  setStatus('Connecting to signaling server…')
  roomCodeEl.textContent = '…'
  hostBtn.disabled = true
  network.onError = (msg) => {
    networkError(msg)
    hostBtn.disabled = false
  }
  network.onPeerConnected = () => {
    showConnected()
  }
  network.host(id => {
    roomCodeEl.textContent = id
    setStatus('Share that code with a friend, then click Start Playing when ready.')
    hostBtn.textContent = 'Start Playing'
    hostBtn.disabled = false
    hostBtn.dataset.ready = '1'
  })
})

// Join button
document.getElementById('joinBtn')!.addEventListener('click', () => {
  const code = roomInput.value.trim()
  if (!code) { setStatus('Paste a room code first.'); return }
  statusEl.style.color = ''
  setStatus('Connecting…')
  network.onError = networkError
  network.onPeerConnected = () => {
    setStatus('Connected!')
    showConnected()
    setTimeout(startGame, 700)
  }
  network.join(code, () => {
    setStatus('Connected!')
    showConnected()
    setTimeout(startGame, 700)
  })
})
