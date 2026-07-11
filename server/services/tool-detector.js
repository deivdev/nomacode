const { execSync } = require('child_process');

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
    installCmd: 'npm install -g opencode-ai',
    description: 'Open-source AI coding assistant'
  },
  'codex': {
    command: 'codex',
    name: 'Codex',
    installCmd: 'npm install -g @openai/codex',
    description: 'OpenAI Codex CLI'
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
      installCmd: tool.installCmd
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
  // Prefer claude-code, then opencode, then codex, then shell
  const priority = ['claude-code', 'opencode', 'codex', 'shell'];

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
