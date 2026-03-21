# Life of Squirrel

A 2-player multiplayer 3D browser game. Play as a squirrel with a friend — no install, no server required.

**Play here:** https://jpdieffe.github.io/life_of_squirrel

**Map Editor:** https://jpdieffe.github.io/life_of_squirrel/editor.html

## How to play

1. One player clicks **Host Game** and copies the room code
2. Send the code to your friend
3. Friend pastes it and clicks **Join Game**
4. Both players connect directly via WebRTC (P2P)

## Controls

| Key | Action |
|---|---|
| W A S D / Arrow keys | Move |
| Space or E | Jump |
| Mouse drag | Rotate camera |

## Tech stack

- **Babylon.js** — 3D rendering & physics
- **PeerJS** (WebRTC) — browser-to-browser P2P networking
- **Vite + TypeScript** — bundler & language

## Local development

```bash
npm install
npm run dev      # http://localhost:5173
```

## Deploy

```bash
npm run build    # outputs to docs/
git add -A && git commit -m "update" && git push
```

GitHub Pages serves from the `docs/` folder on the `main` branch.
