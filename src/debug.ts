import type { CharacterType } from './types'

export class DebugPanel {
  private isOpen = false

  onSwitchCharacter?: () => void
  onSpawnFox?: () => void
  onSpawnHawk?: () => void

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', e => {
      if (e.code === 'Backquote') {
        e.preventDefault()
        this.isOpen ? this.close() : this.open()
      }
    })

    document.getElementById('debugSwitchChar')!.addEventListener('click', () => {
      this.onSwitchCharacter?.()
    })

    document.getElementById('debugSpawnFox')!.addEventListener('click', () => {
      this.onSpawnFox?.()
      this.close()
    })

    document.getElementById('debugSpawnHawk')!.addEventListener('click', () => {
      this.onSpawnHawk?.()
      this.close()
    })

    document.getElementById('debugClose')!.addEventListener('click', () => {
      this.close()
    })
  }

  private open() {
    this.isOpen = true
    document.getElementById('debugPanel')!.style.display = 'flex'
    document.exitPointerLock()
  }

  private close() {
    this.isOpen = false
    document.getElementById('debugPanel')!.style.display = 'none'
    this.canvas.requestPointerLock()
  }

  setCharacter(c: CharacterType) {
    const btn = document.getElementById('debugSwitchChar') as HTMLButtonElement
    btn.textContent = c === 'squirrel' ? 'Switch to Sea Gull' : 'Switch to Squirrel'
  }
}
