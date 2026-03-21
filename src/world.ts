import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Mesh,
  Ray,
} from '@babylonjs/core'
import type { BuildingDef } from './types'

//  Colours 
const C_BARK   = new Color3(0.36, 0.20, 0.07)
const C_WOOD   = new Color3(0.48, 0.28, 0.10)
const C_LEAF_A = new Color3(0.13, 0.44, 0.09)
const C_LEAF_B = new Color3(0.07, 0.30, 0.06)
const C_GROUND = new Color3(0.24, 0.54, 0.16)

const BRANCH_THICKNESS = 0.5
const LEAF_FADE_DIST   = 5.5   // units from leaf centre  start fading
const LEAF_FADE_ALPHA  = 0.22  // minimum alpha when inside

// Trunk tapers from radius 1.1 at base to 0.3 at top (height 58)
function trunkR(y: number): number {
  return Math.max(0.3, 1.1 - (y / 58) * 0.8)
}

//  Catmull-Rom spline helpers 
function catmullRom(
  p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, t: number
): Vector3 {
  const t2 = t * t, t3 = t2 * t
  return new Vector3(
    0.5 * ((2*p1.x) + (-p0.x+p2.x)*t + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2 + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3),
    0.5 * ((2*p1.y) + (-p0.y+p2.y)*t + (2*p0.y-5*p1.y+4*p2.y-p3.y)*t2 + (-p0.y+3*p1.y-3*p2.y+p3.y)*t3),
    0.5 * ((2*p1.z) + (-p0.z+p2.z)*t + (2*p0.z-5*p1.z+4*p2.z-p3.z)*t2 + (-p0.z+3*p1.z-3*p2.z+p3.z)*t3),
  )
}

function smoothPath(ctrl: Vector3[], steps: number): Vector3[] {
  const g0 = ctrl[0].scale(2).subtract(ctrl[1])
  const gN = ctrl[ctrl.length-1].scale(2).subtract(ctrl[ctrl.length-2])
  const all = [g0, ...ctrl, gN]
  const out: Vector3[] = []
  for (let i = 1; i < all.length - 2; i++) {
    for (let s = 0; s < steps; s++) {
      out.push(catmullRom(all[i-1], all[i], all[i+1], all[i+2], s / steps))
    }
  }
  out.push(ctrl[ctrl.length - 1].clone())
  return out
}

//  Branch spec 
interface BranchSpec {
  angle:    number  // direction from trunk: 0=+Z, PI/2=+X, PI=-Z, 3PI/2=-X
  attachY:  number  // Y where branch leaves trunk
  length:   number  // horizontal distance to landing pad centre
  tipY:     number  // top surface Y of landing pad
  snake:    number  // +1 or -1: which way the S-curve goes
  padW:     number
  padD:     number
}

