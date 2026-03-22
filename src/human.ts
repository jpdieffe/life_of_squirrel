import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  TransformNode,
  SceneLoader,
  AbstractMesh,
  AnimationGroup,
} from '@babylonjs/core'
import type { HealthSystem } from './health'

// ── Tuning ────────────────────────────────────────────────────────────────────
const TARGET_HEIGHT     = 7.2   // auto-scale model so it stands this tall (metres)
const HUMAN_SCALE       = 1.0   // fallback if bounding box cannot be measured
const SPAWN_X           = 90      // near the house
const SPAWN_Z           = 30      // south of the house, more open ground
const WALK_SPEED        = 3.0     // m/s while walking
const JOG_SPEED         = 6.5     // m/s while jogging
const NOTICE_RADIUS     = 9       // m: human first notices the player
const ANNOY_RADIUS      = 4       // m: player is invading personal space
const ANNOY_RATE        = 1.8     // annoyance/s while player is within ANNOY_RADIUS
const CALM_RATE         = 0.4     // annoyance/s recovered when player is far
const ANNOYED_THRESH    = 3.0     // annoyance to trigger Hit_Knockback reaction
const ATTACK_THRESH     = 6.0     // annoyance to trigger jab attack sequence
const ATTACK_DURATION   = 18.0    // s of jazz-fists before calming down
const HIT_RADIUS        = 2.5     // m: jabs can connect within this distance
const HIT_DAMAGE        = 12      // damage per hit
const HIT_INTERVAL      = 0.75    // s between jabs
const WANDER_BOUND      = 18      // m from spawn the human wanders within
const SLEEP_DUR_MIN     = 14      // s
const SLEEP_DUR_MAX     = 22      // s
const ACTIVITY_DUR_MIN  = 5       // s
const ACTIVITY_DUR_MAX  = 13      // s
const KNOCK_CONTACT_RADIUS = 3.0  // m (XZ) — contact radius for ground players
const FLY_KNOCK_RADIUS     = 6.0  // m (3D) — flying gull collision sphere radius
const HUMAN_CENTER_Y       = 3.6  // m — midpoint of the 7.2m tall human
const KNOCK_COOLDOWN       = 2.5  // s before the human can be knocked again
const KNOCKS_TO_ATTACK     = 3    // knockdowns before the human fights back

// Animation names exactly as stored in the GLB
type HumanAnim =
  | 'Confused'
  | 'Crouch_Fwd_Loop'
  | 'Death01'
  | 'Fighting Left Jab'
  | 'Fighting Right Jab'
  | 'Fixing_Kneeling'
  | 'Head Nod'
  | 'Hit_Knockback'
  | 'Idle Listening'
  | 'Idle_FoldArms_Loop'
  | 'Idle_Loop'
  | 'Jog_Fwd_Loop'
  | 'Jump_Land'
  | 'Jump_Loop'
  | 'Jump_Start'
  | 'Jumping Jacks'
  | 'Pushup'
  | 'Sitting_Idle_Loop'
  | 'Sleeping'
  | 'Walk_Loop'

// Animations that should loop
const LOOP_ANIMS = new Set<HumanAnim>([
  'Crouch_Fwd_Loop', 'Idle_FoldArms_Loop', 'Idle Listening', 'Idle_Loop',
  'Jog_Fwd_Loop', 'Jump_Loop', 'Jumping Jacks', 'Fixing_Kneeling',
  'Head Nod', 'Pushup', 'Sitting_Idle_Loop', 'Sleeping', 'Walk_Loop',
])

type HumanState =
  | 'sleeping'    // Sleeping
  | 'idle'        // various idle anims (see idleAnim field)
  | 'walking'     // Walk_Loop, moving to waypoint
  | 'jogging'     // Jog_Fwd_Loop, moving to waypoint
  | 'watching'    // Crouch_Fwd_Loop — crouching and observing the squirrel curiously
  | 'startled'    // Confused — player first appeared
  | 'annoyed'     // Hit_Knockback — player keeps bothering
  | 'attacking'   // Fighting Left/Right Jab alternating
  | 'jumping'     // Jump sequence: start → loop → land

