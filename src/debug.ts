export class DebugPanel {
  private readonly canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas

    // Backtick releases pointer lock so the player can interact with the browser
    window.addEventListener('keydown', e => {
      if (e.code === 'Backquote') {
        e.preventDefault()
        document.exitPointerLock()
      }
    })
  }
}
