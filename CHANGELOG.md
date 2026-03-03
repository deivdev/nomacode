# Changelog

## v2026.3.1 (2026-03-03)

### Added
- **OpenCode support** — OpenCode is now available as a tool alongside Claude Code. When installed, it appears in the tool selector for new sessions. When not installed, an Install button is shown.
- **Codex support** — Codex (OpenAI) remains in the tool list and works on supported platforms.

### Fixed
- **ASCII logo scrollbar** — Removed horizontal scrollbar that appeared on the welcome screen logo on some viewports.

### Platform Notes
- **OpenCode and Codex work on desktop Linux and macOS** but **do not work natively on Termux/Android**. OpenCode's Go binary requires a standard Linux dynamic linker (`/lib/ld-linux-aarch64.so.1`) and PIE compilation, neither of which are available on Android. Codex has similar architecture constraints. Workarounds include using `proot-distro` (slow) or a remote server.
- **Claude Code remains the recommended tool for Termux/Android.**

## v2026.2.2 (2026-02-28)

### Changed
- Bump version to v2026.2.2

## v2026.2.1 (2026-02-27)

### Added
- GitHub Device Flow OAuth for private repo cloning
- Git credentials support for private repositories

### Fixed
- Remove touch gestures to fix text selection on mobile
