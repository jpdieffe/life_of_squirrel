import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  TransformNode,
  SceneLoader,
  AbstractMesh,
  AnimationGroup,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import type { HealthSystem } from './health'

// ── Tuning ────────────────────────────────────────────────────────────────────
const HAWK_SCALE        = 7.5
const PATROL_HEIGHT     = 40     // Y altitude while patrolling
const PATROL_RADIUS     = 22     // radius of circular patrol path
const PATROL_SPEED      = 8      // m/s tangential (how fast it circles)
const AGGRO_RADIUS      = 35     // horizontal distance to start diving
const DIVE_SPEED        = 26     // m/s toward player while diving
const RETURN_SPEED      = 14     // m/s while flying back up
const HIT_RADIUS        = 2.5    // XZ distance at which the dive connects
const LEAF_HIDE_DIST    = 5.5    // must match world.ts LEAF_FADE_DIST
const TRUNK_CLEARANCE   = 3.5    // hawk steers around trunk within this XZ radius
const AGGRO_COOLDOWN      = 3.0   // seconds before hawk can re-dive after a hit
const CROUCH_AGGRO_RADIUS = 12    // hawk can only see a crouching squirrel within this range
const FLAP_INTERVAL_MIN = 1.8    // seconds between patrol flaps (min)
const FLAP_INTERVAL_MAX = 4.2    // seconds between patrol flaps (max)
const FLAP_ANIM_DUR     = 0.55   // how long the flap anim plays
const FLAP_SPEED_RATIO  = 2.2    // playback speed of flap clip

type HawkAnim  = 'flap' | 'glide' | 'idle'
type HawkState = 'patrol' | 'dive' | 'returning'

interface AnimEntry {
  root:    TransformNode
  yOffset: number
  group:   AnimationGroup | null
}

export class Hawk {
  private pos   = new Vector3(PATROL_RADIUS, PATROL_HEIGHT, 0)
  private state: HawkState = 'patrol'

  private entries: Partial<Record<HawkAnim, AnimEntry>> = {}
  private currentAnim: HawkAnim = 'glide'

  private patrolAngle   = 0
  private facingY       = 0
  private flapTimer     = 1.5    // time until next patrol flap
  private flapAnimTimer = 0
  private aggroCooldown = 0      // prevents immediate re-dive after returning
  private shadowDisc!: Mesh

  constructor(
    private readonly scene: Scene,
    private readonly leaves: Mesh[],
  ) {
    this.loadAnims()

    // Blob shadow on the ground — grows faint/large when hawk is high, sharp/small when diving
    this.shadowDisc = MeshBuilder.CreateDisc('hawkShadow', { radius: 1, tessellation: 32 }, scene)
    this.shadowDisc.rotation.x = Math.PI / 2
    this.shadowDisc.position.y = 0.05
    const shadowMat = new StandardMaterial('hawkShadowMat', scene)
    shadowMat.diffuseColor = new Color3(0, 0, 0)
    shadowMat.alpha = 0.3
    shadowMat.backFaceCulling = false
    this.shadowDisc.material = shadowMat
    this.shadowDisc.isPickable = false
  }

  // ── Asset loading ────────────────────────────────────────────────────────────

  private async loadAnims() {
    const files: Record<HawkAnim, string> = {
      flap:  './assets/hawk/flap.glb',
      glide: './assets/hawk/glide.glb',
      idle:  './assets/hawk/idle.glb',
    }
    await Promise.all(
      (Object.entries(files) as [HawkAnim, string][]).map(([s, f]) => this.loadAnim(s, f))
    )
    this.switchAnim('glide')
  }

  private async loadAnim(state: HawkAnim, file: string) {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', file, this.scene)
      const root   = new TransformNode(`hawk_${state}`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(HAWK_SCALE)
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
      if (group) { group.stop(); group.loopAnimation = state !== 'flap' }
      this.entries[state] = { root, yOffset, group }
    } catch (err) {
      console.error('[Hawk] failed to load anim', state, err)
    }
  }

