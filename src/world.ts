import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  HemisphericLight,
  DirectionalLight,
} from '@babylonjs/core'
import type { BuildingDef } from './types'

//  Colours 
const C_BARK   = new Color3(0.36, 0.20, 0.07)
const C_WOOD   = new Color3(0.54, 0.34, 0.13)
const C_LEAF_A = new Color3(0.13, 0.44, 0.09)
const C_LEAF_B = new Color3(0.07, 0.30, 0.06)
const C_GROUND = new Color3(0.24, 0.54, 0.16)

//  Branch-platform data 
// Each entry: position (x,z), base Y, footprint (w,d).  Thickness is 0.5.
// All platforms placed so their inner edge touches the trunk (trunk half = 1.0).
interface PlatDef { x:number; z:number; y:number; w:number; d:number }

const BRANCH_THICKNESS = 0.5

const PLATS: PlatDef[] = [
  //  Tier 1  top = 4.5  
  { x:  4.0, z:  0.3, y: 4.0, w: 6.0, d: 1.8 },   // E
  { x: -4.0, z: -0.3, y: 4.0, w: 6.0, d: 1.8 },   // W
  { x:  0.3, z:  4.0, y: 4.0, w: 1.8, d: 6.0 },   // N
  { x: -0.3, z: -4.0, y: 4.0, w: 1.8, d: 6.0 },   // S

  //  Tier 2  top = 12.0  
  { x:  3.5, z:  0.8, y: 11.5, w: 5.0, d: 2.0 },  // E
  { x: -3.5, z: -0.8, y: 11.5, w: 5.0, d: 2.0 },  // W
  { x:  0.8, z:  3.5, y: 11.5, w: 2.0, d: 5.0 },  // N
  { x: -0.8, z: -3.5, y: 11.5, w: 2.0, d: 5.0 },  // S

  //  Tier 3  top = 21.0  
  { x:  4.5, z:  0.0, y: 20.5, w: 7.0, d: 1.8 },  // E (long)
  { x: -4.5, z:  0.0, y: 20.5, w: 7.0, d: 1.8 },  // W (long)
  { x:  0.0, z:  4.5, y: 20.5, w: 1.8, d: 7.0 },  // N (long)
  { x:  0.0, z: -4.5, y: 20.5, w: 1.8, d: 7.0 },  // S (long)

  //  Tier 4  top = 31.5  
  { x:  4.0, z: -1.5, y: 31.0, w: 6.0, d: 1.8 },  // E (south-skewed)
  { x: -4.0, z:  1.5, y: 31.0, w: 6.0, d: 1.8 },  // W (north-skewed)
  { x: -1.5, z:  4.0, y: 31.0, w: 1.8, d: 6.0 },  // N (west-skewed)
  { x:  1.5, z: -4.0, y: 31.0, w: 1.8, d: 6.0 },  // S (east-skewed)

  //  Tier 5  top = 42.0  
  { x:  3.5, z:  1.0, y: 41.5, w: 5.0, d: 2.0 },
  { x: -3.5, z: -1.0, y: 41.5, w: 5.0, d: 2.0 },
  { x: -1.0, z:  3.5, y: 41.5, w: 2.0, d: 5.0 },
  { x:  1.0, z: -3.5, y: 41.5, w: 2.0, d: 5.0 },

  //  Tier 6  Crown  top = 53.0  
  { x:  0.0, z:  0.0, y: 52.5, w: 5.5, d: 5.5 },  // centre crown
  { x:  4.0, z:  0.0, y: 52.5, w: 2.5, d: 1.5 },  // E spoke
  { x: -4.0, z:  0.0, y: 52.5, w: 2.5, d: 1.5 },  // W spoke
  { x:  0.0, z:  4.0, y: 52.5, w: 1.5, d: 2.5 },  // N spoke
  { x:  0.0, z: -4.0, y: 52.5, w: 1.5, d: 2.5 },  // S spoke
]

// Heights of each tier base (for leaf cluster placement)
const TIER_Y = [4.0, 11.5, 20.5, 31.0, 41.5, 52.5]

export class World {
  readonly buildings: BuildingDef[]

  constructor(scene: Scene) {
    scene.clearColor = new Color4(0.55, 0.78, 0.96, 1.0)

    // Lighting
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

    //  Trunk (visual) 
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

    //  Branch platforms (visual + collision) 
    const woodMat = new StandardMaterial('woodMat', scene)
    woodMat.diffuseColor = C_WOOD

    PLATS.forEach((p, i) => {
      const box = MeshBuilder.CreateBox(`plat_${i}`, {
        width: p.w,
        depth: p.d,
        height: BRANCH_THICKNESS,
      }, scene)
      // Visual centre is at p.y + half-thickness
      box.position.set(p.x, p.y + BRANCH_THICKNESS / 2, p.z)
      box.material = woodMat
    })

    //  Leaf clusters 
    // One cluster per tier: 4 overlapping blobs rotated around the trunk
    TIER_Y.forEach((ty, ti) => {
      const count = 5
      for (let j = 0; j < count; j++) {
        const angle = (j / count) * Math.PI * 2 + ti * 0.55   // stagger per tier
        const r = 3.0 + (j % 3) * 1.2
        const diameter = 5.5 + (j % 2) * 1.8
        const sphere = MeshBuilder.CreateSphere(`leaf_${ti}_${j}`, {
          diameter,
          segments: 6,
        }, scene)
        sphere.scaling.y = 0.55
        sphere.position.set(
          Math.cos(angle) * r,
          ty + 1.5 + (j % 3) * 0.6,
          Math.sin(angle) * r,
        )
        const lMat = new StandardMaterial(`lmat_${ti}_${j}`, scene)
        lMat.diffuseColor = j % 2 === 0 ? C_LEAF_A : C_LEAF_B
        sphere.material = lMat
      }
    })

    // Big crown sphere right at the top
    const crown = MeshBuilder.CreateSphere('crown', { diameter: 14, segments: 8 }, scene)
    crown.scaling.y = 0.65
    crown.position.set(0, 57, 0)
    const cMat = new StandardMaterial('crownMat', scene)
    cMat.diffuseColor = C_LEAF_A
    crown.material = cMat

    //  Collision boxes 
    this.buildings = [
      // Trunk: solid from ground to top (y=0 default, full AABB)
      { x: 0, z: 0, width: 2, depth: 2, height: 58 },
      // Branch platforms (one-way, floating)
      ...PLATS.map(p => ({
        x: p.x, z: p.z, y: p.y,
        width: p.w, depth: p.d,
        height: BRANCH_THICKNESS,
      })),
    ]
  }
}
