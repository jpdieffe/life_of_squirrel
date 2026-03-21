import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from '@babylonjs/core'
import type { BuildingDef } from './types'

// ── Tuning ────────────────────────────────────────────────────────────────────
const BLOCK_SIZE = 2   // width / height / depth of each placed block (metres)
const REACH      = 4   // metres in front of player where preview appears

export class BuildingSystem {
  private active     = false
  private preview!:  Mesh
  private snapPos    = new Vector3()

  constructor(private readonly scene: Scene) {
    this.preview = MeshBuilder.CreateBox('buildPreview', {
      width: BLOCK_SIZE, height: BLOCK_SIZE, depth: BLOCK_SIZE,
    }, scene)

    const mat = new StandardMaterial('buildPreviewMat', scene)
    mat.diffuseColor    = new Color3(0.50, 0.90, 1.00)
    mat.alpha           = 0.40
    mat.backFaceCulling = false
    mat.wireframe       = false
    this.preview.material  = mat
    this.preview.isPickable = false
    this.preview.setEnabled(false)
  }

  get isActive(): boolean { return this.active }

  /** Toggle building mode on/off. */
  toggle() {
    this.active = !this.active
    this.preview.setEnabled(this.active)
  }

  /**
   * Call every frame.
   * Moves the transparent preview block to the snapped grid position
   * directly in front of the player.
   */
  update(playerPos: Vector3, facingAngle: number) {
    if (!this.active) return
    const rawX = playerPos.x + Math.sin(facingAngle) * REACH
    const rawZ = playerPos.z + Math.cos(facingAngle) * REACH
    this.snapPos.set(
      Math.round(rawX / BLOCK_SIZE) * BLOCK_SIZE,
      BLOCK_SIZE / 2,   // box origin is at centre, so bottom sits at y=0
      Math.round(rawZ / BLOCK_SIZE) * BLOCK_SIZE,
    )
    this.preview.position.copyFrom(this.snapPos)
  }

  /**
   * Attempt to place a block at the current preview position.
   * `consume` should decrement the caller's acorn count and return true,
   * or return false if none are available.
   * Returns a BuildingDef to push into world.buildings on success, else null.
   */
  place(consume: () => boolean): BuildingDef | null {
    if (!this.active) return null
    if (!consume()) return null

    const px = this.snapPos.x
    const pz = this.snapPos.z

    // Solid placed-block mesh
    const mesh = MeshBuilder.CreateBox(`placed_${Date.now()}`, {
      width: BLOCK_SIZE, height: BLOCK_SIZE, depth: BLOCK_SIZE,
    }, this.scene)

    const mat = new StandardMaterial(`placedMat_${Date.now()}`, this.scene)
    mat.diffuseColor = new Color3(0.63, 0.47, 0.27)   // warm wood colour
    mesh.material    = mat
    mesh.position.set(px, BLOCK_SIZE / 2, pz)

    // Floor-anchored BuildingDef (y omitted → defaults to 0, full AABB collision)
    return { x: px, z: pz, width: BLOCK_SIZE, depth: BLOCK_SIZE, height: BLOCK_SIZE }
  }
}
