# nomacode

```
  _  _  __  __  _  ___  __  ___  ___
 | \| |/  \|  \/ |/   |/  \|   \| __|
 | .  | () | |\/| |   | () | |) | _|
 |_|\_|\__/|_|  |_|\___|\__/|___/|___|
       >> THE MOBILE NOMAD IDE <<
```

> **My first open source project ever!** Feedback and contributions welcome.

Code anywhere, like a local. Run Claude Code directly from Android using Termux.

<img src="https://github.com/user-attachments/assets/b105141c-31f8-4e80-8239-fa8d2561d76d" width="300"> <img src="https://github.com/user-attachments/assets/e14304a0-8393-4791-baf5-4f4561466005" width="300">

## Requirements

**Termux** is required. Download from [F-Droid](https://f-droid.org/packages/com.termux/) (recommended) or Google Play.

## Install

Open Termux, tap and hold to paste:

```bash
pkg install -y git nodejs && git clone https://github.com/deivdev/nomacode.git ~/nomacode && cd ~/nomacode && npm install && npm start
```

Browser opens automatically. Tap **⋮ → Add to Home Screen** for the full PWA experience.

---

## Start (after install)

```bash
cd ~/nomacode && npm start
```

Or just tap the Nomacode icon on your home screen.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Shift+K` | Command palette |
| `Shift+N` | New session |
| `Shift+W` | Close session |
| `Shift+O` | Open repository |
| `Shift+C` | Clone repository |
| `Shift+1-9` | Switch to session |

## Features

- Terminal emulator (xterm.js)
- Clone and manage git repositories
- Run Claude Code
- Multiple sessions with tabs
- Keyboard-driven interface

## Roadmap

### iOS Support

Currently Nomacode requires Termux, which is Android-only. iOS implementation ideas welcome:

- **iSH** - Linux shell emulator for iOS (Alpine-based, limited but functional)
- **a]shell** - Local terminal with SSH, could potentially run Node.js
- **Jailbreak options** - NewTerm or similar for jailbroken devices
- **Self-hosted server** - Run Nomacode server on a VPS/Raspberry Pi, connect from iOS Safari
- **Native iOS app** - WebSocket client that connects to a remote Nomacode server

Have ideas? Open an issue or PR.

### Tool Support

**Current status:**
- **Claude Code** - Works natively in Termux
- **OpenCode** - Works natively in Termux via the prebuilt aarch64 build

OpenCode compiles to a standalone binary using [Bun](https://bun.sh/), which
has no official Android support, so `npm install -g opencode-ai` cannot work
under Termux. [guysoft/opencode-termux](https://github.com/guysoft/opencode-termux)
cross-compiles Bun and WebKit/JSC for Android/aarch64 and publishes prebuilt
packages; Nomacode installs from those automatically when running on Termux.

### Community Standards

Planning to implement all GitHub community standards:

- [ ] Code of Conduct
- [ ] Contributing guidelines
- [ ] Issue templates
- [ ] Pull request templates
- [ ] Security policy

