import type { CharacterClass } from './types'

interface CharInfo {
  icon:  string
  label: string
  desc:  string
  color: string
}

const CHARS: Record<CharacterClass, CharInfo> = {
  warrior: { icon: '⚔️',  label: 'Warrior', desc: 'Heavy sword slash',     color: '#c8902a' },
  wizard:  { icon: '🔮',  label: 'Wizard',  desc: 'Long-range fire bolt',  color: '#8b4fd8' },
  rogue:   { icon: '🗡️',  label: 'Rogue',   desc: 'Quick dagger slash',    color: '#2d9e5a' },
  archer:  { icon: '🏹',  label: 'Archer',  desc: 'Fast arrow shot',       color: '#2878c0' },
}

export class DebugPanel {
  private readonly el: HTMLElement
  private isOpen = false
  private current: CharacterClass = 'warrior'
  private readonly canvas: HTMLCanvasElement

  /** Fires when the user picks a new character */
  onCharacterChange: ((cls: CharacterClass) => void) | null = null

  /** Fires when the user toggles camera mode */
  onCameraToggle: ((firstPerson: boolean) => void) | null = null
  private fpMode = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.el = this.buildHTML()
    document.body.appendChild(this.el)

    window.addEventListener('keydown', e => {
      if (e.code === 'Backquote') {
        e.preventDefault()
        this.toggle()
      }
    })
  }

  // ── Public ──────────────────────────────────────────────────────────────

  /** Sync highlighted button without firing the callback */
  setCharacter(cls: CharacterClass) {
    this.current = cls
    this.refreshButtons()
    this.updateHudLabel(cls)
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private toggle() {
    this.isOpen = !this.isOpen
    this.el.style.display = this.isOpen ? 'flex' : 'none'

    if (this.isOpen) {
      document.exitPointerLock()
    } else {
      // Re-capture mouse (only when the lobby is already gone)
      const lobby = document.getElementById('lobby')
      if (!lobby || lobby.style.display === 'none') {
        this.canvas.requestPointerLock()
      }
    }
  }

  private refreshButtons() {
    this.el.querySelectorAll<HTMLButtonElement>('.char-btn').forEach(btn => {
      const cls = btn.dataset.cls as CharacterClass
      const info = CHARS[cls]
      const selected = cls === this.current
      btn.style.borderColor = selected ? info.color : 'transparent'
      btn.style.background  = selected ? info.color + '33' : 'transparent'
    })
  }

  private updateHudLabel(cls: CharacterClass) {
    const el = document.getElementById('charLabel')
    if (el) {
      const info = CHARS[cls]
      el.textContent = `${info.icon} ${info.label}`
      el.style.color  = info.color
    }
  }

  private buildHTML(): HTMLElement {
    const panel = document.createElement('div')
    panel.id = 'debugPanel'
    Object.assign(panel.style, {
      display:        'none',
      position:       'fixed',
      top:            '50%',
      left:           '50%',
      transform:      'translate(-50%, -50%)',
      background:     'rgba(8, 8, 28, 0.97)',
      border:         '1px solid #353570',
      borderRadius:   '14px',
      padding:        '1.4rem 1.6rem',
      zIndex:         '50',
      flexDirection:  'column',
      gap:            '0.5rem',
      minWidth:       '290px',
      fontFamily:     'system-ui, sans-serif',
      color:          '#e0e0f0',
      backdropFilter: 'blur(8px)',
      userSelect:     'none',
    } as Partial<CSSStyleDeclaration>)

    // Title
    const title = document.createElement('div')
    Object.assign(title.style, {
      fontSize:      '0.72rem',
      color:         '#606090',
      marginBottom:  '0.2rem',
      letterSpacing: '0.1em',
    } as Partial<CSSStyleDeclaration>)
    title.textContent = '[ ` ] CHARACTER SELECT'
    panel.appendChild(title)

    // Character buttons
    const classes: CharacterClass[] = ['warrior', 'wizard', 'rogue', 'archer']
    classes.forEach(cls => {
      const info = CHARS[cls]
      const btn = document.createElement('button')
      btn.className = 'char-btn'
      btn.dataset.cls = cls
      Object.assign(btn.style, {
        display:      'flex',
        alignItems:   'center',
        gap:          '0.75rem',
        width:        '100%',
        padding:      '0.55rem 0.75rem',
        border:       '2px solid transparent',
        borderRadius: '8px',
        background:   'transparent',
        color:        '#e0e0f0',
        cursor:       'pointer',
        transition:   'all 0.12s',
      } as Partial<CSSStyleDeclaration>)

      // Hover effects
      btn.addEventListener('mouseenter', () => {
        btn.style.background = info.color + '22'
      })
      btn.addEventListener('mouseleave', () => {
        btn.style.background = cls === this.current ? info.color + '33' : 'transparent'
      })

      // Icon
      const icon = document.createElement('span')
      icon.style.fontSize = '1.35rem'
      icon.textContent    = info.icon

      // Text block
      const textWrap = document.createElement('div')
      const name = document.createElement('div')
      Object.assign(name.style, { fontWeight: '700', fontSize: '0.95rem' } as Partial<CSSStyleDeclaration>)
      name.textContent = info.label

      const desc = document.createElement('div')
      Object.assign(desc.style, { fontSize: '0.72rem', color: '#8080a0' } as Partial<CSSStyleDeclaration>)
      desc.textContent = info.desc

      textWrap.appendChild(name)
      textWrap.appendChild(desc)
      btn.appendChild(icon)
      btn.appendChild(textWrap)

      btn.addEventListener('click', () => {
        this.current = cls
        this.refreshButtons()
        this.updateHudLabel(cls)
        this.onCharacterChange?.(cls)
        // Close panel after a brief moment
        setTimeout(() => this.toggle(), 100)
      })

      panel.appendChild(btn)
    })

    // Close hint
    const tip = document.createElement('div')
    Object.assign(tip.style, {
      fontSize:  '0.68rem',
      color:     '#404060',
      marginTop: '0.3rem',
      textAlign: 'center',
    } as Partial<CSSStyleDeclaration>)
    tip.textContent = 'Press ` to close without changing'
    panel.appendChild(tip)

    // ── Camera toggle ──────────────────────────────────────────────────────
    const divider = document.createElement('div')
    Object.assign(divider.style, {
      borderTop:  '1px solid #282848',
      margin:     '0.4rem 0',
    } as Partial<CSSStyleDeclaration>)
    panel.appendChild(divider)

    const camBtn = document.createElement('button')
    camBtn.id = 'camToggleBtn'
    Object.assign(camBtn.style, {
      width:        '100%',
      padding:      '0.55rem 0.75rem',
      border:       '2px solid #353570',
      borderRadius: '8px',
      background:   'transparent',
      color:        '#e0e0f0',
      cursor:       'pointer',
      fontSize:     '0.9rem',
      fontWeight:   '700',
      fontFamily:   'system-ui, sans-serif',
      transition:   'all 0.12s',
    } as Partial<CSSStyleDeclaration>)
    camBtn.textContent = '👁 Switch to First Person'
    camBtn.addEventListener('mouseenter', () => { camBtn.style.background = '#353570' })
    camBtn.addEventListener('mouseleave', () => { camBtn.style.background = 'transparent' })
    camBtn.addEventListener('click', () => {
      this.fpMode = !this.fpMode
      camBtn.textContent = this.fpMode ? '👁 Switch to Third Person' : '👁 Switch to First Person'
      this.onCameraToggle?.(this.fpMode)
    })
    panel.appendChild(camBtn)

    return panel
  }
}
