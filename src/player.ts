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
} from '@babylonjs/core'
import type { BuildingDef, PlayerState, CharacterClass } from './types'
import { AttackSystem } from './attacks'
import { HealthSystem } from './health'

const GRAVITY        = -28    // m/s²
const JUMP_VELOCITY  =  39    // m/s upward on jump
const MOVE_SPEED     =   8    // m/s horizontal
const PLAYER_HEIGHT  =   1.8  // metres (feet → top)
const PLAYER_RADIUS  =   0.4  // metres horizontal extent
const TERMINAL_VEL   = -30    // m/s downward cap
const RESPAWN_Y      = -12    // fall off world → respawn

const SPAWN = new Vector3(0, 0, -8)

// GLB file per character class — paths relative to the page (public/ folder)
const CHAR_MODEL: Record<CharacterClass, [string, string]> = {
  warrior: ['./assets/chars/', 'knight.glb'],
  wizard:  ['./assets/chars/', 'wizard.glb'],
  rogue:   ['./assets/chars/', 'rogue.glb'],
  archer:  ['./assets/chars/', 'archer.glb'],
}

// Uniform scale applied to each loaded model.
const CHAR_SCALE: Record<CharacterClass, number> = {
  warrior: 2.0,
  wizard:  2.0,
  rogue:   2.0,
  archer:  2.0,
}

/** Measure the world-space Y of the lowest vertex in a mesh list. */
function meshBottomY(meshes: AbstractMesh[]): number {
  let minY = Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    const info = m.getBoundingInfo()
    const worldMin = info.boundingBox.minimumWorld.y
    if (worldMin < minY) minY = worldMin
  }
  return minY === Infinity ? 0 : minY
}

const ALL_CLASSES: CharacterClass[] = ['warrior', 'wizard', 'rogue', 'archer']
function randomClass(): CharacterClass {
  return ALL_CLASSES[Math.floor(Math.random() * ALL_CLASSES.length)]
}

export class Player {
  readonly mesh: Mesh                   // capsule — physics placeholder (hidden once GLB loads)
  readonly camera: ArcRotateCamera
  readonly attackSystem: AttackSystem
  readonly health: HealthSystem

  currentClass: CharacterClass = randomClass()
  onAttack: ((cls: CharacterClass, alpha: number, beta: number) => void) | null = null
  isFirstPerson = false

  // Physics state — position tracks the FEET
  readonly position = new Vector3(SPAWN.x, SPAWN.y, SPAWN.z)
  readonly velocity = new Vector3(0, 0, 0)
  onGround = false

  private charRoot: TransformNode | null = null
  private charYOffset = 0              // auto-measured feet offset
  private facingY = 0                   // last movement-facing rotation
  private modelLoaded = false           // true once GLB is shown

  private readonly keys: Record<string, boolean> = {}
  private readonly buildings: BuildingDef[]
  private readonly scene: Scene

