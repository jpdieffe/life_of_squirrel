import '@babylonjs/loaders/glTF'
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  ArcRotateCamera,
  Mesh,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
  PBRMaterial,
} from '@babylonjs/core'
import type { BuildingDef, PlayerState, AnimState, CharacterType } from './types'
import { HealthSystem } from './health'

const GRAVITY       = -28    // m/s^2
const JUMP_VELOCITY =  26    // m/s upward on jump  (20 × 1.3)
const MOVE_SPEED    =   8    // m/s horizontal
const SNEAK_SPEED   =   3    // m/s while sneaking
const PLAYER_HEIGHT =   1.8  // metres
const PLAYER_RADIUS =   0.4  // metres
const TERMINAL_VEL  = -30    // m/s downward cap
const RESPAWN_Y     = -12    // fall off world threshold
const SQUIRREL_SCALE = 2.0

const SPAWN = new Vector3(0, 0, -8)

const SQUIRREL_ANIM_FILES: Partial<Record<AnimState, string>> = {
  idle:  './assets/squirrel/idle.glb',
  run:   './assets/squirrel/run.glb',
  jump:  './assets/squirrel/jump.glb',
  fall:  './assets/squirrel/fall.glb',
  sneak: './assets/squirrel/sneak.glb',
  death: './assets/squirrel/death.glb',
}

const GULL_ANIM_FILES: Partial<Record<AnimState, string>> = {
  idle:  './assets/gull/idle.glb',
  walk:  './assets/gull/walk.glb',
  flap:  './assets/gull/flap.glb',
  glide: './assets/gull/glide.glb',
}

const GULL_SCALE      = 1.5
const FLAP_BOOST      = 12    // m/s upward velocity added per flap
const FLAP_COOLDOWN   = 0.22  // seconds between flap boosts
const FLAP_ANIM_DUR   = 0.22  // seconds the flap anim plays after each flap
const FLAP_SPEED_RATIO = 2.5  // playback speed multiplier for flap animation
const GLIDE_GRAVITY   = -2.5  // gravity m/s² while holding space as gull
const GULL_MOVE_SPEED    = 6      // m/s horizontal for gull on the ground
const GULL_FLY_SPEED     = 36     // m/s horizontal for gull in the air (6×)
const SPRINT_SPEED       = MOVE_SPEED * 4   // 32 m/s while sprinting
const STAMINA_DRAIN_RATE = 1.0 / 4.0       // fully drained in 4 s of sprinting
const STAMINA_REGEN_RATE = 1.0 / 3.0       // fully recovered in 3 s (after delay)
const SPRINT_REGEN_DELAY = 5.0             // seconds before regen kicks in

function meshBottomY(meshes: AbstractMesh[]): number {
  let minY = Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    const worldMin = m.getBoundingInfo().boundingBox.minimumWorld.y
    if (worldMin < minY) minY = worldMin
  }
  return minY === Infinity ? 0 : minY
}

interface AnimEntry {
  root: TransformNode
  yOffset: number
  group: AnimationGroup | null
}

export class Player {
  readonly mesh: Mesh
  readonly camera: ArcRotateCamera
  readonly health: HealthSystem

  readonly position = new Vector3(SPAWN.x, SPAWN.y, SPAWN.z)
  readonly velocity = new Vector3(0, 0, 0)
  onGround = false

  private squirrelEntries: Partial<Record<AnimState, AnimEntry>> = {}
  private gullEntries:     Partial<Record<AnimState, AnimEntry>> = {}
  private character: CharacterType = 'squirrel'
  private get activeEntries(): Partial<Record<AnimState, AnimEntry>> {
    return this.character === 'squirrel' ? this.squirrelEntries : this.gullEntries
  }
  private currentAnim: AnimState = 'idle'
  private facingY = 0
  private isDead = false
  private spaceWasDown  = false
  private flapCooldown  = 0
  private flapAnimTimer = 0
  private stamina           = 1.0
  private staminaRegenDelay = 0
  private desiredRadius     = 14   // scroll zoom target; actual radius shrinks when looking up

  private readonly keys: Record<string, boolean> = {}
  private readonly buildings: BuildingDef[]
  private readonly scene: Scene

