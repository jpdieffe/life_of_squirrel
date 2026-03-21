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
  // Tier 1  top  4.5
  { angle:  Math.PI/2,        attachY:  3, length: 5.5, tipY:  4.5, snake:  1, padW: 5.0, padD: 1.6 },
  { angle: -Math.PI/2,        attachY:  3, length: 5.5, tipY:  4.5, snake: -1, padW: 5.0, padD: 1.6 },
  { angle:  0,                attachY:  3, length: 5.5, tipY:  4.5, snake: -1, padW: 1.6, padD: 5.0 },
  { angle:  Math.PI,          attachY:  3, length: 5.5, tipY:  4.5, snake:  1, padW: 1.6, padD: 5.0 },

  // Tier 2  top  12.0
  { angle:  Math.PI/2,        attachY: 10, length: 5.0, tipY: 12.0, snake: -1, padW: 4.5, padD: 1.6 },
  { angle: -Math.PI/2,        attachY: 10, length: 5.0, tipY: 12.0, snake:  1, padW: 4.5, padD: 1.6 },
  { angle:  0,                attachY: 10, length: 5.0, tipY: 12.0, snake:  1, padW: 1.6, padD: 4.5 },
  { angle:  Math.PI,          attachY: 10, length: 5.0, tipY: 12.0, snake: -1, padW: 1.6, padD: 4.5 },

  // Tier 3  top  21.0
  { angle:  Math.PI/2,        attachY: 19, length: 6.5, tipY: 21.0, snake:  1, padW: 5.5, padD: 1.8 },
  { angle: -Math.PI/2,        attachY: 19, length: 6.5, tipY: 21.0, snake: -1, padW: 5.5, padD: 1.8 },
  { angle:  0,                attachY: 19, length: 6.5, tipY: 21.0, snake: -1, padW: 1.8, padD: 5.5 },
  { angle:  Math.PI,          attachY: 19, length: 6.5, tipY: 21.0, snake:  1, padW: 1.8, padD: 5.5 },

  // Tier 4  top  31.5
  { angle:  Math.PI/2 + 0.15, attachY: 28, length: 5.5, tipY: 31.5, snake: -1, padW: 4.5, padD: 1.6 },
  { angle: -Math.PI/2 + 0.15, attachY: 28, length: 5.5, tipY: 31.5, snake:  1, padW: 4.5, padD: 1.6 },
  { angle:  0.15,             attachY: 28, length: 5.5, tipY: 31.5, snake:  1, padW: 1.6, padD: 4.5 },
  { angle:  Math.PI + 0.15,   attachY: 28, length: 5.5, tipY: 31.5, snake: -1, padW: 1.6, padD: 4.5 },

  // Tier 5  top  42.0
  { angle:  Math.PI/2 - 0.2,  attachY: 38, length: 5.0, tipY: 42.0, snake:  1, padW: 4.0, padD: 1.5 },
  { angle: -Math.PI/2 - 0.2,  attachY: 38, length: 5.0, tipY: 42.0, snake: -1, padW: 4.0, padD: 1.5 },
  { angle: -0.2,              attachY: 38, length: 5.0, tipY: 42.0, snake: -1, padW: 1.5, padD: 4.0 },
  { angle:  Math.PI - 0.2,    attachY: 38, length: 5.0, tipY: 42.0, snake:  1, padW: 1.5, padD: 4.0 },

  // Tier 6 / Crown  top  53.0
  { angle:  Math.PI/2,        attachY: 50, length: 4.5, tipY: 53.0, snake: -1, padW: 3.5, padD: 1.5 },
  { angle: -Math.PI/2,        attachY: 50, length: 4.5, tipY: 53.0, snake:  1, padW: 3.5, padD: 1.5 },
  { angle:  0,                attachY: 50, length: 4.5, tipY: 53.0, snake:  1, padW: 1.5, padD: 3.5 },
  { angle:  Math.PI,          attachY: 50, length: 4.5, tipY: 53.0, snake: -1, padW: 1.5, padD: 3.5 },
]

// Mid-height Y of each tier  for leaf cluster placement
const TIER_Y = [4.5, 12.0, 21.0, 31.5, 42.0, 53.0]

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
          start.x + dx * 0.30 + perpX * 0.80,
          br.attachY + (padY - br.attachY) * 0.25 + 0.9,
          start.z + dz * 0.30 + perpZ * 0.80,
        ),
        new Vector3(
          start.x + dx * 0.65 - perpX * 0.55,
          br.attachY + (padY - br.attachY) * 0.65 - 0.4,
          start.z + dz * 0.65 - perpZ * 0.55,
        ),
        new Vector3(endX, padY + 0.15, endZ),
      ]

      const path = smoothPath(ctrl, 8)
      const n = path.length
      const startRad = trunkR(br.attachY) * 0.45
      const endRad   = 0.13

      MeshBuilder.CreateTube(`branch_${i}`, {
        path,
        tessellation: 7,
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

      collision.push({ x: endX, z: endZ, y: padY, width: br.padW, depth: br.padD, height: BRANCH_THICKNESS })
    })

    //  Leaf clusters 
    TIER_Y.forEach((ty, ti) => {
      const count = 5
      for (let j = 0; j < count; j++) {
        const a = (j / count) * Math.PI * 2 + ti * 0.55
        const r = 3.0 + (j % 3) * 1.2
        const sphere = MeshBuilder.CreateSphere(`leaf_${ti}_${j}`, {
          diameter: 5.5 + (j % 2) * 1.8,
          segments: 6,
        }, scene)
        sphere.scaling.y = 0.55
        sphere.position.set(Math.cos(a) * r, ty + 1.5 + (j % 3) * 0.6, Math.sin(a) * r)
        const lMat = new StandardMaterial(`lmat_${ti}_${j}`, scene)
        lMat.diffuseColor = j % 2 === 0 ? C_LEAF_A : C_LEAF_B
        lMat.backFaceCulling = false
        sphere.material = lMat
        this.leaves.push(sphere)
      }
    })

    // Big crown canopy
    const crown = MeshBuilder.CreateSphere('crown', { diameter: 14, segments: 8 }, scene)
    crown.scaling.y = 0.65
    crown.position.set(0, 57, 0)
    const cMat = new StandardMaterial('crownMat', scene)
    cMat.diffuseColor = C_LEAF_A
    cMat.backFaceCulling = false
    crown.material = cMat
    this.leaves.push(crown)

    this.buildings = collision
  }

  /** Call every frame with player feet position to fade leaves the player is inside */
  updateLeafFade(playerPos: Vector3) {
    for (const leaf of this.leaves) {
      const dist = Vector3.Distance(leaf.position, playerPos)
      const mat = leaf.material as StandardMaterial
      if (!mat) continue
      const target = dist < LEAF_FADE_DIST ? LEAF_FADE_ALPHA : 1.0
      mat.alpha += (target - mat.alpha) * 0.15  // smooth lerp
    }
  }
}
