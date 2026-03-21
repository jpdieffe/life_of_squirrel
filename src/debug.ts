import type { CharacterType } from './types'

export class DebugPanel {
  private readonly canvas: HTMLCanvasElement
  private readonly panel: HTMLElement
  private character: CharacterType = 'squirrel'

  onSwitchCharacter?: () => void

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.panel  = document.getElementById('debugPanel') as HTMLElement

    window.addEventListener('keydown', e => {
      if (e.code !== 'Backquote') return
      e.preventDefault()
      if (e.shiftKey) {
        // Tilde (~) toggles the debug panel
        const open = this.panel.style.display !== 'none'
        if (open) {
          this.panel.style.display = 'none'
          canvas.requestPointerLock()
        } else {
          document.exitPointerLock()
          this.panel.style.display = 'flex'
        }
      } else {
        // Backtick (`) just releases pointer lock
        document.exitPointerLock()
      }
    })

    document.getElementById('debugSwitchChar')!.addEventListener('click', () => {
      this.onSwitchCharacter?.()
    })

    document.getElementById('debugClose')!.addEventListener('click', () => {
      this.panel.style.display = 'none'
      canvas.requestPointerLock()
    })
  }

  setCharacter(c: CharacterType) {
    this.character = c
    const btn = document.getElementById('debugSwitchChar') as HTMLButtonElement
    btn.textContent = c === 'squirrel' ? 'Switch to Sea Gull' : 'Switch to Squirrel'
  }
}
