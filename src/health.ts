export class HealthSystem {
  readonly maxHearts: number
  current: number

  private invulnerable = false
  private invulTimer   = 0
  private readonly INV_DURATION = 2.5   // seconds of invulnerability after a hit

  onDeath: (() => void) | null = null

  private readonly hudEl: HTMLElement

  constructor(hearts = 10) {
    this.maxHearts = hearts
    this.current   = hearts

    const el = document.createElement('div')
    el.id = 'healthHUD'
    Object.assign(el.style, {
      position:       'fixed',
      top:            '0.75rem',
      left:           '50%',
      transform:      'translateX(-50%)',
      display:        'flex',
      gap:            '0.1rem',
      fontSize:       '1.3rem',
      pointerEvents:  'none',
      zIndex:         '25',
      textShadow:     '0 1px 4px rgba(0,0,0,0.85)',
    } as Partial<CSSStyleDeclaration>)
    document.body.appendChild(el)
    this.hudEl = el
    this.refresh()
  }

  // Returns true if damage was applied (false if invulnerable)
  takeDamage(amount = 1): boolean {
    if (this.invulnerable) return false
    this.current      = Math.max(0, this.current - amount)
    this.invulnerable = true
    this.invulTimer   = this.INV_DURATION
    this.refresh()
    if (this.current <= 0) this.onDeath?.()
    return true
  }

  reset() {
    this.current      = this.maxHearts
    this.invulnerable = false
    this.invulTimer   = 0
    this.refresh()
  }

  isInvulnerable() { return this.invulnerable }

  update(dt: number) {
    if (this.invulnerable) {
      this.invulTimer -= dt
      if (this.invulTimer <= 0) {
        this.invulnerable = false
        this.invulTimer   = 0
      }
    }
  }

  // Returns whether the player mesh should be visible this frame (blinking)
  blinkVisible(): boolean {
    if (!this.invulnerable) return true
    return Math.floor(this.invulTimer * 10) % 2 === 0
  }

  private refresh() {
    this.hudEl.innerHTML = ''
    for (let i = 0; i < this.maxHearts; i++) {
      const s = document.createElement('span')
      s.textContent = i < this.current ? '❤️' : '🖤'
      this.hudEl.appendChild(s)
    }
  }
}
