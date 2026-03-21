import {
  Scene,
  Vector3,
  TransformNode,
  MeshBuilder,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'

// ── Tuning ────────────────────────────────────────────────────────────────────
const ACORN_COUNT   = 30
const PICKUP_RADIUS = 1.8   // metres (XZ)
const BOB_SPEED     = 1.8
const BOB_AMP       = 0.12
const SPIN_SPEED    = 1.1   // rad/s

// Exclusion zones
const TREE_CLEAR_SQ = 15 * 15       // stay 15 m from tree trunk at origin
const HOUSE_X_MIN   = 50, HOUSE_X_MAX = 130
const HOUSE_Z_MIN   = 57, HOUSE_Z_MAX = 123

interface AcornInst {
  root:   TransformNode
  baseX:  number
  baseZ:  number
  alive:  boolean
  phase:  number              // per-acorn bob phase offset
}

export class Acorns {
  private items: AcornInst[] = []
  private _count = 0
  private time   = 0

  constructor(scene: Scene) {
    const bodyMat = new StandardMaterial('acornBodyMat', scene)
    bodyMat.diffuseColor  = new Color3(0.45, 0.28, 0.07)
    bodyMat.specularColor = new Color3(0.30, 0.18, 0.04)

    const capMat = new StandardMaterial('acornCapMat', scene)
    capMat.diffuseColor  = new Color3(0.30, 0.18, 0.05)
    capMat.specularColor = new Color3(0.10, 0.06, 0.02)

    let spawned = 0, tries = 0
    while (spawned < ACORN_COUNT && tries < 1200) {
      tries++
      const x = (Math.random() - 0.5) * 200
      const z = (Math.random() - 0.5) * 200
      // Avoid tree trunk
      if (x * x + z * z < TREE_CLEAR_SQ) continue
      // Avoid house interior
      if (x > HOUSE_X_MIN && x < HOUSE_X_MAX && z > HOUSE_Z_MIN && z < HOUSE_Z_MAX) continue

      const root = new TransformNode(`acorn_root_${spawned}`, scene)

      // Body — elongated sphere
      const body = MeshBuilder.CreateSphere(`acorn_body_${spawned}`, { diameter: 0.55, segments: 6 }, scene)
      body.scaling.y = 1.35
      body.material  = bodyMat
      body.parent    = root

      // Cap — flattened sphere sitting on top
      const cap = MeshBuilder.CreateSphere(`acorn_cap_${spawned}`, { diameter: 0.44, segments: 5 }, scene)
      cap.scaling.y  = 0.5
      cap.position.y = 0.28
      cap.material   = capMat
      cap.parent     = root

      // Tiny stem
      const stem = MeshBuilder.CreateCylinder(`acorn_stem_${spawned}`, {
        diameter: 0.07, height: 0.18, tessellation: 5,
      }, scene)
      stem.position.y = 0.46
      stem.material   = capMat
      stem.parent     = root

      root.position.set(x, 0.35, z)
      this.items.push({ root, baseX: x, baseZ: z, alive: true, phase: Math.random() * Math.PI * 2 })
      spawned++
    }
  }

  /** Call each frame. Returns number of acorns newly collected. */
  update(dt: number, playerPos: Vector3): number {
    this.time += dt
    let collected = 0
    for (const a of this.items) {
      if (!a.alive) continue
      // Bob + spin
      a.root.position.y  = 0.35 + Math.sin(this.time * BOB_SPEED + a.phase) * BOB_AMP
      ;(a.root as any).rotation = a.root.rotation   // ensure rotation exists
      a.root.rotation.y += SPIN_SPEED * dt
      // Pickup — XZ only so flying overhead doesn't collect
      const dx = playerPos.x - a.baseX
      const dz = playerPos.z - a.baseZ
      if (dx * dx + dz * dz < PICKUP_RADIUS * PICKUP_RADIUS) {
        a.alive = false
        a.root.setEnabled(false)
        this._count++
        collected++
      }
    }
    return collected
  }

  get count(): number { return this._count }

  /** Spend one acorn. Returns false if the player has none. */
  consume(): boolean {
    if (this._count <= 0) return false
    this._count--
    return true
  }
}
