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

    // ── House ──────────────────────────────────────────────────────────────
    this._buildHouse(scene, collision)
  }

  private _buildHouse(scene: Scene, collision: BuildingDef[]) {
    // House is 7× the original scale.
    // Centre at (90, 0, 90) — far enough from the tree to fit the 84×70m footprint.
    const HX = 90, HZ = 90          // centre of house footprint
    const HW = 84, HD = 70           // house width (+X) and depth (+Z)
    const W  = 2.1                   // wall thickness
    const GH = 22.4                  // ground floor ceiling height
    const FH = 21.0                  // 2nd floor ceiling height
    const ROOF_Y = GH + FH           // = 43.4

    // ── Materials ──────────────────────────────────────────────────────────
    const matOf = (name: string, r: number, g: number, b: number): StandardMaterial => {
      const m = new StandardMaterial(name, scene)
      m.diffuseColor = new Color3(r, g, b)
      return m
    }
    const mWall   = matOf('hWall',   0.91, 0.85, 0.74)
    const mFloor  = matOf('hFloor',  0.55, 0.38, 0.22)
    const mRoof   = matOf('hRoof',   0.40, 0.18, 0.10)
    const mDoor   = matOf('hDoor',   0.35, 0.20, 0.07)
    const mFurn   = matOf('hFurn',   0.42, 0.25, 0.12)
    const mBed    = matOf('hBed',    0.85, 0.82, 0.90)
    const mCounter= matOf('hCntr',   0.70, 0.70, 0.72)
    const mToilet = matOf('hToilet', 0.95, 0.95, 0.95)
    const mBath   = matOf('hBath',   0.90, 0.92, 0.95)
    const mGlass  = matOf('hGlass',  0.55, 0.78, 0.90)
    mGlass.alpha  = 0.35
    mGlass.backFaceCulling = false
    const mStair  = matOf('hStair',  0.58, 0.43, 0.28)
    const mRail   = matOf('hRail',   0.35, 0.22, 0.10)

    // box helper: cx/cyBottom/cz are the centre-x, bottom-y, centre-z
    const box = (
      name: string, cx: number, cyBottom: number, cz: number,
      w: number, h: number, d: number,
      mat: StandardMaterial,
    ): Mesh => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene)
      m.position.set(cx, cyBottom + h / 2, cz)
      m.material = mat
      return m
    }

    // ── Ground floor slab (visual) ──────────────────────────────────────────
    box('hGroundSlab', HX, -0.05, HZ, HW, 0.1, HD, mFloor)

    // Derived edge positions
    const SZ = HZ - HD / 2   // south wall Z
    const NZ = HZ + HD / 2   // north wall Z
    const WX = HX - HW / 2   // west wall X
    const EX = HX + HW / 2   // east wall X

    // ── Ground-floor SOUTH WALL — door (9.8m wide) + one open window (8.4m) ──
    // Panels split around door at x+10.5..+20.3 relative to HX
    // Window at x=-21..−12.6 relative to HX
    box('hSW_L',  HX - 33.6, 0, SZ, 16.8, GH, W, mWall)
    collision.push({ x: HX - 33.6, z: SZ, width: 16.8, depth: W, height: GH })
    // window sill (low, y: 0..7)
    box('hSW_Wlo', HX - 16.8, 0, SZ, 8.4, 7.0, W, mWall)
    collision.push({ x: HX - 16.8, z: SZ, width: 8.4, depth: W, height: 7.0 })
    // window lintel (high, y: 14..GH)
    box('hSW_Whi', HX - 16.8, 14.0, SZ, 8.4, GH - 14.0, W, mWall)
    collision.push({ x: HX - 16.8, z: SZ, y: 14.0, width: 8.4, depth: W, height: GH - 14.0 })
    // window glass (gap y:7..14)
    box('hSW_glass', HX - 16.8, 7.0, SZ, 8.4, 7.0, 0.35, mGlass)
    // middle panel between window and door
    box('hSW_M',  HX - 5.6, 0, SZ, 22.4, GH, W, mWall)
    collision.push({ x: HX - 5.6, z: SZ, width: 22.4, depth: W, height: GH })
    // door frame top (y: 15.4..GH)
    const DOOR_H = 15.4
    box('hSW_Dhi', HX + 10.5, DOOR_H, SZ, 9.8, GH - DOOR_H, W, mWall)
    collision.push({ x: HX + 10.5, z: SZ, y: DOOR_H, width: 9.8, depth: W, height: GH - DOOR_H })
    // door panel
    box('hDoorPanel', HX + 10.5, 0, SZ + 1.05, 9.1, DOOR_H, 0.42, mDoor)
    // right panel
    box('hSW_R',  HX + 28.7, 0, SZ, 26.6, GH, W, mWall)
    collision.push({ x: HX + 28.7, z: SZ, width: 26.6, depth: W, height: GH })

    // ── Ground-floor NORTH WALL — two open windows ──────────────────────────
    box('hNW_L',  HX - 31.5, 0, NZ, 21.0, GH, W, mWall)
    collision.push({ x: HX - 31.5, z: NZ, width: 21.0, depth: W, height: GH })
    box('hNW_W1lo', HX - 16.8, 0, NZ, 8.4, 7.0, W, mWall)
    collision.push({ x: HX - 16.8, z: NZ, width: 8.4, depth: W, height: 7.0 })
    box('hNW_W1hi', HX - 16.8, 14.0, NZ, 8.4, GH - 14.0, W, mWall)
    collision.push({ x: HX - 16.8, z: NZ, y: 14.0, width: 8.4, depth: W, height: GH - 14.0 })
    box('hNW_g1', HX - 16.8, 7.0, NZ, 8.4, 7.0, 0.35, mGlass)
    box('hNW_M',  HX, 0, NZ, 25.2, GH, W, mWall)
    collision.push({ x: HX, z: NZ, width: 25.2, depth: W, height: GH })
    box('hNW_W2lo', HX + 16.8, 0, NZ, 8.4, 7.0, W, mWall)
    collision.push({ x: HX + 16.8, z: NZ, width: 8.4, depth: W, height: 7.0 })
    box('hNW_W2hi', HX + 16.8, 14.0, NZ, 8.4, GH - 14.0, W, mWall)
    collision.push({ x: HX + 16.8, z: NZ, y: 14.0, width: 8.4, depth: W, height: GH - 14.0 })
    box('hNW_g2', HX + 16.8, 7.0, NZ, 8.4, 7.0, 0.35, mGlass)
    box('hNW_R',  HX + 31.5, 0, NZ, 21.0, GH, W, mWall)
    collision.push({ x: HX + 31.5, z: NZ, width: 21.0, depth: W, height: GH })

    // ── Ground-floor WEST WALL — one open window ───────────────────────────
    box('hWW_S',  WX, 0, HZ - 24.5, W, GH, 21.0, mWall)
    collision.push({ x: WX, z: HZ - 24.5, width: W, depth: 21.0, height: GH })
    box('hWW_Wlo', WX, 0, HZ - 9.8, W, 7.0, 8.4, mWall)
    collision.push({ x: WX, z: HZ - 9.8, width: W, depth: 8.4, height: 7.0 })
    box('hWW_Whi', WX, 14.0, HZ - 9.8, W, GH - 14.0, 8.4, mWall)
    collision.push({ x: WX, z: HZ - 9.8, y: 14.0, width: W, depth: 8.4, height: GH - 14.0 })
    box('hWW_glass', WX, 7.0, HZ - 9.8, 0.35, 7.0, 8.4, mGlass)
    box('hWW_N',  WX, 0, HZ + 14.7, W, GH, 40.6, mWall)
    collision.push({ x: WX, z: HZ + 14.7, width: W, depth: 40.6, height: GH })

    // ── Ground-floor EAST WALL — one open window ───────────────────────────
    box('hEW_S',  EX, 0, HZ - 24.5, W, GH, 21.0, mWall)
    collision.push({ x: EX, z: HZ - 24.5, width: W, depth: 21.0, height: GH })
    box('hEW_Wlo', EX, 0, HZ - 9.8, W, 7.0, 8.4, mWall)
    collision.push({ x: EX, z: HZ - 9.8, width: W, depth: 8.4, height: 7.0 })
    box('hEW_Whi', EX, 14.0, HZ - 9.8, W, GH - 14.0, 8.4, mWall)
    collision.push({ x: EX, z: HZ - 9.8, y: 14.0, width: W, depth: 8.4, height: GH - 14.0 })
    box('hEW_glass', EX, 7.0, HZ - 9.8, 0.35, 7.0, 8.4, mGlass)
    box('hEW_N',  EX, 0, HZ + 14.7, W, GH, 40.6, mWall)
    collision.push({ x: EX, z: HZ + 14.7, width: W, depth: 40.6, height: GH })

    // ── Interior partition (bathroom/kitchen divider) at z = HZ + 7 ─────────
    const PZ1 = HZ + 7.0
    box('hPart1_W', HX - 26.25, 0, PZ1, 24.5, GH, W, mWall)
    collision.push({ x: HX - 26.25, z: PZ1, width: 24.5, depth: W, height: GH })
    box('hPart1_E', HX + 26.25, 0, PZ1, 24.5, GH, W, mWall)
    collision.push({ x: HX + 26.25, z: PZ1, width: 24.5, depth: W, height: GH })
    box('hPart1_T', HX, 15.4, PZ1, 10.5, GH - 15.4, W, mWall)  // doorway top
    collision.push({ x: HX, z: PZ1, y: 15.4, width: 10.5, depth: W, height: GH - 15.4 })

    // ── 2nd-floor SLAB (one-way platform) ───────────────────────────────────
    const F2Y    = GH         // 22.4 — bottom of slab
    const SLAB_H = 2.1        // slab thickness (0.3 × 7)
    box('h2ndFloor', HX, F2Y, HZ, HW, SLAB_H, HD, mFloor)
    collision.push({ x: HX, z: HZ, y: F2Y, width: HW, depth: HD, height: SLAB_H })

    // Ceiling soffit (visual)
    box('hCeiling', HX, ROOF_Y, HZ, HW, 1.05, HD, mFloor)

    // ── 2nd-floor WALLS ──────────────────────────────────────────────────────
    const F2bot = F2Y + SLAB_H   // 24.5 — floor surface of 2nd storey

    // South wall 2nd floor — one open window
    box('h2SW_L',  HX - 28.0, F2bot, SZ, 28.0, FH - SLAB_H, W, mWall)
    collision.push({ x: HX - 28.0, z: SZ, y: F2bot, width: 28.0, depth: W, height: FH - SLAB_H })
    box('h2SW_Wlo', HX + 7.0, F2bot, SZ, 14.0, 5.6, W, mWall)
    collision.push({ x: HX + 7.0, z: SZ, y: F2bot, width: 14.0, depth: W, height: 5.6 })
    box('h2SW_Whi', HX + 7.0, F2bot + 12.6, SZ, 14.0, FH - SLAB_H - 12.6, W, mWall)
    collision.push({ x: HX + 7.0, z: SZ, y: F2bot + 12.6, width: 14.0, depth: W, height: FH - SLAB_H - 12.6 })
    box('h2SW_glass', HX + 7.0, F2bot + 5.6, SZ, 14.0, 7.0, 0.35, mGlass)
    box('h2SW_R',  HX + 31.5, F2bot, SZ, 21.0, FH - SLAB_H, W, mWall)
    collision.push({ x: HX + 31.5, z: SZ, y: F2bot, width: 21.0, depth: W, height: FH - SLAB_H })

    // North wall 2nd floor — one open window
    box('h2NW_L',  HX - 31.5, F2bot, NZ, 21.0, FH - SLAB_H, W, mWall)
    collision.push({ x: HX - 31.5, z: NZ, y: F2bot, width: 21.0, depth: W, height: FH - SLAB_H })
    box('h2NW_Wlo', HX - 7.0, F2bot, NZ, 14.0, 5.6, W, mWall)
    collision.push({ x: HX - 7.0, z: NZ, y: F2bot, width: 14.0, depth: W, height: 5.6 })
    box('h2NW_Whi', HX - 7.0, F2bot + 12.6, NZ, 14.0, FH - SLAB_H - 12.6, W, mWall)
    collision.push({ x: HX - 7.0, z: NZ, y: F2bot + 12.6, width: 14.0, depth: W, height: FH - SLAB_H - 12.6 })
    box('h2NW_glass', HX - 7.0, F2bot + 5.6, NZ, 14.0, 7.0, 0.35, mGlass)
    box('h2NW_R',  HX + 31.5, F2bot, NZ, 21.0, FH - SLAB_H, W, mWall)
    collision.push({ x: HX + 31.5, z: NZ, y: F2bot, width: 21.0, depth: W, height: FH - SLAB_H })

    // West wall 2nd floor (solid)
    box('h2WW', WX, F2bot, HZ, W, FH - SLAB_H, HD, mWall)
    collision.push({ x: WX, z: HZ, y: F2bot, width: W, depth: HD, height: FH - SLAB_H })

    // East wall 2nd floor (solid)
    box('h2EW', EX, F2bot, HZ, W, FH - SLAB_H, HD, mWall)
    collision.push({ x: EX, z: HZ, y: F2bot, width: W, depth: HD, height: FH - SLAB_H })

    // 2nd-floor partition (bedroom divider, N-S, at x=HX, 10.5m doorway)
    const PX2 = HX
    box('h2Part_S', PX2, F2bot, HZ - 18.375, W, FH - SLAB_H, HD / 2 - 10.5, mWall)
    collision.push({ x: PX2, z: HZ - 18.375, y: F2bot, width: W, depth: HD / 2 - 10.5, height: FH - SLAB_H })
    box('h2Part_N', PX2, F2bot, HZ + 18.375, W, FH - SLAB_H, HD / 2 - 10.5, mWall)
    collision.push({ x: PX2, z: HZ + 18.375, y: F2bot, width: W, depth: HD / 2 - 10.5, height: FH - SLAB_H })
    box('h2Part_T', PX2, F2bot + 15.4, HZ, W, FH - SLAB_H - 15.4, 10.5, mWall)
    collision.push({ x: PX2, z: HZ, y: F2bot + 15.4, width: W, depth: 10.5, height: FH - SLAB_H - 15.4 })

    // ── Stairs (east interior, N→S, 8 wide steps) ───────────────────────────
    const NSTEPS = 8
    const stepH  = (F2Y + SLAB_H) / NSTEPS   // ~3.06
    const stepD  = 6.3                         // 0.9 × 7
    const stairX = HX + 29.4                  // near east interior wall
    for (let s = 0; s < NSTEPS; s++) {
      const sz = HZ + 22.4 - s * stepD
      const sy = s * stepH
      box(`hStep_${s}`, stairX, sy, sz, 10.5, stepH, stepD, mStair)
      collision.push({ x: stairX, z: sz, y: sy, width: 10.5, depth: stepD, height: stepH })
    }
    // Railing (visual)
    box('hRail_stair', stairX + 5.74, 0, HZ + 11.9, 0.42, F2Y + SLAB_H + 6.3, 0.42, mRail)
    box('hRailTop',    stairX + 5.74, F2Y + SLAB_H + 6.3, HZ + 11.9, 0.42, 0.42, NSTEPS * stepD, mRail)

    // ── Roof (gabled, visual only) ───────────────────────────────────────────
    const roofW     = HW + 4.2
    const ridgeH    = 12.6
    const roofPitch = Math.atan2(ridgeH, HD / 2)
    const roofSlabH = Math.sqrt(ridgeH * ridgeH + (HD / 2) * (HD / 2))

    const roofN = MeshBuilder.CreateBox('hRoofN', { width: roofW, height: 1.75, depth: roofSlabH + 0.35 }, scene)
    roofN.material = mRoof
    roofN.rotation.x = -roofPitch
    roofN.position.set(HX, ROOF_Y + ridgeH / 2, HZ + HD / 4)

    const roofS = MeshBuilder.CreateBox('hRoofS', { width: roofW, height: 1.75, depth: roofSlabH + 0.35 }, scene)
    roofS.material = mRoof
    roofS.rotation.x = roofPitch
    roofS.position.set(HX, ROOF_Y + ridgeH / 2, HZ - HD / 4)

    const gableH = ridgeH + 0.7
    const gableTri = (name: string, gx: number) => {
      const g = MeshBuilder.CreateBox(name, { width: 1.75, height: gableH, depth: HD }, scene)
      g.material = mWall
      g.position.set(gx, ROOF_Y + gableH / 2 - 0.35, HZ)
    }
    gableTri('hGableW', WX)
    gableTri('hGableE', EX)

    // ── Ground-floor FURNITURE (all dimensions × 7) ─────────────────────────
    // Kitchen — east side of south half
    box('hKCounter_E', EX - 3.5, 0, HZ - 10.5, 5.6, 6.3, 24.5, mCounter)
    box('hKCounter_S', HX + 24.5, 0, SZ + 4.2, 14.0, 6.3, 5.6, mCounter)
    // Table + chairs in living area
    box('hTable',  HX - 17.5, 0, HZ - 10.5, 11.2, 5.25, 6.3,  mFurn)
    box('hChair1', HX - 9.8,  0, HZ - 10.5, 3.5,  3.15, 3.5,  mFurn)
    box('hChair2', HX - 25.2, 0, HZ - 10.5, 3.5,  3.15, 3.5,  mFurn)
    box('hChair3', HX - 17.5, 0, HZ - 5.6,  3.5,  3.15, 3.5,  mFurn)
    // Bathroom
    box('hToiletBase', HX - 36.4, 0, HZ + 24.5, 4.2, 2.94, 4.9, mToilet)
    box('hToiletTank', HX - 36.4, 2.94, HZ + 26.6, 4.2, 2.45, 1.54, mToilet)
    box('hBath_base',  HX + 28.0, 0, HZ + 24.5,  12.6, 3.5, 5.95, mBath)
    box('hSink',       HX - 36.4, 0, HZ + 12.6,  3.5, 5.95, 3.5,  mCounter)

    // ── 2nd-floor FURNITURE ─────────────────────────────────────────────────
    const F2fl = F2Y + SLAB_H  // 24.5

    // West bedroom
    box('hBed1',     HX - 24.5, F2fl, HZ + 7.0,  15.4, 3.85, 11.2, mBed)
    box('hBed1head', HX - 30.8, F2fl, HZ + 7.0,  1.4,  6.3,  11.2, mFurn)
    box('hWard1',    HX - 33.6, F2fl, HZ - 24.5, 4.2,  14.0, 14.0, mFurn)
    box('hNight1',   HX - 16.1, F2fl, HZ + 12.6, 3.5,  4.2,  3.5,  mFurn)
    // East bedroom
    box('hBed2',     HX + 24.5, F2fl, HZ + 7.0,  15.4, 3.85, 11.2, mBed)
    box('hBed2head', HX + 30.8, F2fl, HZ + 7.0,  1.4,  6.3,  11.2, mFurn)
    box('hWard2',    HX + 33.6, F2fl, HZ - 24.5, 4.2,  14.0, 14.0, mFurn)
    box('hNight2',   HX + 16.1, F2fl, HZ + 12.6, 3.5,  4.2,  3.5,  mFurn)
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