  private switchAnim(next: HawkAnim) {
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
      if (next === 'flap' && entry.group) {
        entry.group.speedRatio = FLAP_SPEED_RATIO
        entry.group.play(false)
      } else {
        entry.group?.play(entry.group.loopAnimation)
      }
    }
  }

  // ── Per-frame helpers ────────────────────────────────────────────────────────

  private isPlayerHidden(playerPos: Vector3, playerCrouching: boolean): boolean {
    if (playerCrouching && Vector3.Distance(this.pos, playerPos) > CROUCH_AGGRO_RADIUS) return true
    for (const leaf of this.leaves) {
      if (Vector3.Distance(leaf.position, playerPos) < LEAF_HIDE_DIST) return true
    }
    return false
  }

  // ── State updates ────────────────────────────────────────────────────────────

  private updatePatrol(dt: number, playerPos: Vector3, playerCrouching: boolean) {
    // Advance around the circle
    this.patrolAngle += (PATROL_SPEED / PATROL_RADIUS) * dt
    this.pos.set(
      Math.cos(this.patrolAngle) * PATROL_RADIUS,
      PATROL_HEIGHT,
      Math.sin(this.patrolAngle) * PATROL_RADIUS,
    )
    // Face along the tangent: velocity = (-sin(a), 0, cos(a)), atan2(x,z) convention
    this.facingY = -this.patrolAngle

    // Occasional flap
    this.flapTimer     -= dt
    this.flapAnimTimer  = Math.max(0, this.flapAnimTimer - dt)
    if (this.flapTimer <= 0) {
      this.flapTimer     = FLAP_INTERVAL_MIN + Math.random() * (FLAP_INTERVAL_MAX - FLAP_INTERVAL_MIN)
      this.flapAnimTimer = FLAP_ANIM_DUR
      this.switchAnim('flap')
    }
    if (this.flapAnimTimer <= 0 && this.currentAnim === 'flap') {
      this.switchAnim('glide')
    }

    // Check aggro
    this.aggroCooldown = Math.max(0, this.aggroCooldown - dt)
    if (this.aggroCooldown > 0) return

    const dx    = playerPos.x - this.pos.x
    const dz    = playerPos.z - this.pos.z
    const hDist = Math.sqrt(dx * dx + dz * dz)
    if (hDist < AGGRO_RADIUS && !this.isPlayerHidden(playerPos, playerCrouching)) {
      this.state = 'dive'
      this.switchAnim('glide')
    }
  }

  private updateDive(dt: number, playerPos: Vector3, health: HealthSystem, playerCrouching: boolean) {
    // Only leaves abort a locked-on hawk — crouching alone won't deter him
    if (this.isPlayerHidden(playerPos, false)) {
      this.state = 'returning'
      this.switchAnim('glide')
      return
    }

    // Aim at the player's torso (feet + 0.9 m)
    const target = playerPos.clone().addInPlaceFromFloats(0, 0.9, 0)
    const diff   = target.subtract(this.pos)
    const dist   = diff.length()

    // Use XZ-only distance for the hit check so the hawk doesn't need to be
    // at exactly the same height — just needs to pass over the player
    const xzDist = Math.sqrt(diff.x * diff.x + diff.z * diff.z)

    if (xzDist < HIT_RADIUS && this.pos.y < playerPos.y + 4) {
      health.takeDamage(1)
      this.state         = 'returning'
      this.aggroCooldown = AGGRO_COOLDOWN
      this.switchAnim('glide')
      return
    }

    const dir = diff.normalizeToNew()
    this.pos.addInPlace(dir.scale(DIVE_SPEED * dt))
    this.facingY = Math.atan2(dir.x, dir.z)
    this.avoidTrunk()
  }

  private updateReturning(dt: number) {
    // Fly back to the patrol circle at current patrol angle
    const returnTarget = new Vector3(
      Math.cos(this.patrolAngle) * PATROL_RADIUS,
      PATROL_HEIGHT,
      Math.sin(this.patrolAngle) * PATROL_RADIUS,
    )
    const diff = returnTarget.subtract(this.pos)
    const dist = diff.length()
    if (dist < 1.5) {
      this.state = 'patrol'
      this.switchAnim('glide')
      return
    }
    this.pos.addInPlace(diff.normalizeToNew().scale(RETURN_SPEED * dt))
    this.facingY = Math.atan2(diff.x, diff.z)
    this.avoidTrunk()
  }

  /** Push hawk away from trunk centre so it can't pass through */
  private avoidTrunk() {
    const xzDist = Math.sqrt(this.pos.x * this.pos.x + this.pos.z * this.pos.z)
    if (xzDist < TRUNK_CLEARANCE && xzDist > 0.01) {
      const scale = TRUNK_CLEARANCE / xzDist
      this.pos.x *= scale
      this.pos.z *= scale
    }
  }

  // ── Public update ────────────────────────────────────────────────────────────

  update(dt: number, playerPos: Vector3, health: HealthSystem, playerCrouching = false) {
    switch (this.state) {
      case 'patrol':    this.updatePatrol(dt, playerPos, playerCrouching); break
      case 'dive':      this.updateDive(dt, playerPos, health, playerCrouching); break
      case 'returning': this.updateReturning(dt); break
    }

    // Reposition all loaded model roots
    for (const entry of Object.values(this.entries)) {
      if (!entry) continue
      entry.root.position.set(this.pos.x, this.pos.y + entry.yOffset, this.pos.z)
      entry.root.rotation.y = this.facingY
    }

    // Shadow disc: small + dark when close to ground, large + faint when high up
    const heightFrac = Math.max(0, Math.min(1.2, this.pos.y / PATROL_HEIGHT))
    this.shadowDisc.position.x = this.pos.x
    this.shadowDisc.position.z = this.pos.z
    this.shadowDisc.scaling.x  = 1.5 + heightFrac * 3.5
    this.shadowDisc.scaling.z  = this.shadowDisc.scaling.x
    ;(this.shadowDisc.material as StandardMaterial).alpha =
      Math.max(0.02, 0.65 - heightFrac * 0.58)
  }
}
