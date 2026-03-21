import '@babylonjs/loaders/glTF'
import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Mesh,
  TransformNode,
  SceneLoader,
  AbstractMesh,
} from '@babylonjs/core'
import type { PlayerState, CharacterClass } from './types'
import { AttackSystem } from './attacks'

const PLAYER_HEIGHT = 1.8
const PLAYER_RADIUS = 0.4
const LERP_SPEED    = 15

const CHAR_MODEL: Record<CharacterClass, [string, string]> = {
  warrior: ['./assets/chars/', 'knight.glb'],
  wizard:  ['./assets/chars/', 'wizard.glb'],
  rogue:   ['./assets/chars/', 'rogue.glb'],
  archer:  ['./assets/chars/', 'archer.glb'],
}
const CHAR_SCALE = 2.0

export class RemotePlayer {
  readonly mesh: Mesh

  private readonly target  = new Vector3(0, -20, 0)
  private readonly current = new Vector3(0, -20, 0)
  private currentFeet      = new Vector3(0, -20, 0)

  private charRoot: TransformNode | null = null
  private charYOffset = 0
  private currentCls: CharacterClass | null = null
  private facingY = 0

  private readonly attackSystem: AttackSystem

  constructor(private readonly scene: Scene) {
    this.attackSystem = new AttackSystem(scene)

    this.mesh = MeshBuilder.CreateCapsule('remote', {
      height: PLAYER_HEIGHT,
      radius: PLAYER_RADIUS,
    }, scene)
    const mat = new StandardMaterial('remoteMat', scene)
    mat.diffuseColor = new Color3(1.0, 0.35, 0.2)
    this.mesh.material = mat
  }

  private async loadCharacter(cls: CharacterClass) {
    if (cls === this.currentCls) return
    this.currentCls = cls

    if (this.charRoot) {
      this.charRoot.getChildMeshes().forEach(m => m.dispose())
      this.charRoot.dispose()
      this.charRoot = null
      this.mesh.isVisible = true
    }

    const [rootUrl, filename] = CHAR_MODEL[cls]
    try {
      const result = await SceneLoader.ImportMeshAsync('', rootUrl, filename, this.scene)
      const root = new TransformNode(`remoteCharRoot_${cls}_${Math.random()}`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(CHAR_SCALE)
      root.position.setAll(0)

      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))

      let minY = Infinity
      for (const m of result.meshes) {
        const wMin = m.getBoundingInfo().boundingBox.minimumWorld.y
        if (wMin < minY) minY = wMin
      }
      this.charYOffset = minY === Infinity ? 0 : -minY

      this.charRoot = root
      this.mesh.isVisible = false
    } catch (err) {
      console.warn('[RemotePlayer] model load failed, using capsule', err)
    }
  }

  /** Called when a network state packet arrives */
  updateTarget(state: PlayerState) {
    this.target.set(state.x, state.y + PLAYER_HEIGHT / 2, state.z)
    this.currentFeet.set(state.x, state.y, state.z)
    this.facingY = state.ry
    if (state.cls !== this.currentCls) {
      this.loadCharacter(state.cls)
    }
  }

  /** Called when a network attack packet arrives */
  triggerAttack(cls: CharacterClass, alpha: number, beta: number) {
    // Use the live current feet position (tracks via currentFeet)
    this.attackSystem.attack(
      this.scene,
      cls,
      this.currentFeet,
      alpha,
      beta,
    )
  }

  /** Called every render frame */
  update(dt: number) {
    const t = Math.min(1, LERP_SPEED * dt)
    this.current.x += (this.target.x - this.current.x) * t
    this.current.y += (this.target.y - this.current.y) * t
    this.current.z += (this.target.z - this.current.z) * t

    this.mesh.position.copyFrom(this.current)
    this.mesh.rotation.y = this.facingY

    // Update feet position for attack spawning
    this.currentFeet.set(
      this.current.x,
      this.current.y - PLAYER_HEIGHT / 2,
      this.current.z,
    )

    if (this.charRoot) {
      this.charRoot.position.set(
        this.current.x,
        this.current.y - PLAYER_HEIGHT / 2 + this.charYOffset,
        this.current.z,
      )
      this.charRoot.rotation.y = this.facingY
    }

    this.attackSystem.update(dt)
  }
}
