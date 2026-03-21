/** Shape of a building in the world */
export interface BuildingDef {
  x: number
  z: number
  width: number
  depth: number
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

/** Squirrel animation states */
export type AnimState = 'idle' | 'run' | 'jump' | 'fall' | 'sneak' | 'death'

/** Player state synced over the network */
export interface PlayerState {
  x: number
  y: number   // feet Y position
  z: number
  ry: number  // horizontal rotation (camera alpha)
  anim: AnimState
}

/** Network message envelope */
export type NetMessage =
  | { type: 'state'; state: PlayerState }
