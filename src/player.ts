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
} from '@babylonjs/core'
import type { BuildingDef, PlayerState, AnimState } from './types'
import { HealthSystem } from './health'

const GRAVITY       = -28    // m/s^2
const JUMP_VELOCITY =  39    // m/s upward on jump
const MOVE_SPEED    =   8    // m/s horizontal
const SNEAK_SPEED   =   3    // m/s while sneaking
const PLAYER_HEIGHT =   1.8  // metres
const PLAYER_RADIUS =   0.4  // metres
const TERMINAL_VEL  = -30    // m/s downward cap
const RESPAWN_Y     = -12    // fall off world threshold
const SQUIRREL_SCALE = 2.0

const SPAWN = new Vector3(0, 0, -8)

const ANIM_FILES: Record<AnimState, string> = {
  idle:  './assets/squirrel/idle.glb',
  run:   './assets/squirrel/run.glb',
  jump:  './assets/squirrel/jump.glb',
  fall:  './assets/squirrel/fall.glb',
  sneak: './assets/squirrel/sneak.glb',
  death: './assets/squirrel/death.glb',
}

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

  private animEntries: Partial<Record<AnimState, AnimEntry>> = {}
  private currentAnim: AnimState = 'idle'
  private facingY = 0
  private isDead = false

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
    const MIN_BETA = 0.15
    const MAX_BETA = Math.PI / 2.05

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
      this.camera.radius = Math.max(4, Math.min(28, this.camera.radius + e.deltaY * 0.02))
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
    const states: AnimState[] = ['idle', 'run', 'jump', 'fall', 'sneak', 'death']
    await Promise.all(states.map(s => this.loadAnim(s)))
    this.switchAnim('idle')
  }

  private async loadAnim(state: AnimState) {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', ANIM_FILES[state], this.scene)
      const root = new TransformNode(`squirrel_player_${state}`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(SQUIRREL_SCALE)
      root.position.setAll(0)
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      const yOffset = -meshBottomY(result.meshes)
      result.meshes.forEach((m: AbstractMesh) => { m.isVisible = false })
      const group = result.animationGroups[0] ?? null
      if (group) {
        group.stop()
        group.loopAnimation = state !== 'death'
      }
      this.animEntries[state] = { root, yOffset, group }
    } catch (err) {
      console.error('[Player] Failed to load squirrel anim', state, err)
    }
  }

  private switchAnim(next: AnimState) {
    if (next === this.currentAnim) return
    const prev = this.animEntries[this.currentAnim]
    if (prev) {
      prev.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
      prev.group?.stop()
    }
    this.currentAnim = next
    const entry = this.animEntries[next]
    if (entry) {
      entry.root.getChildMeshes(false).forEach(m => { m.isVisible = true })
      entry.group?.play(entry.group.loopAnimation)
    }
  }

  private computeAnimState(moving: boolean): AnimState {
    if (this.isDead) return 'death'
    if (!this.onGround) return this.velocity.y > -3 ? 'jump' : 'fall'
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) return 'sneak'
    if (moving) return 'run'
    return 'idle'
  }

  update(dt: number) {
    if (this.isDead) {
      this.switchAnim('death')
      this.health.update(dt)
      return
    }

    const a = this.camera.alpha
    const fwdX = -Math.cos(a), fwdZ = -Math.sin(a)
    const rgtX = -Math.sin(a), rgtZ =  Math.cos(a)

    const isSneaking = this.keys['ShiftLeft'] || this.keys['ShiftRight']
    const speed = isSneaking ? SNEAK_SPEED : MOVE_SPEED

    let mx = 0, mz = 0
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    { mx += fwdX; mz += fwdZ }
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  { mx -= fwdX; mz -= fwdZ }
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  { mx -= rgtX; mz -= rgtZ }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += rgtX; mz += rgtZ }
    const len = Math.sqrt(mx * mx + mz * mz)
    const moving = len > 0
    if (moving) { mx /= len; mz /= len }

    this.velocity.x = mx * speed
    this.velocity.z = mz * speed

    if ((this.keys['Space'] || this.keys['KeyE']) && this.onGround) {
      this.velocity.y = JUMP_VELOCITY
      this.onGround = false
    }

    this.velocity.y += GRAVITY * dt
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

    for (const entry of Object.values(this.animEntries)) {
      if (!entry) continue
      entry.root.position.set(
        this.position.x,
        this.position.y + entry.yOffset,
        this.position.z,
      )
      entry.root.rotation.y = this.facingY
    }

    this.camera.target.copyFrom(this.mesh.position)
    this.health.update(dt)

    const v = this.health.blinkVisible()
    const activeEntry = this.animEntries[this.currentAnim]
    activeEntry?.root.getChildMeshes(false).forEach(m => { m.isVisible = v })
  }

  respawn() {
    this.position.copyFrom(SPAWN)
    this.velocity.setAll(0)
    this.isDead = false
    this.health.reset()
  }

  onDeath() {
    this.isDead = true
  }

  private resolveCollisions() {
    if (this.position.y < 0) {
      this.position.y = 0
      if (this.velocity.y < 0) this.velocity.y = 0
      this.onGround = true
    }

    for (const b of this.buildings) {
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
      const overlapX = Math.min(pR,  bR)       - Math.max(pL,  bL)
      const overlapY = Math.min(pTp, b.height) - Math.max(pFt, 0)
      const overlapZ = Math.min(pFr, bFr)      - Math.max(pBk, bBk)
      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue
      if (overlapY <= overlapX && overlapY <= overlapZ) {
        const playerMidY = pFt + PLAYER_HEIGHT / 2
        if (playerMidY >= b.height / 2) {
          this.position.y = b.height
          if (this.velocity.y < 0) this.velocity.y = 0
          this.onGround = true
        } else {
          this.position.y = -PLAYER_HEIGHT
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

  getState(): PlayerState {
    return {
      x:    this.position.x,
      y:    this.position.y,
      z:    this.position.z,
      ry:   this.camera.alpha,
      anim: this.currentAnim,
    }
  }
}
