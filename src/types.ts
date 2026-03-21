/** Shape of a building / platform in the world */
export interface BuildingDef {
  x: number
  z: number
  /** Base Y of the collision box.  Defaults to 0 (floor-anchored).
   *  Platforms with y > 0 are treated as one-way (land from above only). */
  y?: number
  width: number
  depth: number
  /** Total height of the box (top surface = y + height) */
  height: number
}

/** A decorative structure placed on the map (tree1/tree2/house/house1) */
export interface StructureDef {
  type: 'tree1' | 'tree2' | 'house' | 'house1'
  x: number
  z: number
  /** Y-axis rotation in radians */
  rotation?: number
}

/** A player spawn point */
export interface SpawnPoint {
  x: number
  z: number
}

/** A monster spawn point */
export interface MonsterSpawnDef {
  type: 'slime' | 'spider' | 'wolf' | 'goblin' | 'imp' | 'orc'
  x: number
  z: number
}

/** Complete map definition (saved / loaded as JSON) */
export interface MapDef {
  buildings:     BuildingDef[]
  structures:    StructureDef[]
  playerSpawns:  SpawnPoint[]
  monsterSpawns: MonsterSpawnDef[]
}

/** Animation states for all characters */
export type AnimState = 'idle' | 'run' | 'jump' | 'fall' | 'sneak' | 'death' | 'walk' | 'flap' | 'glide'

/** Which character the player is controlling */
export type CharacterType = 'squirrel' | 'gull'

/** Player state synced over the network */
export interface PlayerState {
  x: number
  y: number   // feet Y position
  z: number
  ry: number  // horizontal rotation (camera alpha)
  anim: AnimState
  char?: CharacterType
}

/** Network message envelope */
export type NetMessage =
  | { type: 'state'; state: PlayerState }