export class Human {
  private pos     = new Vector3(SPAWN_X, 0, SPAWN_Z)
  private facingY = 0

  private state: HumanState    = 'sleeping'
  private stateTimer            = SLEEP_DUR_MIN + Math.random() * (SLEEP_DUR_MAX - SLEEP_DUR_MIN)
  private idleAnim: HumanAnim  = 'Sleeping'

  private root!: TransformNode
  private animGroups            = new Map<string, AnimationGroup>()
  private activeGroup: AnimationGroup | null = null
  private currentAnim: HumanAnim = 'Sleeping'
  private yOffset               = 0
  private loaded                = false

  private annoyance   = 0
  private attackTimer = 0
  private hitTimer    = 0
  private jabLeft     = true
  private knockCount    = 0
  private knockCooldown = 0

  private waypoint = new Vector3(SPAWN_X, 0, SPAWN_Z + 4)

  // Jump sub-phases
  private jumpPhase: 'start' | 'loop' | 'land' | null = null
  private jumpPhaseTimer = 0

  constructor(private readonly scene: Scene) {
    this.loadModel()
  }

  // ── Asset loading ────────────────────────────────────────────────────────────

  private async loadModel() {
    try {
      const result = await SceneLoader.ImportMeshAsync(
        '', '', './assets/human/human_comprehensive.glb', this.scene,
      )

      this.root = new TransformNode('human_root', this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = this.root })
      this.root.scaling.setAll(HUMAN_SCALE)

      // Measure raw bounding box to auto-scale the model to TARGET_HEIGHT metres
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      let minY = Infinity, maxY = -Infinity
      result.meshes.forEach((m: AbstractMesh) => {
        const bb = m.getBoundingInfo().boundingBox
        if (bb.minimumWorld.y < minY) minY = bb.minimumWorld.y
        if (bb.maximumWorld.y > maxY) maxY = bb.maximumWorld.y
      })
      const rawHeight = (isFinite(maxY) && isFinite(minY)) ? (maxY - minY) : 1
      const autoScale = rawHeight > 0 ? (TARGET_HEIGHT / rawHeight) : HUMAN_SCALE
      this.root.scaling.setAll(autoScale)

      // Re-measure after scaling so feet sit at y=0
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      let minY2 = Infinity
      result.meshes.forEach((m: AbstractMesh) => {
        const wMin = m.getBoundingInfo().boundingBox.minimumWorld.y
        if (wMin < minY2) minY2 = wMin
      })
      this.yOffset = isFinite(minY2) ? -minY2 : 0

      // Store all animation groups by name; stop them all initially
      result.animationGroups.forEach(g => {
        g.stop()
        this.animGroups.set(g.name, g)
      })

      this.loaded = true
      this.playAnim('Sleeping', true)
      this.updateTransform()
    } catch (err) {
      console.error('[Human] failed to load model', err)
    }
  }

  // ── Animation helpers ────────────────────────────────────────────────────────

  /**
   * Play an animation by name.
   * force=true restarts even if the same animation is already playing (used for combat).
   */
  private playAnim(anim: HumanAnim, loop: boolean, force = false) {
    if (!force && this.currentAnim === anim && loop && this.activeGroup?.isPlaying) return
    this.activeGroup?.stop()
    const g = this.animGroups.get(anim)
    if (!g) { console.warn('[Human] anim not found:', anim); return }
    g.loopAnimation = loop
    g.play(loop)
    this.activeGroup = g
    this.currentAnim = anim
  }

  private updateTransform() {
    if (!this.root) return
    this.root.position.set(this.pos.x, this.pos.y + this.yOffset, this.pos.z)
    this.root.rotation.y = this.facingY
  }

  private pickWaypoint() {
    const angle = Math.random() * Math.PI * 2
    const dist  = 5 + Math.random() * 10
    this.waypoint.set(
      Math.max(SPAWN_X - WANDER_BOUND, Math.min(SPAWN_X + WANDER_BOUND, this.pos.x + Math.sin(angle) * dist)),
      0,
      Math.max(SPAWN_Z - WANDER_BOUND, Math.min(SPAWN_Z + WANDER_BOUND, this.pos.z + Math.cos(angle) * dist)),
    )
  }

  /** Pick the next random peaceful activity */
  private pickActivity() {
    const roll = Math.random()
    if (roll < 0.16) {
      // Fold arms and stand
      this.enterIdle('Idle_FoldArms_Loop', 6 + Math.random() * 6)
    } else if (roll < 0.28) {
      // Look around, listening
      this.enterIdle('Idle Listening', 5 + Math.random() * 5)
    } else if (roll < 0.38) {
      // Nod to themselves (internal thoughts)
      this.enterIdle('Head Nod', 4 + Math.random() * 5)
    } else if (roll < 0.46) {
      // Push-ups (exercising)
      this.enterIdle('Pushup', 7 + Math.random() * 7)
    } else if (roll < 0.54) {
      // Jumping jacks (exercising)
      this.enterIdle('Jumping Jacks', 6 + Math.random() * 5)
    } else if (roll < 0.62) {
      // Fixing / kneeling (examining something on the ground)
      this.enterIdle('Fixing_Kneeling', 8 + Math.random() * 7)
    } else if (roll < 0.70) {
      // Sit and relax
      this.enterIdle('Sitting_Idle_Loop', 10 + Math.random() * 8)
    } else if (roll < 0.80) {
      // Stroll to a nearby spot
      this.state = 'walking'
      this.stateTimer = 6 + Math.random() * 7
      this.pickWaypoint()
      this.playAnim('Walk_Loop', true)
    } else if (roll < 0.90) {
      // Go for a jog
      this.state = 'jogging'
      this.stateTimer = 5 + Math.random() * 6
      this.pickWaypoint()
      this.playAnim('Jog_Fwd_Loop', true)
    } else {
      // Jump for joy
      this.startJump()
    }
  }

  private enterIdle(anim: HumanAnim, duration: number) {
    this.state     = 'idle'
    this.idleAnim  = anim
    this.stateTimer = duration
    this.playAnim(anim, true)
  }

  private startJump() {
    this.state          = 'jumping'
    this.jumpPhase      = 'start'
    this.jumpPhaseTimer = 0.65
    this.playAnim('Jump_Start', false)
  }

  // ── Per-state update handlers ────────────────────────────────────────────────

  private updateSleeping(dt: number) {
    this.stateTimer -= dt
    if (this.stateTimer <= 0) {
      // Wake up — do a confused shake as a "stretch" then settle into idle
      this.state      = 'startled'
      this.stateTimer = 1.5
      this.playAnim('Confused', false)
    }
  }

  private updateIdle(dt: number) {
    this.stateTimer -= dt
    if (this.stateTimer <= 0) this.pickActivity()
  }

  private moveToward(dt: number, target: Vector3, speed: number): boolean {
    const dx   = target.x - this.pos.x
    const dz   = target.z - this.pos.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist < 0.6) return true
    this.pos.x   += (dx / dist) * speed * dt
    this.pos.z   += (dz / dist) * speed * dt
    this.facingY  = Math.atan2(dx, dz)
    return false
  }

  private updateWalking(dt: number) {
    this.stateTimer -= dt
    const arrived = this.moveToward(dt, this.waypoint, WALK_SPEED)
    if (arrived || this.stateTimer <= 0) {
      this.enterIdle('Idle_Loop', ACTIVITY_DUR_MIN + Math.random() * ACTIVITY_DUR_MAX)
    }
  }

  private updateJogging(dt: number) {
    this.stateTimer -= dt
    const arrived = this.moveToward(dt, this.waypoint, JOG_SPEED)
    if (arrived || this.stateTimer <= 0) {
      this.enterIdle('Idle_Loop', ACTIVITY_DUR_MIN + Math.random() * ACTIVITY_DUR_MAX)
    }
  }

  private updateJumping(dt: number) {
    this.jumpPhaseTimer -= dt
    if (this.jumpPhaseTimer > 0) return
    switch (this.jumpPhase) {
      case 'start':
        this.jumpPhase      = 'loop'
        this.jumpPhaseTimer = 0.35
        this.playAnim('Jump_Loop', true)
        break
      case 'loop':
        this.jumpPhase      = 'land'
        this.jumpPhaseTimer = 0.65
        this.playAnim('Jump_Land', false)
        break
      case 'land':
      default:
        this.jumpPhase = null
        this.enterIdle('Idle_Loop', ACTIVITY_DUR_MIN + Math.random() * ACTIVITY_DUR_MAX)
    }
  }

  private facePlayer(playerPos: Vector3) {
    const dx = playerPos.x - this.pos.x
    const dz = playerPos.z - this.pos.z
    this.facingY = Math.atan2(dx, dz)
  }

  private updateStartled(dt: number, playerPos: Vector3) {
    this.facePlayer(playerPos)
    this.stateTimer -= dt
    if (this.stateTimer > 0) return
    // Crouch and watch; contact-based triggerKnock() handles escalation
    this.state      = 'watching'
    this.stateTimer = 2.5 + Math.random() * 2.0
    this.playAnim('Crouch_Fwd_Loop', true)
  }

  private updateWatching(dt: number, playerPos: Vector3) {
    // Crouch and track the player with their gaze; contact → triggerKnock() in update()
    this.facePlayer(playerPos)
    this.stateTimer -= dt
    if (this.stateTimer <= 0) {
      this.enterIdle('Idle_Loop', ACTIVITY_DUR_MIN + Math.random() * ACTIVITY_DUR_MAX)
    }
  }

  private updateAnnoyed(dt: number, playerPos: Vector3) {
    // Chase the player while annoyed
    this.moveToward(dt, playerPos, JOG_SPEED)
    this.facePlayer(playerPos)
    this.stateTimer -= dt
    if (this.stateTimer > 0) return
    // Return to calm; contact-based triggerKnock() in update() handles re-escalation
    this.enterIdle('Idle_Loop', ACTIVITY_DUR_MIN + Math.random() * ACTIVITY_DUR_MAX)
  }

  private updateAttacking(dt: number, playerPos: Vector3, health: HealthSystem) {
    // Chase the player while attacking
    this.moveToward(dt, playerPos, JOG_SPEED)
    this.facePlayer(playerPos)
    this.attackTimer -= dt
    this.hitTimer    -= dt

    if (this.hitTimer <= 0) {
      this.hitTimer = HIT_INTERVAL
      this.jabLeft  = !this.jabLeft
      const jabAnim = this.jabLeft ? 'Fighting Left Jab' : 'Fighting Right Jab'
      this.playAnim(jabAnim, false, true)

      // Deal damage if player is in reach
      const dist = Vector3.Distance(
        new Vector3(playerPos.x, 0, playerPos.z),
        new Vector3(this.pos.x,  0, this.pos.z),
      )
      if (dist < HIT_RADIUS) health.takeDamage(HIT_DAMAGE)
    }

    if (this.attackTimer <= 0) {
      // Calm down — reset annoyance + knock count so they won't instantly re-attack
      this.annoyance    = 0
      this.knockCount   = 0
      this.knockCooldown = KNOCK_COOLDOWN
      this.state      = 'startled'
      this.stateTimer = 2.5
      this.playAnim('Confused', false)
    }
  }

  // ── Knockdown ─────────────────────────────────────────────────────────────────

  private triggerKnock(playerPos: Vector3) {
    if (this.knockCooldown > 0 || this.state === 'attacking') return
    this.knockCooldown = KNOCK_COOLDOWN
    this.knockCount++
    this.facePlayer(playerPos)
    if (this.knockCount >= KNOCKS_TO_ATTACK) {
      this.state       = 'attacking'
      this.attackTimer = ATTACK_DURATION
      this.hitTimer    = 0
      this.jabLeft     = true
      this.playAnim('Fighting Left Jab', false, true)
    } else {
      this.state      = 'annoyed'
      this.stateTimer = 15 + Math.random() * 5
      this.playAnim('Jog_Fwd_Loop', true)
    }
  }

  // ── Main update ──────────────────────────────────────────────────────────────

  update(dt: number, playerPos: Vector3, playerOnGround: boolean, playerIsGull: boolean, health: HealthSystem) {
    if (!this.loaded) return

    if (this.knockCooldown > 0) this.knockCooldown = Math.max(0, this.knockCooldown - dt)

    // Contact knockdown detection
    const xzDist = Math.sqrt(
      (playerPos.x - this.pos.x) ** 2 + (playerPos.z - this.pos.z) ** 2
    )
    if (this.knockCooldown === 0 && this.state !== 'attacking') {
      const playerFlying = playerIsGull && !playerOnGround
      if (playerFlying) {
        // 3D distance to human body centre for flying gull collision
        const bodyCenter = new Vector3(this.pos.x, HUMAN_CENTER_Y, this.pos.z)
        if (Vector3.Distance(playerPos, bodyCenter) < FLY_KNOCK_RADIUS) {
          this.triggerKnock(playerPos)
        }
      } else if (xzDist < KNOCK_CONTACT_RADIUS) {
        this.triggerKnock(playerPos)
      }
    }

    const dist = xzDist

    // Update annoyance
    const notSleeping = this.state !== 'sleeping'
    if (dist < ANNOY_RADIUS && notSleeping) {
      this.annoyance = Math.min(ATTACK_THRESH + 1, this.annoyance + ANNOY_RATE * dt)
    } else if (dist > NOTICE_RADIUS * 1.5) {
      this.annoyance = Math.max(0, this.annoyance - CALM_RATE * dt)
    }

    // Interrupt peaceful states when player enters notice radius
    const peacefulState = (
      this.state === 'idle' ||
      this.state === 'walking' ||
      this.state === 'jogging' ||
      this.state === 'jumping'
    )
    if (peacefulState && dist < NOTICE_RADIUS) {
      this.state      = 'startled'
      this.stateTimer = 2.0
      this.playAnim('Confused', false)
    }

    switch (this.state) {
      case 'sleeping':  this.updateSleeping(dt); break
      case 'idle':      this.updateIdle(dt); break
      case 'walking':   this.updateWalking(dt); break
      case 'jogging':   this.updateJogging(dt); break
      case 'jumping':   this.updateJumping(dt); break
      case 'startled':  this.updateStartled(dt, playerPos); break
      case 'watching':  this.updateWatching(dt, playerPos); break
      case 'annoyed':   this.updateAnnoyed(dt, playerPos); break
      case 'attacking': this.updateAttacking(dt, playerPos, health); break
    }

    this.updateTransform()
  }

  // ── Network sync ─────────────────────────────────────────────────────────────

  applyRemoteState(x: number, y: number, z: number, ry: number, anim: string) {
    if (!this.loaded) return
    this.pos.set(x, y, z)
    this.facingY = ry
    const a = anim as HumanAnim
    if (a !== this.currentAnim) this.playAnim(a, LOOP_ANIMS.has(a))
    this.updateTransform()
  }

  get posX()      { return this.pos.x }
  get posY()      { return this.pos.y }
  get posZ()      { return this.pos.z }
  get facingAngle() { return this.facingY }
  get animName()  { return this.currentAnim }
}
