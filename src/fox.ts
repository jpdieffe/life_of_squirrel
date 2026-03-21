import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  TransformNode,
  SceneLoader,
  AbstractMesh,
  AnimationGroup,
  PBRMaterial,
} from '@babylonjs/core'
import type { HealthSystem } from './health'

// ── Tuning ────────────────────────────────────────────────────────────────────
const FOX_SCALE          = 2.5
const WANDER_SPEED       = 8       // m/s while running to a random waypoint
const STALK_SPEED        = 2.5     // m/s while sneaking toward player
const CHASE_SPEED        = 12      // m/s while chasing a fleeing player
const POUNCE_SPEED       = 18      // m/s horizontal during leap
const POUNCE_HEIGHT      = 5.0     // peak Y height during pounce arc
const AGGRO_RADIUS       = 28      // m: spots a player within this range
const DEAGGRO_RADIUS     = 36      // m: gives up stalk/chase if player gets this far
const POUNCE_RANGE       = 3       // m: triggers pounce when this close while stalking
const HIT_RADIUS         = 2.5     // m: deals damage when this close to player during leap
const POUNCE_COOLDOWN    = 3.5     // s: idle cooldown after a pounce before wandering again
const IDLE_DUR_MIN       = 2       // s: min idle pause during wander
const IDLE_DUR_MAX       = 5       // s: max idle pause during wander
const RUN_DIST_MIN       = 8       // m: min distance per wander run
const RUN_DIST_MAX       = 16      // m: max distance per wander run
const STALK_ALPHA        = 0.25    // transparency alpha while stalking
const WANDER_BOUND       = 50      // m from origin: fox wanders within this box
const GROUND_Y_MAX       = 1.5     // player y below this = on ground → stalk
const LOW_FLY_MAX        = 9       // player y below this = flying low → immediate pounce
const FLEE_DIST_DELTA    = 0.8     // m: if distance grows by this much per frame, player is fleeing

type FoxAnim  = 'idle' | 'run' | 'sneak' | 'jump'
type FoxState = 'idle' | 'running' | 'stalking' | 'chasing' | 'pouncing' | 'cooldown'

interface AnimEntry {
  root:    TransformNode
  yOffset: number
  group:   AnimationGroup | null
}

export class Fox {
  private pos  = new Vector3(15, 0, 12)
  private state: FoxState = 'idle'

  private entries: Partial<Record<FoxAnim, AnimEntry>> = {}
  private currentAnim: FoxAnim = 'idle'

  private facingY      = 0
  private idleTimer    = 2
  private waypoint     = new Vector3(0, 0, 0)
  private prevDist     = 999   // distance to player last frame (for flee detection)

  // pounce arc state
  private pounceTimer    = 0
  private pounceDuration = 1
  private pounceStart    = new Vector3()
  private pounceEnd      = new Vector3()
  private hitDealt       = false

  private cooldownTimer  = 0

  constructor(private readonly scene: Scene) {
    this.loadAnims()
    this.pickNewWaypoint()
  }

  // ── Asset loading ────────────────────────────────────────────────────────────

  private async loadAnims() {
    const files: Record<FoxAnim, string> = {
      idle:  './assets/fox/idle.glb',
      run:   './assets/fox/run.glb',
      sneak: './assets/fox/sneak.glb',
      jump:  './assets/fox/jump.glb',
    }
    await Promise.all(
      (Object.entries(files) as [FoxAnim, string][]).map(([s, f]) => this.loadAnim(s, f))
    )
    this.switchAnim('idle')
  }

  private async loadAnim(state: FoxAnim, file: string) {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', file, this.scene)
      const root   = new TransformNode(`fox_${state}`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(FOX_SCALE)
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      let minY = Infinity
      result.meshes.forEach((m: AbstractMesh) => {
        const wMin = m.getBoundingInfo().boundingBox.minimumWorld.y
        if (wMin < minY) minY = wMin
      })
      const yOffset = isFinite(minY) ? -minY : 0
      result.meshes.forEach((m: AbstractMesh) => { m.isVisible = false })
      const group = result.animationGroups[0] ?? null
      if (group) { group.stop(); group.loopAnimation = state !== 'jump' }
      this.entries[state] = { root, yOffset, group }
    } catch (err) {
      console.error('[Fox] failed to load anim', state, err)
    }
  }

