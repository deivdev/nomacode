# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Nomacode is a mobile-first PWA for running AI coding assistants (Claude Code, OpenCode) on Android via Termux. It provides a terminal emulator interface with repository management and multi-session support.

**Stack**: Express backend + Vanilla JS frontend with xterm.js

## Commands

```bash
npm start              # Start server (opens browser at localhost:3000)
npm start -- --port 8080  # Custom port
npm start -- --no-open    # Skip auto-browser-open
```

No test framework or linting is configured.

## Architecture

```
Browser (PWA)
    ↓ WebSocket (JSON messages for terminal I/O)
Express Server (server/index.js)
    ├── REST API (server/api/)
    │   ├── repos.js      # Git clone/create/pull/status
    │   ├── sessions.js   # Terminal session lifecycle
    │   ├── settings.js   # User preferences
    │   └── tools.js      # AI tool detection & installation
    └── Services (server/services/)
        ├── pty-manager.js    # Terminal sessions (node-pty → script → spawn fallbacks)
        ├── repo-manager.js   # Git operations via simple-git
        ├── tool-detector.js  # Tool availability with 30s cache
        └── config.js         # Persists to ~/.nomacode/config.json
    ↓
File System (~/.nomacode/repos/) + Git + Shell
```

**Frontend** (`web/`): Single `Nomacode` class in `app.js` manages all state and UI. Event-driven with keyboard shortcuts.

## Key Files

| File | Purpose |
|------|---------|
| `bin/nomacode.js` | CLI entry point with argument parsing |
| `server/index.js` | Express server setup |
| `server/websocket.js` | WebSocket protocol for terminal I/O |
| `server/services/pty-manager.js` | PTY abstraction (supports node-pty, Android node-pty, script command, direct spawn) |
| `web/js/app.js` | Frontend state & UI logic (~1500 lines) |
| `web/css/style.css` | Terminal-like dark theme |

## WebSocket Protocol

Messages are JSON with `type` field:
- **attach/detach/input/resize** (client → server)
- **output/exit** (server → client)

## Data Storage

- Config: `~/.nomacode/config.json`
- Repos: `~/.nomacode/repos/{name}/`

## Platform Notes

- Server binds to 127.0.0.1 only (localhost)
- PTY manager tries node-pty variants first, falls back to `script` command on Unix or direct `spawn()` on Windows
- Primary target is Termux (Android), detected via `TERMUX_VERSION` env var
