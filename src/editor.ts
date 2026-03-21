/**
 * Rooftop Runners — 2-D overhead map editor
 *
 * Coordinate convention: the canvas shows a top-down view where canvas X maps
 * to world X and canvas Y maps to world Z.  The editor works entirely in world
 * units; the viewport just scales/pans them onto the canvas.
 */

import type {
  MapDef, BuildingDef, StructureDef, SpawnPoint, MonsterSpawnDef,
} from './types'

// ── Types ─────────────────────────────────────────────────────────────────────

type PlacedItem =
  | { kind: 'building';      data: BuildingDef }
  | { kind: 'structure';     data: StructureDef }
  | { kind: 'playerSpawn';   data: SpawnPoint }
  | { kind: 'monsterSpawn';  data: MonsterSpawnDef }

type ToolMode =
  | 'select' | 'erase'
  | 'building'
  | 'tree1' | 'tree2' | 'house' | 'house1'
  | 'player-spawn'
  | 'slime' | 'spider' | 'wolf' | 'goblin' | 'imp' | 'orc'

// ── Visual constants ──────────────────────────────────────────────────────────

const GRID = 1          // snap-to grid in world units
const WORLD_SIZE = 80   // half-extent of visible world grid

const COLORS: Record<string, string> = {
  building:     '#5a6aaa',
  buildingBdr:  '#8898cc',
  tree1:        '#2d7a30',
  tree2:        '#1a5c1a',
  house:        '#a0602a',
  house1:       '#c07838',
  playerSpawn:  '#50e080',
  slime:        '#40cc60',
  spider:       '#ccccdd',
  wolf:         '#7070cc',
  goblin:       '#70cc40',
  imp:          '#ff5020',
  orc:          '#cc7020',
  selected:     '#ffdd44',
  grid:         'rgba(255,255,255,0.05)',
  gridMajor:    'rgba(255,255,255,0.12)',
  ground:       '#1e2e14',
}

const MONSTER_ICON: Record<string, string> = {
  slime: '🟢', spider: '🕷', wolf: '🐺',
  goblin: '👺', imp: '😈', orc: '👹',
}

// ── State ─────────────────────────────────────────────────────────────────────

const canvas  = document.getElementById('mapCanvas') as HTMLCanvasElement
const ctx     = canvas.getContext('2d')!
const wrap    = document.getElementById('canvas-wrap')!
const coordsEl = document.getElementById('cursor-coords')!

let tool: ToolMode = 'select'
const items: PlacedItem[] = []

// Viewport: world origin maps to (panX, panY) on canvas, zoom = pixels/unit
let zoom = 10
let panX = 0
let panY = 0

let selectedIdx: number | null = null

// Drag-to-pan state
let isPanning = false
let panStart  = { mx: 0, my: 0, px: 0, py: 0 }

// Drag-to-move-selected state
let isDraggingItem = false
let dragOffset = { wx: 0, wz: 0 }

// ── Coordinate helpers ────────────────────────────────────────────────────────

function worldToCanvas(wx: number, wz: number): [number, number] {
  return [panX + wx * zoom, panY + wz * zoom]
}
function canvasToWorld(cx: number, cy: number): [number, number] {
  return [(cx - panX) / zoom, (cy - panY) / zoom]
}
function snap(v: number): number {
  return Math.round(v / GRID) * GRID
}

// ── Canvas resize ─────────────────────────────────────────────────────────────

