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
import type { BuildingDef } from './types'

// ── Tuning ────────────────────────────────────────────────────────────────────
const FOX_SCALE          = 2.5
const WANDER_SPEED       = 11      // m/s while running to a random waypoint
const STALK_SPEED        = 4.5     // m/s while sneaking toward player
const CHASE_SPEED        = 20      // m/s while chasing a fleeing player
const POUNCE_SPEED       = 22      // m/s horizontal during leap
const POUNCE_HEIGHT      = 5.0     // peak Y height during pounce arc
const AGGRO_RADIUS       = 42      // m: spots a player within this range
const DEAGGRO_RADIUS     = 52      // m: gives up stalk/chase if player gets this far
const POUNCE_RANGE       = 10      // m: triggers pounce when this close while stalking
const HIT_RADIUS         = 2.5     // m: deals damage when this close to player during leap
const POUNCE_COOLDOWN    = 1.0     // s: idle cooldown after a pounce before wandering again
const IDLE_DUR_MIN       = 2       // s: min idle pause during wander
const IDLE_DUR_MAX       = 5       // s: max idle pause during wander
const RUN_DIST_MIN       = 8       // m: min distance per wander run
const RUN_DIST_MAX       = 16      // m: max distance per wander run
const STALK_ALPHA        = 0.25    // transparency alpha while stalking
const WANDER_BOUND       = 50      // m from origin: fox wanders within this box
const GROUND_Y_MAX       = 1.5     // player y below this = on ground → stalk
const LOW_FLY_MAX        = 9       // player y below this = flying low → immediate pounce
const FLEE_RATE          = 3       // m/s: if gap is growing faster than this, player is fleeing
const CROUCH_AGGRO_RADIUS = 16     // fox can barely see a crouching player within this range

