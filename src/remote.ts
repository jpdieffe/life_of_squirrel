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
import type { PlayerState, AnimState, CharacterType } from './types'

const PLAYER_HEIGHT  = 1.8
const PLAYER_RADIUS  = 0.4
const LERP_SPEED     = 15
const SQUIRREL_SCALE = 2.0

const SQUIRREL_ANIM_FILES: Partial<Record<AnimState, string>> = {
  idle:  './assets/squirrel/idle.glb',
  run:   './assets/squirrel/run.glb',
  jump:  './assets/squirrel/jump.glb',
  fall:  './assets/squirrel/fall.glb',
  sneak: './assets/squirrel/sneak.glb',
  death: './assets/squirrel/death.glb',
}

const GULL_ANIM_FILES: Partial<Record<AnimState, string>> = {
  idle:  './assets/gull/idle.glb',
  walk:  './assets/gull/walk.glb',
  flap:  './assets/gull/flap.glb',
  glide: './assets/gull/glide.glb',
}

const GULL_SCALE = 1.5

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

  private squirrelEntries: Partial<Record<AnimState, AnimEntry>> = {}
  private gullEntries:     Partial<Record<AnimState, AnimEntry>> = {}
  private character: CharacterType = 'squirrel'
  private get activeEntries(): Partial<Record<AnimState, AnimEntry>> {
    return this.character === 'squirrel' ? this.squirrelEntries : this.gullEntries
  }
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
    await Promise.all([
      ...Object.entries(SQUIRREL_ANIM_FILES).map(([s, f]) =>
        this.loadAnimInto(s as AnimState, f!, this.squirrelEntries, 'sq')),
      ...Object.entries(GULL_ANIM_FILES).map(([s, f]) =>
        this.loadAnimInto(s as AnimState, f!, this.gullEntries, 'gu')),
    ])
    this.switchAnim('idle')
  }

  private async loadAnimInto(
    state: AnimState, file: string,
    dict: Partial<Record<AnimState, AnimEntry>>, prefix: string,
  ) {
    try {
      const scale  = prefix === 'gu' ? GULL_SCALE : SQUIRREL_SCALE
      const noLoop = prefix === 'sq' ? state === 'death' : state === 'flap'
      const result = await SceneLoader.ImportMeshAsync('', '', file, this.scene)
      const root   = new TransformNode(`${prefix}_remote_${state}`, this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = root })
      root.scaling.setAll(scale)
      root.position.setAll(0)
      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      const yOffset = -meshBottomY(result.meshes)
      result.meshes.forEach((m: AbstractMesh) => { m.isVisible = false })
      const group = result.animationGroups[0] ?? null
      if (group) { group.stop(); group.loopAnimation = !noLoop }
      dict[state] = { root, yOffset, group }
    } catch (err) {
      console.warn('[RemotePlayer] Failed to load anim', prefix, state, err)
    }
  }

  private switchAnim(next: AnimState) {
    if (next === this.currentAnim) return
    const prev = this.activeEntries[this.currentAnim]
    if (prev) {
      prev.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
      prev.group?.stop()
    }
    this.currentAnim = next
    const entry = this.activeEntries[next]
    if (entry) {
      entry.root.getChildMeshes(false).forEach(m => { m.isVisible = true })
      entry.group?.play(entry.group.loopAnimation)
    }
  }

  private setCharacter(c: CharacterType) {
    if (c === this.character) return
    for (const entry of Object.values(this.activeEntries)) {
      entry?.root.getChildMeshes(false).forEach(m => { m.isVisible = false })
      entry?.group?.stop()
    }
    this.character   = c
    this.currentAnim = 'idle'
    const idleEntry  = this.activeEntries['idle']
    if (idleEntry) {
      idleEntry.root.getChildMeshes(false).forEach(m => { m.isVisible = true })
      idleEntry.group?.play(true)
    }
  }

  /** Called when a network state packet arrives */
  updateTarget(state: PlayerState) {
    this.target.set(state.x, state.y + PLAYER_HEIGHT / 2, state.z)
    this.facingY = state.ry
    const incomingChar = state.char ?? 'squirrel'
    if (incomingChar !== this.character) this.setCharacter(incomingChar)
    if (state.anim !== this.currentAnim) this.switchAnim(state.anim)
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

    for (const entry of Object.values(this.activeEntries)) {
      if (!entry) continue
      entry.root.position.set(this.current.x, feetY + entry.yOffset, this.current.z)
      entry.root.rotation.y = this.facingY
    }
  }
}
