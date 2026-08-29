# nomacode

## Install (SHA-256)

Pin GitHub Release **v0.6.0** and verify `SHA256SUMS`. Website `install.sh` / `install.ps1` abort on mismatch.

https://github.com/LinespottingOrg/GrokBuildRemote-Agents/releases/tag/v0.6.0
https://github.com/LinespottingOrg/GrokBuildRemote-Agents/blob/main/docs/PINNED-INSTALL.md

```
96cef605d3e030ccef99d27ea6240e0d3b668dd045e6b5b9e585c9fd03c6ef23  gbr-agent-darwin-amd64
de7e065ef2cf6877b3b2cd04679a67b627f876337f529247e236204543e4062c  gbr-agent-darwin-arm64
a50a5c41993e6531a3b477eb409ccc845212bf541384dc803061c80657f86719  gbr-agent-linux-amd64
5bfd22c7110234942c4c02ff8154b836d0af45a9422c178a4f52010187d40061  gbr-agent-linux-arm64
f773b89fd31310172b756e0593e0f3b2382b0a3440af2a7d0a8b3073b0c23e27  gbr-agent-windows-amd64.exe
8fb9efcbc7e2ac91c11964944bf0f45e31bb23f4356d9dcb4b305d7cb9b0fe8c  gbr-agent-windows-arm64.exe
```

```bash
VER=v0.6.0
BASE=https://github.com/LinespottingOrg/GrokBuildRemote-Agents/releases/download/$VER
# swap darwin-arm64 for your OS/arch
curl -fsSL -o gbr-agent-darwin-arm64 "$BASE/gbr-agent-darwin-arm64"
curl -fsSL -o SHA256SUMS "$BASE/SHA256SUMS"
shasum -a 256 -c SHA256SUMS --ignore-missing
gbr-agent pair && gbr-agent run
```


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

### Desktop agents from the phone (no inbound)

Nomacode runs the agent **on the phone**. To spectate a **desktop** coding
agent without SSH or publishing a port, see [Build Remote Agent](docs/gbr.md)
(`gbr-agent pair` / `run`). Companion pairing device, not a Nomacode replacement.

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

## What the phone sees

**Terminal windows** on this PC (machine-wide mailbox). Not headless OpenCode / CodeNomad sidecar / Electron. `:8788` in a sidecar is Bot API JSON, not a transcript.

https://github.com/LinespottingOrg/GrokBuildRemote-Agents/blob/main/docs/WHAT-THE-PHONE-SEES.md
https://grokbuildremote.com/integrations.html
