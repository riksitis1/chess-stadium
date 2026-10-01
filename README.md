# ♟️ Chess 1v1 Multiplayer with Anti-Cheat Guard & Cloudflare

A real-time multiplayer chess platform featuring 10-minute rapid clocks, classic green and white tournament checkerboard, automated random 1v1 matchmaking with zero bots, and real-time tab-switching Fair-Play anti-cheat protection.

---

## ✨ Features

- **🌐 Cloudflare Public Tunneling**: Made public to players worldwide using built-in `cloudflared` quick tunneling (`https://*.trycloudflare.com`) with zero port-forwarding or account requirements.
- **⚡ 1v1 Random Matchmaking (No Bots)**: Instant matchmaking queue. When you click **"Find Random 1v1"**, you enter the real-player queue. As soon as another human clicks it, both players are matched into a game. No bots are ever used.
- **🔗 Private Rooms & Direct Share Links**: Create a private room code and send the public link (with `?room=ROOM_CODE`) to any friend to play immediately.
- **🟩 Green & White Checkerboard**: Classic tournament green (`#769656`) and ivory white (`#eeeed2`) checkerboard with coordinate markings, smooth piece drag-and-drop, and click-to-move.
- **⏱️ 10-Minute Rapid Clocks**: 10:00 countdown timer per player, synchronized with millisecond server delta calculations to prevent local clock tampering. Pulsing red alarm triggers when below 60 seconds.
- **🛡️ Advanced Fair-Play Anti-Cheat Engine**:
  - **Tab Switch Detection**: Intercepts `visibilitychange` events when a player leaves the tab to consult an external engine (Stockfish, Chess.com analysis, etc.).
  - **Window Focus / Blur Guard**: Detects `window.onblur` if a player clicks on secondary monitors or background apps.
  - **DevTools / Inspect Blocker**: Prevents `F12`, `Ctrl+Shift+I`, and DOM tampering shortcuts.
  - **3-Strike System**:
    - **Strike 1**: Audio warning + banner ("Focus Lost: Return to window! Strike 1/3").
    - **Strike 2**: Urgent alarm + 15-second forfeit countdown timer ("Strike 2/3: Next violation forfeits match").
    - **Strike 3 / Disqualification**: Immediate disqualification. Victory automatically awarded to the honest opponent.
  - **Live Anti-Cheat Telemetry**: Both players can see each other's live tab status (🟢 Active vs 🔴 Away) and strike counts.
  - **Authoritative Server Validation**: All moves are validated on the server via `chess.js`.
- **🔊 Procedural Web Audio API Sound Effects**: Realistic wooden move knocks, capture impacts, check chimes, victory fanfare, defeat chords, and anti-cheat alarm siren synthesized natively with zero external audio assets.
- **📊 Material Advantage & Move History**: Real-time captured piece trays, material difference counter (`+3`, etc.), and scrollable algebraic notation history table.

---

## 🚀 How to Run

### Method 1: Double-Click Launcher (Windows)
Double-click `start.bat` in this folder. It will start the server, launch the Cloudflare tunnel, and open `http://localhost:3000` in your default browser.

### Method 2: NPM Commands
```bash
# Start local server + Cloudflare public tunnel:
npm run tunnel

# Or start local server only:
npm start
```

### Method 3: Access Publicly via Cloudflare
When running with `npm run tunnel`, the terminal will display your unique public URL:
```
======================================================
🌟 YOUR CHESS GAME IS NOW PUBLIC ACROSS THE WORLD!
🌐 Public Cloudflare URL:  https://xxxx.trycloudflare.com
🏠 Local URL:              http://localhost:3000
======================================================
```
Share that link with your opponent, and both of you can play 1v1 anywhere across the internet!
