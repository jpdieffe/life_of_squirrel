import {
  Scene,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  Texture,
} from '@babylonjs/core'
import type { BuildingDef } from './types'

// ── Tuning ────────────────────────────────────────────────────────────────────
const BLOCK_SIZE = 2   // width / height / depth of each placed block (metres)
const REACH      = 4   // metres in front of player where preview appears

export class BuildingSystem {
  private active     = false
  private preview!:  Mesh
  private snapPos    = new Vector3()
  private placedMat!: StandardMaterial

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

    // Shared material for placed blocks (wood chip texture)
    const pm = new StandardMaterial('placedBlockMat', scene)
    const dt = new Texture('./assets/textures/woodchip_col.jpg', scene)
    const nt = new Texture('./assets/textures/woodchip_nrm.jpg', scene)
    pm.diffuseTexture = dt
    pm.bumpTexture = nt
    this.placedMat = pm
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
    // Snap Y to the nearest block-grid level at or above the player's feet
    const baseY = Math.round(playerPos.y / BLOCK_SIZE) * BLOCK_SIZE
    this.snapPos.set(
      Math.round(rawX / BLOCK_SIZE) * BLOCK_SIZE,
      baseY + BLOCK_SIZE / 2,   // box origin is at centre
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

    mesh.material = this.placedMat
    const py = this.snapPos.y - BLOCK_SIZE / 2   // bottom of block
    mesh.position.set(px, this.snapPos.y, pz)

    return { x: px, z: pz, y: py, width: BLOCK_SIZE, depth: BLOCK_SIZE, height: BLOCK_SIZE }
  }

  /** Spawn a visible block from received network data (no acorn cost). */
  spawnRemoteBlock(x: number, y: number, z: number, w: number, h: number, d: number): BuildingDef {
    const mesh = MeshBuilder.CreateBox(`remote_${Date.now()}`, {
      width: w, height: h, depth: d,
    }, this.scene)
    mesh.material = this.placedMat
    mesh.position.set(x, y + h / 2, z)
    return { x, z, y, width: w, depth: d, height: h }
  }
}