// House outer bounds — fox cannot walk through the walls (matches _buildHouse in world.ts)
const HOUSE_X_MIN = 48   // 90 - 84/2
const HOUSE_X_MAX = 132  // 90 + 84/2
const HOUSE_Z_MIN = 55   // 90 - 70/2
const HOUSE_Z_MAX = 125  // 90 + 70/2

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
  private active         = false
  private buildings: BuildingDef[] = []

  constructor(private readonly scene: Scene) {
    this.loadAnims()
    this.pickNewWaypoint()
  }

  // ── Activation ──────────────────────────────────────────────────────────────────

  setActive(on: boolean) {
    this.active = on
    if (!on) {
      for (const entry of Object.values(this.entries)) {
        entry?.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
        entry?.group?.stop()
      }
      this.state = 'idle'
    } else {
      // Spawn at a random edge position so the fox enters from off-screen
      const angle = Math.random() * Math.PI * 2
      this.pos.set(Math.cos(angle) * 40, 0, Math.sin(angle) * 40)
      this.state     = 'idle'
      this.idleTimer = 1.5
      this.prevDist  = 999
      this.pickNewWaypoint()
      this.switchAnim('idle')
    }
  }

  // ── Asset loading ──────────────────────────────────────────────────────────────────

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
    let attempts = 0
    do {
      const angle = Math.random() * Math.PI * 2
      const dist  = RUN_DIST_MIN + Math.random() * (RUN_DIST_MAX - RUN_DIST_MIN)
      this.waypoint.set(
        Math.max(-WANDER_BOUND, Math.min(WANDER_BOUND, this.pos.x + Math.sin(angle) * dist)),
        0,
        Math.max(-WANDER_BOUND, Math.min(WANDER_BOUND, this.pos.z + Math.cos(angle) * dist)),
      )
      attempts++
    } while (
      attempts < 8 &&
      this.waypoint.x > HOUSE_X_MIN && this.waypoint.x < HOUSE_X_MAX &&
      this.waypoint.z > HOUSE_Z_MIN && this.waypoint.z < HOUSE_Z_MAX
    )
  }

  // ── State handlers ───────────────────────────────────────────────────────────

  /** Eject the fox from any building collision box it has walked into. */
  private avoidBuildings() {
    for (const b of this.buildings) {
      if ((b.y ?? 0) > 2.0) continue   // skip elevated/floating platforms
      const hw = b.width / 2, hd = b.depth / 2
      const px = this.pos.x, pz = this.pos.z
      const bL = b.x - hw, bR = b.x + hw
      const bBk = b.z - hd, bFr = b.z + hd
      if (px < bL || px > bR || pz < bBk || pz > bFr) continue
      const dL = px - bL, dR = bR - px, dBk = pz - bBk, dFr = bFr - pz
      const minD = Math.min(dL, dR, dBk, dFr)
      if      (minD === dL)  this.pos.x = bL - 0.5
      else if (minD === dR)  this.pos.x = bR + 0.5
      else if (minD === dBk) this.pos.z = bBk - 0.5
      else                   this.pos.z = bFr + 0.5
    }
  }

  /** If the fox has walked into the house footprint, eject it to the nearest outer edge. */
  private avoidHouse() {
    const { x, z } = this.pos
    if (x > HOUSE_X_MIN && x < HOUSE_X_MAX && z > HOUSE_Z_MIN && z < HOUSE_Z_MAX) {
      const dLeft  = x - HOUSE_X_MIN
      const dRight = HOUSE_X_MAX - x
      const dFront = z - HOUSE_Z_MIN
      const dBack  = HOUSE_Z_MAX - z
      const minD   = Math.min(dLeft, dRight, dFront, dBack)
      if      (minD === dLeft)  this.pos.x = HOUSE_X_MIN
      else if (minD === dRight) this.pos.x = HOUSE_X_MAX
      else if (minD === dFront) this.pos.z = HOUSE_Z_MIN
      else                      this.pos.z = HOUSE_Z_MAX
    }
  }

  private updateIdle(dt: number, playerPos: Vector3, playerCrouching: boolean) {
    this.idleTimer -= dt
    if (this.idleTimer <= 0) {
      this.state = 'running'
      this.pickNewWaypoint()
      this.switchAnim('run')
    }
    this.checkAggro(playerPos, playerCrouching)
  }

  private updateRunning(dt: number, playerPos: Vector3, playerCrouching: boolean) {
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
    this.avoidHouse()
    this.avoidBuildings()
    this.checkAggro(playerPos, playerCrouching)
  }

  private checkAggro(playerPos: Vector3, playerCrouching: boolean) {
    if (playerPos.y > LOW_FLY_MAX) return  // too high, ignore
    const dx   = playerPos.x - this.pos.x
    const dz   = playerPos.z - this.pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const effectiveRadius = playerCrouching ? CROUCH_AGGRO_RADIUS : AGGRO_RADIUS
    if (dist > effectiveRadius) return
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

    // Detect fleeing: gap growing faster than FLEE_RATE m/s → chase (dt-normalised so framerate-independent)
    if (dist > this.prevDist + FLEE_RATE * dt) {
      this.state = 'chasing'
      this.switchAnim('run')
      this.prevDist = dist
      return
    }
    this.prevDist = dist

    this.pos.x += (dx / dist) * STALK_SPEED * dt
    this.pos.z += (dz / dist) * STALK_SPEED * dt
    this.facingY = Math.atan2(dx, dz)
    this.avoidHouse()
    this.avoidBuildings()
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
    this.avoidHouse()
    this.avoidBuildings()
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
    // Land on the ground directly below the player so the fox always returns to y=0
    this.pounceEnd.set(playerPos.x, 0, playerPos.z)
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

    // Parabolic arc: lerp XZ along ground, sin arc adds height (reaches flying gull mid-arc)
    this.pos.x = this.pounceStart.x + (this.pounceEnd.x - this.pounceStart.x) * t
    this.pos.z = this.pounceStart.z + (this.pounceEnd.z - this.pounceStart.z) * t
    this.pos.y = Math.sin(t * Math.PI) * POUNCE_HEIGHT

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
      this.pos.y         = 0  // always land on the ground
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

  update(dt: number, playerPos: Vector3, health: HealthSystem, playerCrouching = false, buildings: BuildingDef[] = []) {
    this.buildings = buildings
    if (!this.active) return
    switch (this.state) {
      case 'idle':     this.updateIdle(dt, playerPos, playerCrouching); break
      case 'running':  this.updateRunning(dt, playerPos, playerCrouching); break
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

  // ── Remote rendering (joiner only) ───────────────────────────────────────────

  get isActive()    { return this.active }
  get posX()        { return this.pos.x }
  get posY()        { return this.pos.y }
  get posZ()        { return this.pos.z }
  get facingAngle() { return this.facingY }
  get isStalking()  { return this.state === 'stalking' }
  get isChasing()   { return this.state === 'chasing' || this.state === 'pouncing' }

  applyRemoteState(x: number, y: number, z: number, ry: number, active: boolean, stalking: boolean) {
    if (!active) {
      if (this.active) this.setActive(false)
      return
    }
    if (!this.active) {
      this.active = true
      this.switchAnim(stalking ? 'sneak' : 'run')
    } else if (stalking !== (this.currentAnim === 'sneak')) {
      this.switchAnim(stalking ? 'sneak' : 'run')
    }
    this.state = stalking ? 'stalking' : 'running'
    this.pos.set(x, y, z)
    this.facingY = ry
    for (const entry of Object.values(this.entries)) {
      if (!entry) continue
      entry.root.position.set(x, y + entry.yOffset, z)
      entry.root.rotation.y = ry
    }
    this.applyTransparency()
  }
}