  private switchAnim(next: FoxAnim) {
    if (next === this.currentAnim) return
    const prev = this.entries[this.currentAnim]
    if (prev) {
      prev.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
      prev.group?.stop()
    }
    this.currentAnim = next
    const entry = this.entries[next]
    if (entry) {
      entry.root.getChildMeshes(false).forEach(m => { m.isVisible = true })
      entry.group?.play(entry.group.loopAnimation)
    }
  }

  /** Apply transparency to only the currently visible model */
  private applyTransparency() {
    const alpha = this.state === 'stalking' ? STALK_ALPHA : 1.0  // chasing/pouncing = fully opaque
    const entry = this.entries[this.currentAnim]
    if (!entry) return
    entry.root.getChildMeshes(false).forEach(m => {
      m.visibility = alpha
      if (m.material) {
        m.material.alpha = alpha
        if (m.material instanceof PBRMaterial) {
          m.material.transparencyMode = alpha < 1.0 ? 2 : 0
        }
      }
    })
  }

  private pickNewWaypoint() {
    const angle = Math.random() * Math.PI * 2
    const dist  = RUN_DIST_MIN + Math.random() * (RUN_DIST_MAX - RUN_DIST_MIN)
    this.waypoint.set(
      Math.max(-WANDER_BOUND, Math.min(WANDER_BOUND, this.pos.x + Math.sin(angle) * dist)),
      0,
      Math.max(-WANDER_BOUND, Math.min(WANDER_BOUND, this.pos.z + Math.cos(angle) * dist)),
    )
  }

  // ── State handlers ───────────────────────────────────────────────────────────

  private updateIdle(dt: number, playerPos: Vector3) {
    this.idleTimer -= dt
    if (this.idleTimer <= 0) {
      this.state = 'running'
      this.pickNewWaypoint()
      this.switchAnim('run')
    }
    this.checkAggro(playerPos)
  }

