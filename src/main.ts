import { Engine, Scene } from '@babylonjs/core'
import { World } from './world'
import { Player } from './player'
import { RemotePlayer } from './remote'
import { Network } from './network'
import { DebugPanel } from './debug'
import { Hawk } from './hawk'

const canvas      = document.getElementById('renderCanvas') as HTMLCanvasElement
const lobbyEl     = document.getElementById('lobby')!
const roomCodeEl  = document.getElementById('roomCode')!
const roomInput   = document.getElementById('roomInput') as HTMLInputElement
const statusEl    = document.getElementById('status')!
const connBadgeEl = document.getElementById('connBadge')!

const network = new Network()

function setStatus(msg: string) { statusEl.textContent = msg }
function showConnected() { connBadgeEl.style.display = 'block' }
function networkError(msg: string) {
  setStatus(` ${msg}`)
  statusEl.style.color = '#ff6b6b'
}

async function startGame() {
  let engine: Engine | undefined
  for (const noWebGL2 of [false, true]) {
    try {
      engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        disableWebGL2Support: noWebGL2,
      })
      break
    } catch { /* try next */ }
  }
  if (!engine) {
    networkError([
      'WebGL failed to start. Try:',
      '1. Chrome  Settings  System  turn on "Use hardware acceleration"',
      '2. chrome://flags  search "WebGL"  enable',
      '3. Restart the browser',
    ].join(' '))
    return
  }

  lobbyEl.style.display = 'none'
  canvas.requestPointerLock()

  const scene  = new Scene(engine)
  const world      = new World(scene)
  const player     = new Player(scene, world.buildings)
  const remote     = new RemotePlayer(scene)
  const hawk       = new Hawk(scene, world.leaves)
  const debugPanel = new DebugPanel(canvas)
  debugPanel.onSwitchCharacter = () => {
    const next = player.getState().char === 'gull' ? 'squirrel' : 'gull'
    player.setCharacter(next)
    debugPanel.setCharacter(next)
  }

  player.health.onDeath = () => {
    player.onDeath()
    setTimeout(() => player.respawn(), 2000)
  }

  const SEND_INTERVAL = 1 / 20
  let sendTimer = 0

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)

    player.update(dt)
    hawk.update(dt, player.position, player.health, player.isCrouching)
    world.updateLeafFade(player.position, player.camera.position)

    sendTimer += dt
    if (sendTimer >= SEND_INTERVAL) {
      sendTimer = 0
      if (network.isConnected()) network.sendPosition(player.getState())
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
  if (hostBtn.dataset.ready === '1') { startGame(); return }

  statusEl.style.color = ''
  setStatus('Connecting to signaling server')
  roomCodeEl.textContent = ''
  hostBtn.disabled = true
  network.onError = msg => { networkError(msg); hostBtn.disabled = false }
  network.onPeerConnected = () => showConnected()
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
  setStatus('Connecting')
  network.onError = networkError
  network.onPeerConnected = () => { setStatus('Connected!'); showConnected(); setTimeout(startGame, 700) }
  network.join(code, () => { setStatus('Connected!'); showConnected(); setTimeout(startGame, 700) })
})