function resizeCanvas() {
  canvas.width  = wrap.clientWidth
  canvas.height = wrap.clientHeight
  // Keep world origin roughly centred
  panX = canvas.width  / 2
  panY = canvas.height / 2
  draw()
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function draw() {
  const W = canvas.width
  const H = canvas.height
  ctx.clearRect(0, 0, W, H)

  // Background
  ctx.fillStyle = COLORS.ground
  ctx.fillRect(0, 0, W, H)

  // Grid
  drawGrid()

  // Items
  items.forEach((item, i) => drawItem(item, i === selectedIdx))

  // Ghost preview while placing (last mouse position)
  if (ghostPos && tool !== 'select' && tool !== 'erase') {
    drawGhost(ghostPos[0], ghostPos[1])
  }
}

function drawGrid() {
  const step = GRID
  // world extents visible
  const [wx0, wz0] = canvasToWorld(0, 0)
  const [wx1, wz1] = canvasToWorld(canvas.width, canvas.height)

  for (let wx = Math.floor(wx0); wx <= Math.ceil(wx1); wx += step) {
    const [cx] = worldToCanvas(wx, 0)
    ctx.beginPath()
    ctx.moveTo(cx, 0)
    ctx.lineTo(cx, canvas.height)
    const isMajor = wx % 10 === 0
    ctx.strokeStyle = isMajor ? COLORS.gridMajor : COLORS.grid
    ctx.lineWidth   = isMajor ? 1 : 0.5
    ctx.stroke()
    if (isMajor && zoom > 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.font = `${Math.min(10, zoom * 0.9)}px monospace`
      ctx.fillText(String(wx), cx + 2, 10)
    }
  }
  for (let wz = Math.floor(wz0); wz <= Math.ceil(wz1); wz += step) {
    const [, cy] = worldToCanvas(0, wz)
    ctx.beginPath()
    ctx.moveTo(0, cy)
    ctx.lineTo(canvas.width, cy)
    const isMajor = wz % 10 === 0
    ctx.strokeStyle = isMajor ? COLORS.gridMajor : COLORS.grid
    ctx.lineWidth   = isMajor ? 1 : 0.5
    ctx.stroke()
    if (isMajor && zoom > 6) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.font = `${Math.min(10, zoom * 0.9)}px monospace`
      ctx.fillText(String(wz), 2, cy - 2)
    }
  }

  // Axis
  const [ox, oy] = worldToCanvas(0, 0)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, canvas.height); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(canvas.width, oy);  ctx.stroke()
}

