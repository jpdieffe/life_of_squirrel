import { Engine, Scene } from '@babylonjs/core'
import { World } from './world'
import { Player } from './player'
import { RemotePlayer } from './remote'
import { Network } from './network'
import { DebugPanel } from './debug'
import { Hawk } from './hawk'
import { Fox } from './fox'
import { Human } from './human'
import { Acorns } from './acorns'
import { BuildingSystem } from './building'

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

let isHost = false

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

  // Show room code in-game so the host can still share it while playing
  const roomBadge = document.getElementById('roomBadge') as HTMLElement | null
  const liveCode  = roomCodeEl.textContent?.trim()
  if (roomBadge && liveCode && liveCode !== '—') {
    roomBadge.textContent = '🔑 ' + liveCode
    roomBadge.style.display = 'block'
  }

  const scene  = new Scene(engine)
  const world      = new World(scene)
  const player     = new Player(scene, world.buildings)
  const remote     = new RemotePlayer(scene)
  const hawk       = new Hawk(scene, world.leaves)
  const fox        = new Fox(scene)
  const human      = new Human(scene)
  const acorns     = new Acorns(scene)
  const building   = new BuildingSystem(scene)
  const debugPanel = new DebugPanel(canvas)
  debugPanel.onSwitchCharacter = () => {
    const next = player.getState().char === 'gull' ? 'squirrel' : 'gull'
    player.setCharacter(next)
    debugPanel.setCharacter(next)
  }

  const acornCountEl = document.getElementById('acornCount')!
  const buildModeEl  = document.getElementById('buildMode')!
  const sneakEyeEl   = document.getElementById('sneakEye') as HTMLElement | null
  acornCountEl.style.display = 'block'
  if (sneakEyeEl) sneakEyeEl.style.display = 'block'

  // ── Sneak-eye state machine ─────────────────────────────────────────────────
  // Drives the #sneakEye indicator:
  //   'chased'  → red open eye  (enemy is actively chasing / diving)
  //   'hidden'  → closed eye    (crouching, or inside leaf foliage)
  //   'open'    → normal open eye (exposed in the open)
  type EyeState = 'open' | 'hidden' | 'chased'
  let lastEyeState: EyeState = 'open'
  function setEyeState(s: EyeState) {
    if (!sneakEyeEl || s === lastEyeState) return
    lastEyeState = s
    sneakEyeEl.classList.remove('hidden', 'chased')
    if (s !== 'open') sneakEyeEl.classList.add(s)
    // Animate the lids
    const lidTop = sneakEyeEl.querySelector('#eyeLidTop')
    const lidBot = sneakEyeEl.querySelector('#eyeLidBot')
    if (s === 'hidden') {
      // Lids close — both paths sweep across to meet at centre line
      if (lidTop) lidTop.setAttribute('d', 'M 7 23 Q 23 20 39 23 Q 23 23 7 23 Z')
      if (lidBot) lidBot.setAttribute('d', 'M 7 23 Q 23 26 39 23 Q 23 23 7 23 Z')
    } else {
      // Lids open
      if (lidTop) lidTop.setAttribute('d', 'M 7 23 Q 23 10 39 23 Q 23 14 7 23 Z')
      if (lidBot) lidBot.setAttribute('d', 'M 7 23 Q 23 36 39 23 Q 23 32 7 23 Z')
    }
  }
  // ───────────────────────────────────────────────────────────────────────────

  // T → toggle building mode
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT') return
    if (document.pointerLockElement !== canvas) return
    e.preventDefault()
    building.toggle()
    buildModeEl.style.display = building.isActive ? 'block' : 'none'
  })

  // Left-click in build mode → place block
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || document.pointerLockElement !== canvas) return
    if (!building.isActive) return
    const def = building.place(() => acorns.consume())
    if (def) world.buildings.push(def)
  })

  player.health.onDeath = () => {
    player.onDeath()
    setTimeout(() => player.respawn(), 2000)
  }

  // ── Wave manager ─────────────────────────────────────────────────────────────
  const PEACE_DURATION  = 60   // s of calm before an enemy appears
  const ALERT_DURATION  = 5    // s the warning banner is shown
  const ACTIVE_DURATION = 60   // s the enemy is active

  type WavePhase = 'peace' | 'alerting' | 'active'
  let wavePhase: WavePhase    = 'peace'
  let waveTimer               = PEACE_DURATION
  let activeEnemy: 'hawk' | 'fox' | null = null

  const alertEl = document.getElementById('enemyAlert')!

  function pickEnemy(): 'hawk' | 'fox' {
    return Math.random() < 0.5 ? 'hawk' : 'fox'
  }

  function showAlert(msg: string) {
    alertEl.textContent = msg
    alertEl.classList.remove('enemy-alert-show')
    void alertEl.offsetWidth          // force reflow to restart animation
    alertEl.classList.add('enemy-alert-show')
  }

  function deactivateActive() {
    if (activeEnemy === 'hawk') hawk.setActive(false)
    else if (activeEnemy === 'fox') fox.setActive(false)
    activeEnemy = null
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const SEND_INTERVAL = 1 / 20
  let sendTimer = 0

  engine.runRenderLoop(() => {
    const dt = Math.min(engine.getDeltaTime() / 1000, 0.05)

    player.update(dt)
    world.updateLeafFade(player.position, player.camera.position)
    acorns.update(dt, player.position)
    building.update(player.position, player.facingAngle)
    acornCountEl.textContent = `🌰 ${acorns.count}`

    // ── Sneak eye update ─────────────────────────────────────────────────────
    {
      const chased = (hawk.isActive && hawk.isDiving) || (fox.isActive && fox.isChasing)
      const hidden = !chased && (player.isCrouching || world.isPlayerHidden(player.position))
      setEyeState(chased ? 'chased' : hidden ? 'hidden' : 'open')
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Wave tick (host only) ────────────────────────────────────────────────
    if (isHost) {
      waveTimer -= dt
      if (wavePhase === 'peace' && waveTimer <= 0) {
        wavePhase = 'alerting'
        waveTimer = ALERT_DURATION
        activeEnemy = pickEnemy()
        showAlert(activeEnemy === 'hawk'
          ? '⚠ A hawk has been spotted!'
          : '⚠ A fox is lurking nearby!')
      } else if (wavePhase === 'alerting' && waveTimer <= 0) {
        wavePhase = 'active'
        waveTimer = ACTIVE_DURATION
        if (activeEnemy === 'hawk') hawk.setActive(true)
        else if (activeEnemy === 'fox') fox.setActive(true)
      } else if (wavePhase === 'active' && waveTimer <= 0) {
        deactivateActive()
        wavePhase = 'peace'
        waveTimer = PEACE_DURATION
      }

      // Tick enemy AI
      if (wavePhase === 'active') {
        if (activeEnemy === 'hawk') hawk.update(dt, player.position, player.health, player.isCrouching)
        else if (activeEnemy === 'fox') fox.update(dt, player.position, player.health, player.isCrouching, world.buildings)
      }
      // Human NPC always active
      human.update(dt, player.position, player.onGround, player.isGull, player.health)

      // Broadcast enemy positions to joiner
      if (network.isConnected()) {
        network.sendEnemyState({
          hawkActive: hawk.isActive,
          hx: hawk.posX, hy: hawk.posY, hz: hawk.posZ, hry: hawk.facingAngle,
          foxActive:  fox.isActive,
          fx: fox.posX,  fy: fox.posY,  fz: fox.posZ,  fry: fox.facingAngle,
          foxStalking: fox.isStalking,
          huX: human.posX, huY: human.posY, huZ: human.posZ, huRY: human.facingAngle,
          huAnim: human.animName,
        })
      }
    } else {
      // Joiner: apply enemy positions received from host
      if (network.lastRemoteEnemyState) {
        const es = network.lastRemoteEnemyState
        if (es.hawkActive && !hawk.isActive) showAlert('⚠ A hawk has been spotted!')
        else if (es.foxActive && !fox.isActive) showAlert('⚠ A fox is lurking nearby!')
        hawk.applyRemoteState(es.hx, es.hy, es.hz, es.hry, es.hawkActive)
        fox.applyRemoteState(es.fx, es.fy, es.fz, es.fry, es.foxActive, es.foxStalking)
        if (es.huAnim !== undefined) {
          human.applyRemoteState(es.huX, es.huY, es.huZ, es.huRY, es.huAnim)
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

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
  if (hostBtn.dataset.ready === '1') { isHost = true; startGame(); return }

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
  setStatus('Connecting…')
  network.onError = networkError
  network.onPeerConnected = () => showConnected()   // badge only; game started by onConnected
  network.join(code, () => { setStatus('Connected!'); showConnected(); setTimeout(startGame, 700) })
})