const BRANCHES: BranchSpec[] = [
  // ── Tier 1  tip heights 5.5–7.0  (reachable from ground) ────────────────
  { angle:  0.35, attachY:  3.5, length: 10.0, tipY:  6.5, snake:  1, padW: 5.0, padD: 1.8 },
  { angle:  2.20, attachY:  4.0, length: 12.5, tipY:  5.5, snake: -1, padW: 4.5, padD: 1.6 },
  { angle: -1.10, attachY:  3.0, length:  9.0, tipY:  7.0, snake:  1, padW: 5.5, padD: 1.8 },
  { angle:  3.70, attachY:  4.5, length: 11.0, tipY:  6.0, snake: -1, padW: 4.8, padD: 1.6 },
  { angle:  1.20, attachY:  3.0, length: 13.0, tipY:  5.8, snake:  1, padW: 5.2, padD: 1.7 },

  // ── Tier 2  tip heights 11.0–13.0 ────────────────────────────────────────
  { angle:  0.80, attachY:  9.5, length: 11.0, tipY: 12.0, snake: -1, padW: 4.5, padD: 1.7 },
  { angle: -2.50, attachY: 10.0, length: 14.0, tipY: 12.5, snake:  1, padW: 5.0, padD: 1.6 },
  { angle:  1.75, attachY:  8.5, length: 10.0, tipY: 11.0, snake:  1, padW: 4.8, padD: 1.6 },
  { angle: -0.40, attachY: 10.5, length: 13.0, tipY: 13.0, snake: -1, padW: 5.2, padD: 1.8 },
  { angle:  3.00, attachY:  9.0, length:  9.5, tipY: 11.5, snake:  1, padW: 4.5, padD: 1.7 },

  // ── Tier 3  tip heights 17.5–19.5 ────────────────────────────────────────
  { angle: -0.60, attachY: 15.5, length: 12.0, tipY: 18.0, snake: -1, padW: 5.0, padD: 1.8 },
  { angle:  2.70, attachY: 17.0, length: 14.5, tipY: 19.5, snake:  1, padW: 4.8, padD: 1.7 },
  { angle:  1.00, attachY: 16.0, length: 11.5, tipY: 17.5, snake: -1, padW: 5.5, padD: 1.6 },
  { angle: -1.90, attachY: 15.0, length: 10.0, tipY: 18.5, snake:  1, padW: 4.5, padD: 1.8 },
  { angle:  3.80, attachY: 16.5, length: 13.0, tipY: 19.0, snake: -1, padW: 5.0, padD: 1.7 },

  // ── Tier 4  tip heights 24.0–26.0 ────────────────────────────────────────
  { angle:  0.20, attachY: 22.5, length: 13.0, tipY: 25.0, snake:  1, padW: 4.5, padD: 1.7 },
  { angle: -1.60, attachY: 23.0, length: 11.0, tipY: 24.0, snake: -1, padW: 5.0, padD: 1.6 },
  { angle:  2.40, attachY: 22.0, length: 14.0, tipY: 25.5, snake:  1, padW: 4.8, padD: 1.8 },
  { angle: -0.95, attachY: 24.0, length: 12.5, tipY: 26.0, snake: -1, padW: 5.2, padD: 1.7 },
  { angle:  3.30, attachY: 22.5, length: 10.5, tipY: 24.5, snake:  1, padW: 4.5, padD: 1.6 },

  // ── Tier 5  tip heights 30.5–32.5 ────────────────────────────────────────
  { angle:  1.40, attachY: 29.0, length: 12.0, tipY: 31.0, snake: -1, padW: 4.2, padD: 1.6 },
  { angle: -2.10, attachY: 30.5, length: 13.5, tipY: 32.5, snake:  1, padW: 4.5, padD: 1.7 },
  { angle:  0.55, attachY: 28.5, length: 11.0, tipY: 30.5, snake:  1, padW: 4.8, padD: 1.6 },
  { angle:  3.10, attachY: 30.0, length: 14.0, tipY: 32.0, snake: -1, padW: 4.3, padD: 1.8 },
  { angle: -0.30, attachY: 29.5, length: 10.5, tipY: 31.5, snake: -1, padW: 4.5, padD: 1.7 },

  // ── Tier 6  tip heights 36.5–40.0 ────────────────────────────────────────
  { angle:  2.00, attachY: 37.0, length: 11.5, tipY: 39.0, snake:  1, padW: 4.0, padD: 1.6 },
  { angle: -1.35, attachY: 36.5, length: 13.0, tipY: 38.0, snake: -1, padW: 4.2, padD: 1.7 },
  { angle:  0.70, attachY: 38.0, length: 10.0, tipY: 40.0, snake:  1, padW: 4.5, padD: 1.6 },
  { angle: -2.80, attachY: 36.0, length: 12.5, tipY: 37.5, snake: -1, padW: 4.0, padD: 1.8 },
  { angle:  1.85, attachY: 37.5, length:  9.5, tipY: 39.5, snake:  1, padW: 4.2, padD: 1.7 },
]

// Mid-height Y of each tier  for leaf cluster placement
const TIER_Y = [6.0, 12.0, 18.5, 25.0, 31.5, 38.0]

export class World {
  readonly buildings: BuildingDef[]
  readonly leaves: Mesh[] = []

  constructor(scene: Scene) {
    scene.clearColor = new Color4(0.55, 0.78, 0.96, 1.0)

    const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
    hemi.intensity = 0.55
    const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)
    sun.intensity = 0.95
    sun.position = new Vector3(30, 60, 30)

    //  Ground 
    const ground = MeshBuilder.CreateGround('ground', { width: 240, height: 240 }, scene)
    const gMat = new StandardMaterial('groundMat', scene)
    gMat.diffuseColor = C_GROUND
    ground.material = gMat

    //  Trunk 
    const trunkH = 58
    const trunk = MeshBuilder.CreateCylinder('trunk', {
      diameterBottom: 2.2,
      diameterTop: 0.6,
      height: trunkH,
      tessellation: 10,
    }, scene)
    trunk.position.set(0, trunkH / 2, 0)
    const trunkMat = new StandardMaterial('trunkMat', scene)
    trunkMat.diffuseColor = C_BARK
    trunk.material = trunkMat

    // Shared branch material
    const woodMat = new StandardMaterial('woodMat', scene)
    woodMat.diffuseColor = C_WOOD

    //  Branches 
    const collision: BuildingDef[] = [
      { x: 0, z: 0, width: 2, depth: 2, height: 58 },  // trunk AABB
    ]