function drawItem(item: PlacedItem, selected: boolean) {
  if (item.kind === 'building') {
    const b = item.data
    const [cx, cy] = worldToCanvas(b.x - b.width/2, b.z - b.depth/2)
    const pw = b.width  * zoom
    const ph = b.depth  * zoom

    ctx.fillStyle   = selected ? COLORS.selected : COLORS.building
    ctx.strokeStyle = selected ? '#fff'           : COLORS.buildingBdr
    ctx.lineWidth   = selected ? 2 : 1
    ctx.fillRect(cx, cy, pw, ph)
    ctx.strokeRect(cx, cy, pw, ph)

    if (zoom > 5) {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = `${Math.min(11, zoom)}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(`${b.width}×${b.depth} h${b.height}`, cx + pw/2, cy + ph/2 + 4)
      ctx.textAlign = 'left'
    }
    return
  }

  if (item.kind === 'structure') {
    const s  = item.data
    const sz = Math.max(6, zoom * 1.8)
    const [cx, cy] = worldToCanvas(s.x, s.z)
    ctx.fillStyle   = COLORS[s.type] ?? '#888'
    ctx.strokeStyle = selected ? COLORS.selected : 'rgba(255,255,255,0.4)'
    ctx.lineWidth   = selected ? 2 : 1
    ctx.beginPath()
    if (s.type.startsWith('tree')) {
      // Circle for trees
      ctx.arc(cx, cy, sz / 2, 0, Math.PI * 2)
    } else {
      // Square with rotation for houses
      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(s.rotation ?? 0)
      ctx.rect(-sz/2, -sz/2, sz, sz)
      ctx.restore()
    }
    ctx.fill()
    ctx.stroke()
    if (zoom > 8) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.font = `${Math.min(11, zoom)}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText(s.type, cx, cy + sz/2 + 11)
      ctx.textAlign = 'left'
    }
    return
  }

  if (item.kind === 'playerSpawn') {
    const [cx, cy] = worldToCanvas(item.data.x, item.data.z)
    const r = Math.max(5, zoom * 0.8)
    ctx.fillStyle   = selected ? COLORS.selected : COLORS.playerSpawn
    ctx.strokeStyle = selected ? '#fff' : '#208040'
    ctx.lineWidth   = selected ? 2 : 1
    // Star shape
    drawStar(cx, cy, r, 5)
    if (zoom > 8) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)'
      ctx.font = `${Math.min(10, zoom)}px system-ui`
      ctx.textAlign = 'center'
      ctx.fillText('P', cx, cy + r + 10)
      ctx.textAlign = 'left'
    }
    return
  }

  if (item.kind === 'monsterSpawn') {
    const ms = item.data
    const [cx, cy] = worldToCanvas(ms.x, ms.z)
    const r = Math.max(4, zoom * 0.7)
    ctx.fillStyle   = selected ? COLORS.selected : (COLORS[ms.type] ?? '#888')
    ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.5)'
    ctx.lineWidth   = selected ? 2 : 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    if (zoom > 7) {
      ctx.font = `${Math.max(10, Math.min(14, zoom * 1.1))}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(MONSTER_ICON[ms.type] ?? '?', cx, cy)
      ctx.textBaseline = 'alphabetic'
      ctx.textAlign = 'left'
    }
  }
}

function drawStar(cx: number, cy: number, r: number, n: number) {
  ctx.beginPath()
  for (let i = 0; i < n * 2; i++) {
    const a = (i * Math.PI) / n - Math.PI / 2
    const ri = i % 2 === 0 ? r : r * 0.45
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri)
    else          ctx.lineTo(cx + Math.cos(a) * ri, cy + Math.sin(a) * ri)
  }
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
}

// Ghost preview
let ghostPos: [number, number] | null = null

function drawGhost(wx: number, wz: number) {
  ctx.globalAlpha = 0.45

  if (tool === 'building') {
    const w = +(document.getElementById('b-width')  as HTMLInputElement).value
    const d = +(document.getElementById('b-depth')  as HTMLInputElement).value
    const [cx, cy] = worldToCanvas(wx - w/2, wz - d/2)
    ctx.fillStyle   = COLORS.building
    ctx.strokeStyle = COLORS.buildingBdr
    ctx.lineWidth   = 1.5
    ctx.fillRect(cx, cy, w * zoom, d * zoom)
    ctx.strokeRect(cx, cy, w * zoom, d * zoom)

  } else if (tool.startsWith('tree') || ['house','house1'].includes(tool)) {
    const [cx, cy] = worldToCanvas(wx, wz)
    const sz = Math.max(6, zoom * 1.8)
    ctx.fillStyle = COLORS[tool] ?? '#888'
    ctx.beginPath()
    if (tool.startsWith('tree')) ctx.arc(cx, cy, sz/2, 0, Math.PI*2)
    else { ctx.rect(cx - sz/2, cy - sz/2, sz, sz) }
    ctx.fill()

  } else if (tool === 'player-spawn') {
    const [cx, cy] = worldToCanvas(wx, wz)
    ctx.fillStyle = COLORS.playerSpawn
    drawStar(cx, cy, Math.max(5, zoom * 0.8), 5)

  } else {
    // Monster spawn
    const [cx, cy] = worldToCanvas(wx, wz)
    ctx.fillStyle = COLORS[tool] ?? '#888'
    ctx.beginPath()
    ctx.arc(cx, cy, Math.max(4, zoom * 0.7), 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.globalAlpha = 1
}

// ── Hit testing ───────────────────────────────────────────────────────────────

function hitTest(wx: number, wz: number): number | null {
  // Test in reverse order so top-most item wins
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'building') {
      const b = item.data
      if (wx >= b.x - b.width/2 && wx <= b.x + b.width/2 &&
          wz >= b.z - b.depth/2 && wz <= b.z + b.depth/2) return i
    } else if (item.kind === 'structure') {
      const s = item.data
      const r = Math.max(1, 1.8)
      if (Math.hypot(wx - s.x, wz - s.z) <= r) return i
    } else if (item.kind === 'playerSpawn') {
      const p = item.data
      if (Math.hypot(wx - p.x, wz - p.z) <= 1.2) return i
    } else if (item.kind === 'monsterSpawn') {
      const m = item.data
      if (Math.hypot(wx - m.x, wz - m.z) <= 1.2) return i
    }
  }
  return null
}

// ── Property panel ────────────────────────────────────────────────────────────

function updatePropPanel() {
  const noneEl   = document.getElementById('prop-none')!
  const fieldsEl = document.getElementById('prop-fields')!
  const buildF   = document.getElementById('prop-building-fields')!
  const rotF     = document.getElementById('prop-rotation-field')!

  if (selectedIdx === null) {
    noneEl.style.display   = 'block'
    fieldsEl.style.display = 'none'
    return
  }

  const item = items[selectedIdx]
  noneEl.style.display   = 'none'
  fieldsEl.style.display = 'block'

  ;(document.getElementById('prop-x') as HTMLInputElement).value =
    String(item.kind === 'building'     ? item.data.x :
           item.kind === 'structure'    ? item.data.x :
           item.kind === 'playerSpawn'  ? item.data.x :
           item.data.x)
  ;(document.getElementById('prop-z') as HTMLInputElement).value =
    String(item.kind === 'building'     ? item.data.z :
           item.kind === 'structure'    ? item.data.z :
           item.kind === 'playerSpawn'  ? item.data.z :
           item.data.z)

  if (item.kind === 'building') {
    buildF.style.display = 'block'
    rotF.style.display   = 'none'
    ;(document.getElementById('prop-w') as HTMLInputElement).value = String(item.data.width)
    ;(document.getElementById('prop-d') as HTMLInputElement).value = String(item.data.depth)
    ;(document.getElementById('prop-h') as HTMLInputElement).value = String(item.data.height)
  } else if (item.kind === 'structure') {
    buildF.style.display = 'none'
    rotF.style.display   = 'block'
    ;(document.getElementById('prop-rot') as HTMLInputElement).value =
      String(Math.round(((item.data.rotation ?? 0) * 180) / Math.PI))
  } else {
    buildF.style.display = 'none'
    rotF.style.display   = 'none'
  }
}

function applyPropPanel() {
  if (selectedIdx === null) return
  const item = items[selectedIdx]
  const x = +(document.getElementById('prop-x') as HTMLInputElement).value
  const z = +(document.getElementById('prop-z') as HTMLInputElement).value

  if (item.kind === 'building') {
    item.data.x      = x
    item.data.z      = z
    item.data.width  = +(document.getElementById('prop-w') as HTMLInputElement).value
    item.data.depth  = +(document.getElementById('prop-d') as HTMLInputElement).value
    item.data.height = +(document.getElementById('prop-h') as HTMLInputElement).value
  } else if (item.kind === 'structure') {
    item.data.x = x
    item.data.z = z
    const deg = +(document.getElementById('prop-rot') as HTMLInputElement).value
    item.data.rotation = (deg * Math.PI) / 180
  } else if (item.kind === 'playerSpawn') {
    item.data.x = x
    item.data.z = z
  } else if (item.kind === 'monsterSpawn') {
    item.data.x = x
    item.data.z = z
  }
  draw()
}

// Wire property inputs
document.querySelectorAll('#prop-fields input').forEach(el => {
  el.addEventListener('change', applyPropPanel)
})

// ── Placing items ─────────────────────────────────────────────────────────────

function placeItem(wx: number, wz: number) {
  const x = snap(wx)
  const z = snap(wz)

  if (tool === 'building') {
    const w = +(document.getElementById('b-width')  as HTMLInputElement).value
    const d = +(document.getElementById('b-depth')  as HTMLInputElement).value
    const h = +(document.getElementById('b-height') as HTMLInputElement).value
    items.push({ kind: 'building', data: { x, z, width: w, depth: d, height: h } })
    return
  }

  if (['tree1','tree2','house','house1'].includes(tool)) {
    items.push({ kind: 'structure', data: { type: tool as StructureDef['type'], x, z, rotation: 0 } })
    return
  }

  if (tool === 'player-spawn') {
    items.push({ kind: 'playerSpawn', data: { x, z } })
    return
  }

  const monsterTypes = ['slime','spider','wolf','goblin','imp','orc']
  if (monsterTypes.includes(tool)) {
    items.push({ kind: 'monsterSpawn', data: { type: tool as MonsterSpawnDef['type'], x, z } })
  }
}

// ── Mouse events ──────────────────────────────────────────────────────────────

canvas.addEventListener('mousedown', e => {
  // Middle or right button → pan
  if (e.button === 1 || e.button === 2) {
    isPanning = true
    panStart = { mx: e.clientX, my: e.clientY, px: panX, py: panY }
    canvas.style.cursor = 'grabbing'
    e.preventDefault()
    return
  }

  if (e.button !== 0) return
  const [wx, wz] = canvasToWorld(e.offsetX, e.offsetY)

  if (tool === 'erase') {
    const idx = hitTest(wx, wz)
    if (idx !== null) {
      items.splice(idx, 1)
      if (selectedIdx !== null) {
        if      (selectedIdx === idx) selectedIdx = null
        else if (selectedIdx > idx)   selectedIdx--
      }
      updatePropPanel()
      draw()
    }
    return
  }

  if (tool === 'select') {
    const idx = hitTest(wx, wz)
    selectedIdx = idx
    if (idx !== null) {
      isDraggingItem = true
      const item = items[idx]
      const ix = item.kind === 'building' ? item.data.x :
                 item.kind === 'structure' ? item.data.x :
                 item.kind === 'playerSpawn' ? item.data.x : (item.data as MonsterSpawnDef).x
      const iz = item.kind === 'building' ? item.data.z :
                 item.kind === 'structure' ? item.data.z :
                 item.kind === 'playerSpawn' ? item.data.z : (item.data as MonsterSpawnDef).z
      dragOffset = { wx: wx - ix, wz: wz - iz }
    }
    updatePropPanel()
    draw()
    return
  }

  // Place mode
  placeItem(wx, wz)
  draw()
})

canvas.addEventListener('mousemove', e => {
  const [wx, wz] = canvasToWorld(e.offsetX, e.offsetY)

  coordsEl.textContent = `X: ${wx.toFixed(1)}  Z: ${wz.toFixed(1)}`

  if (isPanning) {
    panX = panStart.px + (e.clientX - panStart.mx)
    panY = panStart.py + (e.clientY - panStart.my)
    draw()
    return
  }

  if (isDraggingItem && selectedIdx !== null) {
    const sx = snap(wx - dragOffset.wx)
    const sz = snap(wz - dragOffset.wz)
    const item = items[selectedIdx]
    if (item.kind === 'building')     { item.data.x = sx; item.data.z = sz }
    if (item.kind === 'structure')    { item.data.x = sx; item.data.z = sz }
    if (item.kind === 'playerSpawn')  { item.data.x = sx; item.data.z = sz }
    if (item.kind === 'monsterSpawn') { item.data.x = sx; item.data.z = sz }
    updatePropPanel()
    draw()
    return
  }

  ghostPos = [snap(wx), snap(wz)]
  draw()
})

window.addEventListener('mouseup', e => {
  if (e.button === 1 || e.button === 2) {
    isPanning = false
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair'
  }
  if (e.button === 0 && isDraggingItem) {
    isDraggingItem = false
  }
})

canvas.addEventListener('mouseleave', () => {
  ghostPos = null
  draw()
})

canvas.addEventListener('contextmenu', e => e.preventDefault())

canvas.addEventListener('wheel', e => {
  e.preventDefault()
  const [wx, wz] = canvasToWorld(e.offsetX, e.offsetY)
  const factor = e.deltaY < 0 ? 1.12 : 1/1.12
  zoom = Math.max(3, Math.min(60, zoom * factor))
  // Re-pin the point under the cursor
  panX = e.offsetX - wx * zoom
  panY = e.offsetY - wz * zoom
  draw()
}, { passive: false })

// ── Tool buttons ──────────────────────────────────────────────────────────────

document.querySelectorAll<HTMLButtonElement>('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    tool = btn.dataset.tool as ToolMode
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedIdx = null
    updatePropPanel()
    canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair'
    draw()
  })
})

// ── Save / Load / Export / Clear ─────────────────────────────────────────────

function buildMapDef(): MapDef {
  return {
    buildings:     items.filter(i => i.kind === 'building')    .map(i => ({ ...(i.data as BuildingDef) })),
    structures:    items.filter(i => i.kind === 'structure')   .map(i => ({ ...(i.data as StructureDef) })),
    playerSpawns:  items.filter(i => i.kind === 'playerSpawn') .map(i => ({ ...(i.data as SpawnPoint) })),
    monsterSpawns: items.filter(i => i.kind === 'monsterSpawn').map(i => ({ ...(i.data as MonsterSpawnDef) })),
  }
}

function loadMapDef(map: MapDef) {
  items.length = 0
  map.buildings    .forEach(d => items.push({ kind: 'building',     data: { ...d } }))
  map.structures   .forEach(d => items.push({ kind: 'structure',    data: { ...d } }))
  map.playerSpawns .forEach(d => items.push({ kind: 'playerSpawn',  data: { ...d } }))
  map.monsterSpawns.forEach(d => items.push({ kind: 'monsterSpawn', data: { ...d } }))
  selectedIdx = null
  updatePropPanel()
  draw()
}

document.getElementById('btn-save')!.addEventListener('click', () => {
  const json = JSON.stringify(buildMapDef(), null, 2)
  // Also persist to localStorage so the game picks it up automatically
  try { localStorage.setItem('rooftopMap', json) } catch { /* quota exceeded */ }
  const blob = new Blob([json], { type: 'application/json' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'map.json'
  a.click()
  URL.revokeObjectURL(url)
})

const fileInput = document.getElementById('file-input') as HTMLInputElement
document.getElementById('btn-load')!.addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = e => {
    try {
      const map = JSON.parse(e.target!.result as string) as MapDef
      loadMapDef(map)
    } catch {
      alert('Could not parse map JSON.')
    }
  }
  reader.readAsText(file)
  fileInput.value = ''
})

document.getElementById('btn-export')!.addEventListener('click', () => {
  const json = JSON.stringify(buildMapDef(), null, 2)
  navigator.clipboard.writeText(json).then(
    ()  => { const b = document.getElementById('btn-export')!; const orig = b.textContent; b.textContent = '✓ Copied!'; setTimeout(() => { b.textContent = orig }, 1500) },
    ()  => alert(json),
  )
})

document.getElementById('btn-clear')!.addEventListener('click', () => {
  if (!confirm('Clear all objects from the map?')) return
  items.length = 0
  selectedIdx  = null
  updatePropPanel()
  draw()
})

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

window.addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'Escape' || e.key === 's') {
    // Switch to select
    document.getElementById('tool-select')!.click()
  }
  if (e.key === 'e') {
    document.getElementById('tool-erase')!.click()
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedIdx !== null) {
      items.splice(selectedIdx, 1)
      selectedIdx = null
      updatePropPanel()
      draw()
    }
  }
  if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) {
    if (items.length > 0) {
      items.pop()
      if (selectedIdx !== null && selectedIdx >= items.length) selectedIdx = null
      updatePropPanel()
      draw()
    }
  }
})

// ── Init ──────────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  const oldW = canvas.width
  const oldH = canvas.height
  canvas.width  = wrap.clientWidth
  canvas.height = wrap.clientHeight
  // Keep pan relative to old centre
  panX += (canvas.width  - oldW) / 2
  panY += (canvas.height - oldH) / 2
  draw()
})

canvas.width  = wrap.clientWidth
canvas.height = wrap.clientHeight
panX = canvas.width  / 2
panY = canvas.height / 2
updatePropPanel()
draw()
