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
  AnimationGroup,
} from '@babylonjs/core'
import type { PlayerState, AnimState } from './types'

const PLAYER_HEIGHT  = 1.8
const PLAYER_RADIUS  = 0.4
const LERP_SPEED     = 15
const SQUIRREL_SCALE = 2.0

const ANIM_FILES: Record<AnimState, string> = {
  idle:  './assets/squirrel/idle.glb',
  run:   './assets/squirrel/run.glb',
  jump:  './assets/squirrel/jump.glb',
  fall:  './assets/squirrel/fall.glb',
  sneak: './assets/squirrel/sneak.glb',
  death: './assets/squirrel/death.glb',
}

function meshBottomY(meshes: AbstractMesh[]): number {
  let minY = Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    const worldMin = m.getBoundingInfo().boundingBox.minimumWorld.y
    if (worldMin < minY) minY = worldMin
  }
  return minY === Infinity ? 0 : minY
}

interface AnimEntry {
  root: TransformNode
  yOffset: number
  group: AnimationGroup | null
}

export class RemotePlayer {
  readonly mesh: Mesh

  private readonly target  = new Vector3(0, -20, 0)
  private readonly current = new Vector3(0, -20, 0)

  private animEntries: Partial<Record<AnimState, AnimEntry>> = {}
  private currentAnim: AnimState = 'idle'
  private facingY = 0

  constructor(private readonly scene: Scene) {
    this.mesh = MeshBuilder.CreateCapsule('remote', {
      height: PLAYER_HEIGHT,
      radius: PLAYER_RADIUS,
    }, scene)
    const mat = new StandardMaterial('remoteMat', scene)
    mat.diffuseColor = new Color3(1.0, 0.35, 0.2)
    this.mesh.material = mat
    this.mesh.isVisible = false

    this.loadAllAnims()
  }

  private async loadAllAnims() {
    const states: AnimState[] = ['idle', 'run', 'jump', 'fall', 'sneak', 'death']
    await Promise.all(states.map(s => this.loadAnim(s)))
    this.switchAnim('idle')
  }

  private async loadAnim(state: AnimState) {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', ANIM_FILES[state], this.scene)
      const root = new TransformNode(`squirrel_remote_${state}`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(SQUIRREL_SCALE)
      root.position.setAll(0)
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      const yOffset = -meshBottomY(result.meshes)
      result.meshes.forEach((m: AbstractMesh) => { m.isVisible = false })
      const group = result.animationGroups[0] ?? null
      if (group) {
        group.stop()
        group.loopAnimation = state !== 'death'
      }
      this.animEntries[state] = { root, yOffset, group }
    } catch (err) {
      console.warn('[RemotePlayer] Failed to load squirrel anim', state, err)
    }
  }

  private switchAnim(next: AnimState) {
    if (next === this.currentAnim) return
    const prev = this.animEntries[this.currentAnim]
    if (prev) {
      prev.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
      prev.group?.stop()
    }
    this.currentAnim = next
    const entry = this.animEntries[next]
    if (entry) {
      entry.root.getChildMeshes(false).forEach(m => { m.isVisible = true })
      entry.group?.play(entry.group.loopAnimation)
    }
  }

  /** Called when a network state packet arrives */
  updateTarget(state: PlayerState) {
    this.target.set(state.x, state.y + PLAYER_HEIGHT / 2, state.z)
    this.facingY = state.ry
    if (state.anim !== this.currentAnim) {
      this.switchAnim(state.anim)
    }
  }

  /** Called every render frame */
  update(dt: number) {
    const t = Math.min(1, LERP_SPEED * dt)
    this.current.x += (this.target.x - this.current.x) * t
    this.current.y += (this.target.y - this.current.y) * t
    this.current.z += (this.target.z - this.current.z) * t

    this.mesh.position.copyFrom(this.current)
    this.mesh.rotation.y = this.facingY

    const feetY = this.current.y - PLAYER_HEIGHT / 2

    for (const entry of Object.values(this.animEntries)) {
      if (!entry) continue
      entry.root.position.set(this.current.x, feetY + entry.yOffset, this.current.z)
      entry.root.rotation.y = this.facingY
    }
  }
}