    BRANCHES.forEach((br, i) => {
      const endX = Math.sin(br.angle) * br.length
      const endZ = Math.cos(br.angle) * br.length
      const padY = br.tipY - BRANCH_THICKNESS

      // Perpendicular in XZ for the S-curve sideways snake
      const perpX = -Math.cos(br.angle) * br.snake
      const perpZ =  Math.sin(br.angle) * br.snake

      const start = new Vector3(
        Math.sin(br.angle) * trunkR(br.attachY) * 0.9,
        br.attachY + 0.2,
        Math.cos(br.angle) * trunkR(br.attachY) * 0.9,
      )
      const dx = endX - start.x
      const dz = endZ - start.z

      // 4 Catmull-Rom control points that create the snake shape
      const ctrl: Vector3[] = [
        start.clone(),
        new Vector3(
          start.x + dx * 0.30 + perpX * 1.30,
          br.attachY + (padY - br.attachY) * 0.25 + 1.4,
          start.z + dz * 0.30 + perpZ * 1.30,
        ),
        new Vector3(
          start.x + dx * 0.65 - perpX * 0.90,
          br.attachY + (padY - br.attachY) * 0.65 - 0.7,
          start.z + dz * 0.65 - perpZ * 0.90,
        ),
        new Vector3(endX, padY + 0.15, endZ),
      ]

      const path = smoothPath(ctrl, 8)
      const n = path.length
      const startRad = trunkR(br.attachY) * 0.75  // fatter at trunk
      const endRad   = 0.45                         // fatter at tip

      MeshBuilder.CreateTube(`branch_${i}`, {
        path,
        tessellation: 8,
        radiusFunction: (j) => {
          const t = n > 1 ? j / (n - 1) : 0
          return startRad * (1 - t) + endRad * t
        },
      }, scene).material = woodMat

      // Landing pad  elliptical cylinder at branch tip
      const pad = MeshBuilder.CreateCylinder(`pad_${i}`, {
        diameter: Math.max(br.padW, br.padD),
        height: BRANCH_THICKNESS,
        tessellation: 10,
      }, scene)
      pad.scaling.x = br.padW / Math.max(br.padW, br.padD)
      pad.scaling.z = br.padD / Math.max(br.padW, br.padD)
      pad.position.set(endX, padY + BRANCH_THICKNESS / 2, endZ)
      pad.material = woodMat

      // Walkable collision slabs evenly spaced along the tube body
      for (let seg = 1; seg <= 5; seg++) {
        const idx  = Math.min(Math.round(seg * (n - 1) / 5), n - 1)
        const t    = idx / (n - 1)
        const r    = startRad * (1 - t) + endRad * t
        const p    = path[idx]
        const w    = 2 * r + 0.9   // box covers the tube top plus squirrel margin
        collision.push({
          x: p.x, z: p.z,
          y: p.y + r - BRANCH_THICKNESS,
          width: w, depth: w, height: BRANCH_THICKNESS,
        })
      }

      collision.push({ x: endX, z: endZ, y: padY, width: br.padW, depth: br.padD, height: BRANCH_THICKNESS })
    })

    //  Leaf clusters 
    TIER_Y.forEach((ty, ti) => {
      const count = 8
      for (let j = 0; j < count; j++) {
        const a = (j / count) * Math.PI * 2 + ti * 0.73
        const r = 2.5 + (j % 4) * 2.8
        const sphere = MeshBuilder.CreateSphere(`leaf_${ti}_${j}`, {
          diameter: 5.0 + (j % 3) * 2.2,
          segments: 6,
        }, scene)
        sphere.scaling.y = 0.52
        sphere.position.set(Math.cos(a) * r, ty + 1.5 + (j % 3) * 0.8, Math.sin(a) * r)
        const lMat = new StandardMaterial(`lmat_${ti}_${j}`, scene)
        lMat.diffuseColor = j % 2 === 0 ? C_LEAF_A : C_LEAF_B
        lMat.backFaceCulling = false
        sphere.material = lMat
        this.leaves.push(sphere)
      }
    })

    // Big crown canopy
    const crown = MeshBuilder.CreateSphere('crown', { diameter: 16, segments: 8 }, scene)
    crown.scaling.y = 0.65
    crown.position.set(0, 44, 0)
    const cMat = new StandardMaterial('crownMat', scene)
    cMat.diffuseColor = C_LEAF_A
    cMat.backFaceCulling = false
    crown.material = cMat
    this.leaves.push(crown)

    this.buildings = collision
  }

  /** Call every frame with player feet position and camera world position */
  updateLeafFade(playerPos: Vector3, cameraPos: Vector3) {
    // Ray from camera to squirrel — any leaf crossing this line also fades
    const toPlayer = playerPos.subtract(cameraPos)
    const rayLen   = toPlayer.length()
    const ray      = new Ray(cameraPos, toPlayer.normalize(), rayLen)

    for (const leaf of this.leaves) {
      const dist = Vector3.Distance(leaf.position, playerPos)
      const mat  = leaf.material as StandardMaterial
      if (!mat) continue
      const playerInside    = dist < LEAF_FADE_DIST
      const blocksCamera    = ray.intersectsMesh(leaf as any, false).hit
      const target = (playerInside || blocksCamera) ? LEAF_FADE_ALPHA : 1.0
      mat.alpha += (target - mat.alpha) * 0.15
    }
  }
}