  private updateRunning(dt: number, playerPos: Vector3) {
    const dx = this.waypoint.x - this.pos.x
    const dz = this.waypoint.z - this.pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.8) {
      this.state     = 'idle'
      this.idleTimer = IDLE_DUR_MIN + Math.random() * (IDLE_DUR_MAX - IDLE_DUR_MIN)
      this.switchAnim('idle')
      return
    }
    const len = dist
    this.pos.x += (dx / len) * WANDER_SPEED * dt
    this.pos.z += (dz / len) * WANDER_SPEED * dt
    this.facingY = Math.atan2(dx, dz)
    this.checkAggro(playerPos)
  }

  private checkAggro(playerPos: Vector3) {
    if (playerPos.y > LOW_FLY_MAX) return  // too high, ignore
    const dx   = playerPos.x - this.pos.x
    const dz   = playerPos.z - this.pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist > AGGRO_RADIUS) return
    if (playerPos.y > GROUND_Y_MAX) {
      // Flying low → pounce immediately
      this.startPounce(playerPos)
    } else {
      // On ground → sneak up
      this.state = 'stalking'
      this.prevDist = dist
      this.switchAnim('sneak')
    }
  }

  private updateStalking(dt: number, playerPos: Vector3) {
    // Player took to the air
    if (playerPos.y > LOW_FLY_MAX) { this.returnToWander(); return }
    if (playerPos.y > GROUND_Y_MAX) { this.startPounce(playerPos); return }

    const dx   = playerPos.x - this.pos.x
    const dz   = playerPos.z - this.pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist > DEAGGRO_RADIUS) { this.returnToWander(); return }

    if (dist < POUNCE_RANGE) { this.startPounce(playerPos); return }

    // Detect fleeing: distance increased significantly since last frame → chase
    if (dist > this.prevDist + FLEE_DIST_DELTA) {
      this.state = 'chasing'
      this.switchAnim('run')
      this.prevDist = dist
      return
    }
    this.prevDist = dist

    this.pos.x += (dx / dist) * STALK_SPEED * dt
    this.pos.z += (dz / dist) * STALK_SPEED * dt
    this.facingY = Math.atan2(dx, dz)
  }

  private updateChasing(dt: number, playerPos: Vector3) {
    // Only chase grounded players; give up if they fly
    if (playerPos.y > LOW_FLY_MAX) { this.returnToWander(); return }
    if (playerPos.y > GROUND_Y_MAX) { this.startPounce(playerPos); return }

    const dx   = playerPos.x - this.pos.x
    const dz   = playerPos.z - this.pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist > DEAGGRO_RADIUS) { this.returnToWander(); return }
    if (dist < POUNCE_RANGE)   { this.startPounce(playerPos); return }

    this.pos.x += (dx / dist) * CHASE_SPEED * dt
    this.pos.z += (dz / dist) * CHASE_SPEED * dt
    this.facingY = Math.atan2(dx, dz)
  }

  private returnToWander() {
    this.state     = 'idle'
    this.idleTimer = IDLE_DUR_MIN + Math.random() * (IDLE_DUR_MAX - IDLE_DUR_MIN)
    this.switchAnim('idle')
  }

  private startPounce(playerPos: Vector3) {
    this.state = 'pouncing'
    this.switchAnim('jump')
    this.pounceStart.copyFrom(this.pos)
    // Land at the player's actual position (works for ground and low fly)
    this.pounceEnd.copyFrom(playerPos)
    const dx = playerPos.x - this.pos.x
    const dz = playerPos.z - this.pos.z
    const horizDist = Math.sqrt(dx * dx + dz * dz)
    this.pounceDuration = Math.max(0.3, horizDist / POUNCE_SPEED)
    this.pounceTimer    = 0
    this.hitDealt       = false
    this.facingY = Math.atan2(dx, dz)
  }

  private updatePouncing(dt: number, playerPos: Vector3, health: HealthSystem) {
    this.pounceTimer += dt
    const t = Math.min(1, this.pounceTimer / this.pounceDuration)

    // Parabolic arc: lerp XYZ, add sin arc on top of target Y
    const baseY = this.pounceStart.y + (this.pounceEnd.y - this.pounceStart.y) * t
    this.pos.x = this.pounceStart.x + (this.pounceEnd.x - this.pounceStart.x) * t
    this.pos.z = this.pounceStart.z + (this.pounceEnd.z - this.pounceStart.z) * t
    this.pos.y = baseY + Math.sin(t * Math.PI) * POUNCE_HEIGHT

    if (!this.hitDealt) {
      const dx = playerPos.x - this.pos.x
      const dy = playerPos.y - this.pos.y
      const dz = playerPos.z - this.pos.z
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < HIT_RADIUS) {
        health.takeDamage(1)
        this.hitDealt = true
      }
    }

    if (t >= 1) {
      this.pos.y         = this.pounceEnd.y
      this.state         = 'cooldown'
      this.cooldownTimer = POUNCE_COOLDOWN
      this.switchAnim('idle')
    }
  }

  private updateCooldown(dt: number) {
    this.cooldownTimer -= dt
    if (this.cooldownTimer <= 0) {
      this.returnToWander()
    }
  }

  // ── Public update ────────────────────────────────────────────────────────────

  update(dt: number, playerPos: Vector3, health: HealthSystem) {
    switch (this.state) {
      case 'idle':     this.updateIdle(dt, playerPos); break
      case 'running':  this.updateRunning(dt, playerPos); break
      case 'stalking': this.updateStalking(dt, playerPos); break
      case 'chasing':  this.updateChasing(dt, playerPos); break
      case 'pouncing': this.updatePouncing(dt, playerPos, health); break
      case 'cooldown': this.updateCooldown(dt); break
    }

    // Reposition all loaded model roots
    for (const entry of Object.values(this.entries)) {
      if (!entry) continue
      entry.root.position.set(this.pos.x, this.pos.y + entry.yOffset, this.pos.z)
      entry.root.rotation.y = this.facingY
    }

    // Apply transparency every frame based on current state
    this.applyTransparency()
  }
}