  constructor(scene: Scene, buildings: BuildingDef[]) {
    this.scene        = scene
    this.buildings    = buildings
    this.attackSystem = new AttackSystem(scene)
    this.health       = new HealthSystem(10)

    // Visual mesh (capsule centred at feet + PLAYER_HEIGHT/2)
    this.mesh = MeshBuilder.CreateCapsule('player', {
      height: PLAYER_HEIGHT,
      radius: PLAYER_RADIUS,
    }, scene)
    const mat = new StandardMaterial('playerMat', scene)
    mat.diffuseColor = new Color3(0.2, 0.55, 1.0)
    this.mesh.material = mat

    // Arc-rotate camera — free mouse-look via pointer lock
    this.camera = new ArcRotateCamera(
      'cam',
      -Math.PI / 2,   // alpha: camera behind player on -Z side
      Math.PI / 3.5,  // beta: ~51° down from zenith
      14,             // radius
      Vector3.Zero(),
      scene,
    )
    // Manage camera manually — no built-in drag/keyboard controls
    this.camera.inputs.clear()

    const canvas = scene.getEngine().getRenderingCanvas()!
    const SENSITIVITY = 0.0025
    const MIN_BETA = 0.15
    const MAX_BETA = Math.PI / 2.05

    // Left-click: lock pointer (if not locked) OR attack (if locked)
    canvas.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      if (document.pointerLockElement === canvas) {
        // Compute strafe direction: -1 = moving left, 0 = neutral, +1 = moving right
        const _rgtX = -Math.sin(this.camera.alpha)
        const _rgtZ =  Math.cos(this.camera.alpha)
        let strafeDir = 0
        if (this.keys['KeyA'] || this.keys['ArrowLeft'])  strafeDir -= 1
        if (this.keys['KeyD'] || this.keys['ArrowRight']) strafeDir += 1
        // If strafing both directions, cancel out
        this.attackSystem.attack(
          scene,
          this.currentClass,
          this.position,
          this.camera.alpha,
          this.camera.beta,
          strafeDir,
        )
        this.onAttack?.(this.currentClass, this.camera.alpha, this.camera.beta)
      } else {
        canvas.requestPointerLock()
      }
    })

    // Free mouse-look while pointer is locked
    window.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== canvas) return
      this.camera.alpha -= e.movementX * SENSITIVITY
      // In first person allow looking far upward (beta > PI/2); TP keeps near-horizontal cap
      const maxB = this.isFirstPerson ? Math.PI * 0.88 : MAX_BETA
      this.camera.beta  = Math.max(MIN_BETA, Math.min(maxB,
        this.camera.beta - e.movementY * SENSITIVITY))
    })

    // Scroll wheel to zoom
    canvas.addEventListener('wheel', e => {
      this.camera.radius = Math.max(4, Math.min(28,
        this.camera.radius + e.deltaY * 0.02))
    }, { passive: true })

    window.addEventListener('keydown', e => { this.keys[e.code] = true })
    window.addEventListener('keyup',   e => { this.keys[e.code] = false })

    // Re-lock pointer after alt-tab: any click in the window while in-game re-acquires
    window.addEventListener('mousedown', e => {
      if (e.button !== 0) return
      const lobby = document.getElementById('lobby') as HTMLElement | null
      if (lobby?.style.display !== 'none') return
      // Don't steal focus from the debug/character-select panel
      const debugPanel = document.getElementById('debugPanel') as HTMLElement | null
      if (debugPanel?.style.display !== 'none') return
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock()
    })

    // Auto-load random starting character
    this.loadCharacter(this.currentClass)
  }

  // ── Character model loading ───────────────────────────────────────────────

  setFirstPerson(fp: boolean) {
    this.isFirstPerson = fp
    if (fp) {
      this.camera.radius = 0.01
      this.camera.beta   = Math.PI / 2   // eye-level
    } else {
      this.camera.radius = 14
      this.camera.beta   = Math.PI / 3.5
    }
    // Hide/show own model in first person
    if (this.charRoot) {
      this.charRoot.getChildMeshes().forEach(m => { m.isVisible = !fp })
    }
    this.mesh.isVisible = false  // capsule always hidden
  }

  async loadCharacter(cls: CharacterClass) {
    this.currentClass = cls

    // Dispose previous GLB
    if (this.charRoot) {
      this.charRoot.getChildMeshes().forEach(m => m.dispose())
      this.charRoot.dispose()
      this.charRoot = null
      this.mesh.isVisible = true   // show capsule while new model loads
    }

    const [rootUrl, filename] = CHAR_MODEL[cls]
    try {
      const result = await SceneLoader.ImportMeshAsync('', rootUrl, filename, this.scene)

      // Parent all loaded meshes under a single TransformNode we control
      const root = new TransformNode(`charRoot_${cls}`, this.scene)
      result.meshes.forEach(m => { if (!m.parent) m.parent = root })

      root.scaling.setAll(CHAR_SCALE[cls])
      root.rotation.y = this.facingY
      // Position temporarily at origin so bounding box is in world space
      root.position.setAll(0)

      // Force world matrices so getBoundingInfo() is accurate
      this.scene.incrementRenderId()
      result.meshes.forEach(m => m.computeWorldMatrix(true))

      // Measure how far below Y=0 the model's lowest point sits
      const bottomY = meshBottomY(result.meshes)
      this.charYOffset = -bottomY   // lift by this amount each frame

      this.charRoot    = root
      this.modelLoaded = true
      this.mesh.isVisible = false   // hide capsule now that model is ready
    } catch (err) {
      console.error('[Player] Failed to load character model', cls, err)
      // Capsule stays visible on error
    }
  }

  update(dt: number) {
    // --- Horizontal movement relative to camera's yaw (alpha) ---
    const a = this.camera.alpha
    // Forward: direction from camera toward target in XZ plane = (-cos a, -sin a)
    // Right:   forward rotated 90° CW in XZ = (-sin a, cos a)
    const fwdX = -Math.cos(a),  fwdZ = -Math.sin(a)
    const rgtX = -Math.sin(a),  rgtZ =  Math.cos(a)

    let mx = 0, mz = 0
    if (this.keys['KeyW'] || this.keys['ArrowUp'])    { mx += fwdX; mz += fwdZ }
    if (this.keys['KeyS'] || this.keys['ArrowDown'])  { mx -= fwdX; mz -= fwdZ }
    if (this.keys['KeyA'] || this.keys['ArrowLeft'])  { mx -= rgtX; mz -= rgtZ }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) { mx += rgtX; mz += rgtZ }
    const len = Math.sqrt(mx * mx + mz * mz)
    if (len > 0) { mx /= len; mz /= len }

    this.velocity.x = mx * MOVE_SPEED
    this.velocity.z = mz * MOVE_SPEED

    // Jump
    if ((this.keys['Space'] || this.keys['KeyE']) && this.onGround) {
      this.velocity.y = JUMP_VELOCITY
      this.onGround = false
    }

    // Gravity (with terminal velocity cap)
    this.velocity.y += GRAVITY * dt
    if (this.velocity.y < TERMINAL_VEL) this.velocity.y = TERMINAL_VEL

    // Integrate
    this.position.x += this.velocity.x * dt
    this.position.y += this.velocity.y * dt
    this.position.z += this.velocity.z * dt

    // Respawn if fallen off the world
    if (this.position.y < RESPAWN_Y) this.respawn()

    // Collisions (sets onGround)
    this.onGround = false
    this.resolveCollisions()

    // Sync capsule mesh — centre at feet + half height
    this.mesh.position.set(
      this.position.x,
      this.position.y + PLAYER_HEIGHT / 2,
      this.position.z,
    )
    // Model always faces the camera's look direction (mouse turning rotates the character)
    this.facingY         = Math.atan2(fwdX, fwdZ)
    this.mesh.rotation.y = this.facingY

    // Sync loaded character model to feet position (Y offset auto-measured from bounding box)
    if (this.charRoot) {
      this.charRoot.position.set(
        this.position.x,
        this.position.y + this.charYOffset,
        this.position.z,
      )
      this.charRoot.rotation.y = this.facingY
    }

    // Camera tracks the mesh centre; in first person raise to eye height
    this.camera.target.copyFrom(this.mesh.position)
    if (this.isFirstPerson) {
      this.camera.target.y = this.position.y + 1.65
    }

    // Tick health (invulnerability timer) + apply blink visibility
    this.health.update(dt)
    this.setVisible(this.health.blinkVisible())

    // Tick attack effects
    this.attackSystem.update(dt)
  }

  respawn() {
    this.position.copyFrom(SPAWN)
    this.velocity.setAll(0)
    this.health.reset()
  }

  private setVisible(v: boolean) {
    if (!this.modelLoaded) this.mesh.isVisible = v
    this.charRoot?.getChildMeshes(false).forEach(m => { m.isVisible = v })
  }

  private resolveCollisions() {
    // Ground plane
    if (this.position.y < 0) {
      this.position.y = 0
      if (this.velocity.y < 0) this.velocity.y = 0
      this.onGround = true
    }

    // Building AABB resolution (minimum-overlap axis)
    for (const b of this.buildings) {
      const hw = b.width  / 2
      const hd = b.depth  / 2

      const pL = this.position.x - PLAYER_RADIUS
      const pR = this.position.x + PLAYER_RADIUS
      const pB = this.position.z - PLAYER_RADIUS
      const pF = this.position.z + PLAYER_RADIUS
      const pFt = this.position.y              // feet
      const pTp = this.position.y + PLAYER_HEIGHT

      const bL = b.x - hw,  bR = b.x + hw
      const bBk = b.z - hd, bFr = b.z + hd

      const overlapX = Math.min(pR, bR)  - Math.max(pL, bL)
      const overlapY = Math.min(pTp, b.height) - Math.max(pFt, 0)
      const overlapZ = Math.min(pF, bFr) - Math.max(pB, bBk)

      if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) continue

      // Resolve along the axis with the smallest penetration
      if (overlapY <= overlapX && overlapY <= overlapZ) {
        // Vertical: landing on top or bumping ceiling
        const playerMidY = pFt + PLAYER_HEIGHT / 2
        if (playerMidY >= b.height / 2) {
          // Came from above — land on roof
          this.position.y = b.height
          if (this.velocity.y < 0) this.velocity.y = 0
          this.onGround = true
        } else {
          // Came from below — bonk ceiling
          this.position.y = -PLAYER_HEIGHT  // pushed below; ground check fixes this
          if (this.velocity.y > 0) this.velocity.y = 0
        }
      } else if (overlapX <= overlapZ) {
        // Horizontal X push-out
        if (this.position.x < b.x) this.position.x = bL - PLAYER_RADIUS
        else                        this.position.x = bR + PLAYER_RADIUS
        this.velocity.x = 0
      } else {
        // Horizontal Z push-out
        if (this.position.z < b.z) this.position.z = bBk - PLAYER_RADIUS
        else                        this.position.z = bFr + PLAYER_RADIUS
        this.velocity.z = 0
      }
    }
  }

  getState(): PlayerState {
    return {
      x:   this.position.x,
      y:   this.position.y,
      z:   this.position.z,
      ry:  this.camera.alpha,
      cls: this.currentClass,
    }
  }
}
