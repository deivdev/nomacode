const { execSync } = require('child_process');

// Termux is the primary target and needs different install paths: it is
// Android/aarch64, so anything requiring Bun can't use the npm package.
const isTermux = !!process.env.TERMUX_VERSION ||
  (process.env.PREFIX || '').includes('com.termux');

// OpenCode compiles to a standalone binary via Bun, and Bun has no Android
// support (upstream marked "not planned"), so `npm install -g opencode-ai`
// cannot work under Termux. guysoft/opencode-termux cross-compiles Bun and
// WebKit/JSC for aarch64 and publishes prebuilt packages; use those instead.
// The .deb asset name embeds the OpenCode version (opencode_1.17.9_aarch64.deb),
// so there is no stable `releases/latest/download/<name>` URL — the one in the
// project README 404s. Resolve the real asset from the releases API instead.
const OPENCODE_TERMUX_INSTALL = [
  'set -eu',
  'echo "Installing OpenCode for Termux (aarch64)…"',
  'pkg install -y ripgrep curl',
  'api=https://api.github.com/repos/guysoft/opencode-termux/releases/latest',
  'deb_url=$(curl -fsSL "$api" | grep -o "https://[^\\"]*_aarch64\\.deb" | head -1)',
  'sums_url=$(curl -fsSL "$api" | grep -o "https://[^\\"]*SHA256SUMS" | head -1)',
  'if [ -z "$deb_url" ]; then echo "Could not find an aarch64 .deb in the latest release." >&2; exit 1; fi',
  'tmp=$(mktemp -d)',
  'trap \'rm -rf "$tmp"\' EXIT',
  'echo "Downloading $deb_url"',
  'curl -fL -o "$tmp/opencode.deb" "$deb_url"',
  // Verify against the published checksums: this is a binary we are about to
  // install and run. Skipped only if the release has no SHA256SUMS.
  'if [ -n "$sums_url" ]; then',
  '  curl -fsSL -o "$tmp/SHA256SUMS" "$sums_url"',
  '  name=$(basename "$deb_url")',
  '  want=$(grep " [ *]*$name$" "$tmp/SHA256SUMS" | awk \'{print $1}\' | head -1)',
  '  if [ -n "$want" ]; then',
  '    got=$(sha256sum "$tmp/opencode.deb" | awk \'{print $1}\')',
  '    if [ "$want" != "$got" ]; then echo "Checksum mismatch for $name" >&2; exit 1; fi',
  '    echo "Checksum OK"',
  '  else',
  '    echo "Warning: no checksum listed for $name" >&2',
  '  fi',
  'else',
  '  echo "Warning: release publishes no SHA256SUMS; skipping verification" >&2',
  'fi',
  'dpkg -i "$tmp/opencode.deb"',
  'echo "OpenCode installed."'
].join('\n');

// Define available tools with their commands and install instructions
const TOOLS = {
  'claude-code': {
    command: 'claude',
    name: 'Claude Code',
    installCmd: 'npm install -g @anthropic-ai/claude-code',
    description: 'Anthropic\'s AI coding assistant'
  },
  'opencode': {
    command: 'opencode',
    name: 'OpenCode',
    // On Termux the npm package can't run (no Bun for Android), so install
    // the prebuilt aarch64 build. installScript needs a shell; installCmd is
    // a single argv-style command. Exactly one of the two is set.
    installCmd: isTermux ? null : 'npm install -g opencode-ai',
    installScript: isTermux ? OPENCODE_TERMUX_INSTALL : null,
    description: 'Open-source AI coding assistant'
  },
  'shell': {
    command: null, // Always available
    name: 'Bash Shell',
    installCmd: null,
    description: 'Standard terminal shell'
  }
};

// Cache for tool availability (refreshed on each call but memoized for the request)
let toolCache = null;
let cacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

function commandExists(cmd, fastCheck = false) {
  // Validate command name to prevent injection (extra safety layer)
  if (!/^[a-zA-Z0-9_-]+$/.test(cmd)) {
    return false;
  }

  const isWindows = process.platform === 'win32';
  // `which` is not present on Termux (and not guaranteed on minimal Linux);
  // `command -v` is a POSIX shell builtin that's always available. Using it
  // fixes every tool showing as "not installed" on Termux.
  const whichCmd = isWindows ? 'where' : 'command -v';

  try {
    // First check if command is in PATH
    execSync(`${whichCmd} ${cmd}`, { stdio: 'ignore' });

    // Fast check mode: skip version verification (much faster for session creation)
    if (fastCheck) {
      return true;
    }

    // Then verify it's actually executable by running --help or --version
    // This catches binary format incompatibilities (e.g., wrong architecture on Termux)
    // We need to capture stderr to detect binary errors
    const execOptions = {
      timeout: 5000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'pipe'] // Capture stderr
    };

    const isBinaryError = (err) => {
      const errorText = ((err.stderr && err.stderr.toString()) || '') + (err.message || '');
      return errorText.includes('Exec format error') ||
             errorText.includes('cannot execute') ||
             errorText.includes('e_type') ||
             errorText.includes('Bad CPU type') ||
             errorText.includes('not executable');
    };

    // Try --version first (most tools support it), then --help
    for (const flag of ['--version', '--help']) {
      try {
        execSync(`${cmd} ${flag}`, execOptions);
        return true; // Success - command exists and runs
      } catch (err) {
        if (isBinaryError(err)) {
          return false; // Binary incompatible with this architecture
        }
        // Non-zero exit is okay, try next flag
      }
    }

    // Both flags failed but not with binary errors - command likely exists
    // (some tools require subcommands and fail on --help/--version)
    return true;
  } catch {
    return false; // Command not in PATH
  }
}

function detectTools() {
  const now = Date.now();

  // Return cached result if fresh
  if (toolCache && (now - cacheTime) < CACHE_TTL) {
    return toolCache;
  }

  const available = [];
  const unavailable = [];

  for (const [id, tool] of Object.entries(TOOLS)) {
    const info = {
      id,
      name: tool.name,
      description: tool.description,
      // The UI only needs to know whether an install path exists, not which
      // mechanism it uses.
      installCmd: tool.installCmd || (tool.installScript ? 'termux' : null)
    };

    if (tool.command === null) {
      // Shell is always available
      info.available = true;
      available.push(info);
    } else if (commandExists(tool.command)) {
      info.available = true;
      available.push(info);
    } else {
      info.available = false;
      unavailable.push(info);
    }
  }

  toolCache = { available, unavailable };
  cacheTime = now;

  return toolCache;
}

function getDefaultTool() {
  const { available } = detectTools();
  // Prefer claude-code, then opencode, then shell
  const priority = ['claude-code', 'opencode', 'shell'];

  for (const id of priority) {
    if (available.find(t => t.id === id)) {
      return id;
    }
  }

  return 'shell';
}

function isToolAvailable(toolId) {
  if (!toolId || toolId === 'shell') return true;

  // Fast path: check cache first without full detection
  const now = Date.now();
  if (toolCache && (now - cacheTime) < CACHE_TTL) {
    return toolCache.available.some(t => t.id === toolId);
  }

  // Cache stale: only check the specific tool with fast mode (skips slow --version check)
  const tool = TOOLS[toolId];
  if (!tool) return false;
  if (tool.command === null) return true;

  return commandExists(tool.command, true); // fast check
}

function getToolInfo(toolId) {
  return TOOLS[toolId] || null;
}

function clearCache() {
  toolCache = null;
  cacheTime = 0;
}

module.exports = {
  detectTools,
  getDefaultTool,
  isToolAvailable,
  getToolInfo,
  clearCache,
  TOOLS
};