  constructor(scene: Scene, buildings: BuildingDef[]) {
    this.scene     = scene
    this.buildings = buildings
    this.health    = new HealthSystem(10)

    this.mesh = MeshBuilder.CreateCapsule('player', {
      height: PLAYER_HEIGHT,
      radius: PLAYER_RADIUS,
    }, scene)
    const mat = new StandardMaterial('playerMat', scene)
    mat.diffuseColor = new Color3(0.2, 0.55, 1.0)
    this.mesh.material = mat
    this.mesh.isVisible = false

    this.camera = new ArcRotateCamera('cam', -Math.PI / 2, Math.PI / 3.5, 14, Vector3.Zero(), scene)
    this.camera.inputs.clear()

    const canvas = scene.getEngine().getRenderingCanvas()!
    const SENSITIVITY = 0.0025
    const MIN_BETA = 0.01
    const MAX_BETA = Math.PI * 0.85   // allow looking well above horizontal

    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock()
    })

    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas) return
      this.camera.alpha -= e.movementX * SENSITIVITY
      this.camera.beta = Math.max(MIN_BETA, Math.min(MAX_BETA,
        this.camera.beta - e.movementY * SENSITIVITY))
    })

    canvas.addEventListener('wheel', e => {
      this.desiredRadius = Math.max(4, Math.min(28, this.desiredRadius + e.deltaY * 0.02))
    }, { passive: true })

    window.addEventListener('keydown', e => { this.keys[e.code] = true })
    window.addEventListener('keyup',   e => { this.keys[e.code] = false })

    window.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      const lobby = document.getElementById('lobby') as HTMLElement | null
      if (lobby?.style.display !== 'none') return
      const debugPanel = document.getElementById('debugPanel') as HTMLElement | null
      if (debugPanel?.style.display !== 'none') return
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock()
    })

    this.loadAllAnims()
  }

  private async loadAllAnims() {
    await Promise.all([
      ...Object.entries(SQUIRREL_ANIM_FILES).map(([s, f]) =>
        this.loadAnimInto(s as AnimState, f!, this.squirrelEntries, 'sq')),
      ...Object.entries(GULL_ANIM_FILES).map(([s, f]) =>
        this.loadAnimInto(s as AnimState, f!, this.gullEntries, 'gu')),
    ])
    this.switchAnim('idle')
  }

  private async loadAnimInto(
    state: AnimState, file: string,
    dict: Partial<Record<AnimState, AnimEntry>>, prefix: string,
  ) {
    try {
      const scale  = prefix === 'gu' ? GULL_SCALE : SQUIRREL_SCALE
      const noLoop = prefix === 'sq' ? state === 'death' : state === 'flap'
      const result = await SceneLoader.ImportMeshAsync('', '', file, this.scene)
      const root   = new TransformNode(`${prefix}_player_${state}`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(scale)
      root.position.setAll(0)
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      const yOffset = -meshBottomY(result.meshes)
      result.meshes.forEach((m: AbstractMesh) => { m.isVisible = false })
      const group = result.animationGroups[0] ?? null
      if (group) { group.stop(); group.loopAnimation = !noLoop }
      dict[state] = { root, yOffset, group }
    } catch (err) {
      console.error('[Player] Failed to load anim', prefix, state, err)
    }
  }

  private switchAnim(next: AnimState) {
    if (next === this.currentAnim) return
    const prev = this.activeEntries[this.currentAnim]
    if (prev) {
      prev.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
      prev.group?.stop()
    }
    this.currentAnim = next
    const entry = this.activeEntries[next]
    if (entry) {
      entry.root.getChildMeshes(false).forEach(m => { m.isVisible = true })
      entry.group?.play(entry.group.loopAnimation)
    }
  }

  private computeAnimState(moving: boolean): AnimState {
    if (this.character === 'gull') {
      if (!this.onGround) return this.flapAnimTimer > 0 ? 'flap' : 'glide'
      return moving ? 'walk' : 'idle'
    }
    if (this.isDead) return 'death'
    if (!this.onGround) return this.velocity.y > -3 ? 'jump' : 'fall'
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) return 'sneak'
    if (moving) return 'run'
    return 'idle'
  }

  update(dt: number) {
    if (this.isDead) {
      if (this.character === 'squirrel') this.switchAnim('death')
      this.health.update(dt)
      return
    }

    const a = this.camera.alpha
    const fwdX = -Math.cos(a), fwdZ = -Math.sin(a)
    const rgtX = -Math.sin(a), rgtZ =  Math.cos(a)

    const isSneaking = this.character === 'squirrel' && (this.keys['ShiftLeft'] || this.keys['ShiftRight'])

    let mx = 0, mz = 0
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    { mx += fwdX; mz += fwdZ }
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  { mx -= fwdX; mz -= fwdZ }
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  { mx -= rgtX; mz -= rgtZ }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += rgtX; mz += rgtZ }
    const len = Math.sqrt(mx * mx + mz * mz)
    const moving = len > 0
    if (moving) { mx /= len; mz /= len }

    // Sprint: hold R while squirrel and moving (not sneaking), burns stamina
    const isSprinting = this.character === 'squirrel' && !isSneaking
      && this.keys['KeyR'] && this.stamina > 0 && moving
    if (isSprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN_RATE * dt)
      this.staminaRegenDelay = SPRINT_REGEN_DELAY
    } else {
      this.staminaRegenDelay = Math.max(0, this.staminaRegenDelay - dt)
      if (this.staminaRegenDelay <= 0) {
        this.stamina = Math.min(1.0, this.stamina + STAMINA_REGEN_RATE * dt)
      }
    }
    const staminaFill = document.getElementById('staminaFill') as HTMLElement | null
    const staminaBar  = document.getElementById('staminaBar')  as HTMLElement | null
    if (staminaFill) staminaFill.style.width = `${this.stamina * 100}%`
    if (staminaBar)  staminaBar.style.display = (isSprinting || this.stamina < 1.0) ? 'block' : 'none'

    const speed = isSneaking ? SNEAK_SPEED
      : isSprinting ? SPRINT_SPEED
      : this.character === 'gull' ? (this.onGround ? GULL_MOVE_SPEED : GULL_FLY_SPEED)
      : MOVE_SPEED

    this.velocity.x = mx * speed
    this.velocity.z = mz * speed

    const spaceDown = this.keys['Space'] || this.keys['KeyE']
    if (this.character === 'gull') {
      // Each space press = flap boost (with cooldown)
      if (spaceDown && !this.spaceWasDown && this.flapCooldown <= 0) {
        this.velocity.y   += FLAP_BOOST
        this.flapCooldown  = FLAP_COOLDOWN
        this.flapAnimTimer = FLAP_ANIM_DUR
        this.onGround      = false
        // Restart flap anim at higher speed so each press shows a full wing-beat
        const flapEntry = this.gullEntries['flap']
        if (flapEntry?.group) {
          flapEntry.group.stop()
          flapEntry.group.speedRatio = FLAP_SPEED_RATIO
          flapEntry.group.play(false)
        }
      }
      this.flapCooldown  = Math.max(0, this.flapCooldown  - dt)
      this.flapAnimTimer = Math.max(0, this.flapAnimTimer - dt)
      // Holding space = glide (very low gravity)
      this.velocity.y += (spaceDown ? GLIDE_GRAVITY : GRAVITY) * dt
    } else {
      if (spaceDown && this.onGround) {
        this.velocity.y = JUMP_VELOCITY
        this.onGround   = false
      }
      // Variable-height jump: releasing space while rising cuts upward speed
      if (!spaceDown && this.spaceWasDown && this.velocity.y > 4) {
        this.velocity.y = 4
      }
      this.velocity.y += GRAVITY * dt
    }
    this.spaceWasDown = spaceDown
    if (this.velocity.y < TERMINAL_VEL) this.velocity.y = TERMINAL_VEL

    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    if (this.position.y < RESPAWN_Y) this.respawn()

    this.onGround = false
    this.resolveCollisions()

    this.mesh.position.set(
      this.position.x,
      this.position.y + PLAYER_HEIGHT / 2,
      this.position.z,
    )

    if (moving) this.facingY = Math.atan2(fwdX, fwdZ)
    this.mesh.rotation.y = this.facingY

    this.switchAnim(this.computeAnimState(moving))
    // Speed up run animation while sprinting
    if (this.character === 'squirrel') {
      const runEntry = this.squirrelEntries['run']
      if (runEntry?.group) runEntry.group.speedRatio = isSprinting ? 1.8 : 1.0
    }

    for (const entry of Object.values(this.activeEntries)) {
      if (!entry) continue
      entry.root.position.set(
        this.position.x,
        this.position.y + entry.yOffset,
        this.position.z,
      )
      entry.root.rotation.y = this.facingY
    }

    this.camera.target.copyFrom(this.mesh.position)
    // When looking up (beta > PI/2, cos < 0), shrink radius so camera stays above y=0.3
    // rather than clamping beta — lets the player look straight up by zooming in
    const cosBeta = Math.cos(this.camera.beta)
    if (cosBeta < 0) {
      // camera.y = targetY + radius * cosBeta >= 0.3  =>  radius <= (0.3 - targetY) / cosBeta
      const maxR = (0.3 - this.camera.target.y) / cosBeta
      this.camera.radius = Math.min(this.desiredRadius, Math.max(2, maxR))
    } else {
      this.camera.radius = this.desiredRadius
    }

    this.health.update(dt)

    const v = this.health.blinkVisible()
    const sneakTransparent = this.character === 'squirrel' && isSneaking
    const activeEntry = this.activeEntries[this.currentAnim]
    activeEntry?.root.getChildMeshes(false).forEach(m => {
      m.isVisible  = v
      m.visibility = sneakTransparent ? 0.2 : 1.0
      // GLTF models use PBRMaterial; set alpha + transparencyMode so the blend actually shows
      if (m.material) {
        m.material.alpha = sneakTransparent ? 0.2 : 1.0
        if (m.material instanceof PBRMaterial) {
          // 0 = OPAQUE, 2 = ALPHABLEND
          m.material.transparencyMode = sneakTransparent ? 2 : 0
        }
      }
    })
  }

  respawn() {
    this.position.copyFrom(SPAWN)
    this.velocity.setAll(0)
    this.isDead = false
    this.health.reset()
    this.stamina           = 1.0
    this.staminaRegenDelay = 0
  }

  onDeath() {
    this.isDead = true
  }

  private resolveCollisions() {
    // Ground plane
    if (this.position.y < 0) {
      this.position.y = 0
      if (this.velocity.y < 0) this.velocity.y = 0
      this.onGround = true
    }

    for (const b of this.buildings) {
      const baseY = b.y ?? 0
      const topY  = baseY + b.height

      const hw = b.width / 2
      const hd = b.depth / 2
      const pL  = this.position.x - PLAYER_RADIUS
      const pR  = this.position.x + PLAYER_RADIUS
      const pBk = this.position.z - PLAYER_RADIUS
      const pFr = this.position.z + PLAYER_RADIUS
      const pFt = this.position.y
      const pTp = this.position.y + PLAYER_HEIGHT
      const bL  = b.x - hw,  bR  = b.x + hw
      const bBk = b.z - hd,  bFr = b.z + hd

      const overlapX = Math.min(pR,  bR)   - Math.max(pL,  bL)
      const overlapY = Math.min(pTp, topY) - Math.max(pFt, baseY)
      const overlapZ = Math.min(pFr, bFr)  - Math.max(pBk, bBk)

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue

      // Floating platforms (baseY > 0) are one-way: land on top when descending
      if (baseY > 0.1) {
        if (this.velocity.y < 0) {
          this.position.y = topY
          this.velocity.y = 0
          this.onGround = true
        }
        continue
      }

      // Ground-anchored collision — full AABB resolution
      if (overlapY <= overlapX && overlapY <= overlapZ) {
        const playerMidY = pFt + PLAYER_HEIGHT / 2
        if (playerMidY >= topY / 2) {
          this.position.y = topY
          if (this.velocity.y < 0) this.velocity.y = 0
          this.onGround = true
        } else {
          this.position.y = baseY - PLAYER_HEIGHT
          if (this.velocity.y > 0) this.velocity.y = 0
        }
      } else if (overlapX <= overlapZ) {
        if (this.position.x < b.x) this.position.x = bL - PLAYER_RADIUS
        else                        this.position.x = bR + PLAYER_RADIUS
        this.velocity.x = 0
      } else {
        if (this.position.z < b.z) this.position.z = bBk - PLAYER_RADIUS
        else                        this.position.z = bFr + PLAYER_RADIUS
        this.velocity.z = 0
      }
    }
  }

  setCharacter(c: CharacterType) {
    if (c === this.character) return
    // Hide all currently visible entries
    for (const entry of Object.values(this.activeEntries)) {
      entry?.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
      entry?.group?.stop()
    }
    this.character     = c
    this.currentAnim   = 'idle'
    this.flapCooldown  = 0
    this.flapAnimTimer = 0
    this.spaceWasDown  = false
    // Show the new character's idle
    const idleEntry = this.activeEntries['idle']
    if (idleEntry) {
      idleEntry.root.getChildMeshes(false).forEach(m => { m.isVisible = true })
      idleEntry.group?.play(true)
    }
  }

  get isCrouching(): boolean {
    return this.character === 'squirrel' && (this.keys['ShiftLeft'] || this.keys['ShiftRight'])
  }

  getState(): PlayerState {
    return {
      x:      this.position.x,
      y:      this.position.y,
      z:      this.position.z,
      ry:     this.camera.alpha,
      anim:   this.currentAnim,
      char:   this.character,
      crouch: this.isCrouching,
    }
  }
}
