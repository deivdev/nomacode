const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// Detect available PTY method
let ptyMethod = 'direct'; // 'node-pty', 'script', or 'direct'
let ptyModule = null;

// Try node-pty packages (standard first, then Android-specific)
const ptyPackages = ['node-pty', '@mmmbuto/node-pty-android-arm64'];
for (const pkg of ptyPackages) {
  try {
    ptyModule = require(pkg);
    ptyMethod = 'node-pty';
    console.log(`[pty-manager] Using ${pkg}`);
    break;
  } catch (e) {
    // Continue to next package
  }
}

if (ptyMethod !== 'node-pty') {
  // Check if 'script' command is available (Unix only)
  if (os.platform() !== 'win32') {
    // Probe via `sh -c 'command -v'` rather than the `which` binary: Termux
    // ships no `which`, so spawnSync would fail with ENOENT (status null) and
    // silently drop to the no-PTY path even when `script` is installed.
    const result = spawnSync('sh', ['-c', 'command -v script'], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout.trim()) {
      ptyMethod = 'script';
      console.log('[pty-manager] Using script command for PTY');
    } else {
      console.log('[pty-manager] Using direct spawn (no PTY)');
    }
  } else {
    console.log('[pty-manager] Using direct spawn (Windows)');
  }
}

// Store active sessions
const sessions = new Map();

// Default shell
const defaultShell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');

// --- tmux durability layer -------------------------------------------------
// Run coding tools inside a detached tmux session so they SURVIVE a nomacode
// server restart instead of being SIGHUP-killed when the node process that
// owns their PTY dies. The tmux server is a separate daemon (not a child of
// node), so when we restart, the tool keeps running and can either be
// reattached (reviveSessions) or exit cleanly on its own (writing its
// /resume summary). Opt out with NOMACODE_NO_TMUX=1.
const fs = require('fs');
let TMUX_BIN = null;
try {
  if (spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status === 0) TMUX_BIN = 'tmux';
} catch (e) { /* no tmux available */ }

const USE_TMUX = !!TMUX_BIN && ptyMethod === 'node-pty' && process.env.NOMACODE_NO_TMUX !== '1';
const TMUX_CONF = path.join(os.homedir(), '.nomacode', 'tmux.conf');
// Dedicated, short, deterministic socket so nomacode's tool sessions live on
// their own tmux server — isolated from any interactive tmux the user runs.
const TMUX_SOCK = 'nomacode';
// Global tmux args that must precede every tmux subcommand.
const TMUX_G = ['-L', TMUX_SOCK, '-f', TMUX_CONF];

if (USE_TMUX) {
  try {
    fs.mkdirSync(path.dirname(TMUX_CONF), { recursive: true });
    fs.writeFileSync(TMUX_CONF, [
      'set -g status off',            // no tmux chrome — give the tool the full screen
      'set -g prefix None',           // fully transparent: every key goes to the tool
      'set -g mouse off',
      'set -g history-limit 200000',
      'set -g window-size latest',    // follow the most-recently-active client size
      'setw -g aggressive-resize on',
      'set -sg escape-time 0',        // no ESC delay (claude/ink read ESC directly)
      'set -g destroy-unattached off',// keep the session alive while nomacode is gone
      'set -g default-terminal "xterm-256color"',
      'set -as terminal-features ",xterm-256color:RGB"',
      ''
    ].join('\n'));
    console.log(`[pty-manager] tmux durability ON (${TMUX_BIN}) — tool sessions survive restarts`);
  } catch (e) {
    console.log('[pty-manager] tmux conf write failed, tmux disabled:', e.message);
  }
}

function tmuxName(id) {
  return 'nc_' + String(id).replace(/[^A-Za-z0-9_-]/g, '');
}
function tmuxSessionExists(name) {
  if (!USE_TMUX) return false;
  try { return spawnSync('tmux', [...TMUX_G, 'has-session', '-t', '=' + name]).status === 0; }
  catch (e) { return false; }
}

function createSession(id, options = {}) {
  const {
    cwd = os.homedir(),
    tool = null,
    cols = 80,
    rows = 24,
    env = {},
    profileId = null
  } = options;

  // Determine command to run
  let command = defaultShell;
  let args = [];

  if (tool) {
    switch (tool) {
      case 'claude-code':
        command = 'claude';
        args = [];
        break;
      case 'opencode':
        command = 'opencode';
        args = [];
        break;
      case 'codex':
        command = 'codex';
        args = [];
        break;
      default:
        command = defaultShell;
        args = [];
    }
  }

  const processEnv = {
    ...process.env,
    ...env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    COLUMNS: String(cols),
    LINES: String(rows)
  };

  let proc;
  let session;

  if (ptyMethod === 'node-pty') {
    // Use node-pty for full PTY support
    let spawnCmd = command;
    let spawnArgs = args;
    let tmuxSessName = null;

    if (USE_TMUX && tool) {
      // Wrap the tool in a named tmux session. `-A` attaches to it if it
      // already exists (e.g. it survived a previous server restart) and
      // otherwise creates it running `inner`. Either way the tool lives in
      // the tmux server, not as a direct child of node.
      tmuxSessName = tmuxName(id);
      const inner = [command, ...args].join(' ');
      spawnCmd = 'tmux';
      // Pass per-session env explicitly with -e. The tmux SERVER is shared
      // across sessions and inherits its environment from whichever client
      // first started it, so profile credentials placed only in this client's
      // env would be ignored for every session after the first — a second
      // profile would silently run with the first profile's API key.
      const envArgs = [];
      for (const [k, v] of Object.entries(env || {})) {
        if (v !== undefined && v !== null) envArgs.push('-e', `${k}=${v}`);
      }
      spawnArgs = [...TMUX_G, 'new-session', '-A',
        '-s', tmuxSessName, '-c', cwd,
        '-x', String(cols), '-y', String(rows), ...envArgs, inner];
      // A stray $TMUX in the env would make tmux refuse to nest.
      delete processEnv.TMUX;
      delete processEnv.TMUX_PANE;
    }

    proc = ptyModule.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-256color',
      cols: cols,
      rows: rows,
      cwd: cwd,
      env: processEnv
    });

    session = {
      id,
      pty: proc,
      pid: proc.pid,
      tool,
      cwd,
      profileId,
      status: 'running',
      createdAt: new Date().toISOString(),
      buffer: '',
      outputHandler: null,
      exitHandler: null,
      ptyMethod: 'node-pty',
      tmuxName: tmuxSessName
    };

    proc.onData((data) => {
      session.buffer += data;
      if (session.buffer.length > 500000) {
        session.buffer = session.buffer.slice(-500000);
      }
      if (session.outputHandler) {
        session.outputHandler(data);
      }
    });

    proc.onExit(({ exitCode }) => {
      session.status = 'stopped';
      session.exitCode = exitCode;
      if (session.exitHandler) {
        session.exitHandler(exitCode);
      }
    });

  } else if (ptyMethod === 'script') {
    // Use 'script' command for pseudo-PTY
    const fullCmd = args.length > 0 ? `${command} ${args.join(' ')}` : command;
    proc = spawn('script', ['-q', '-c', fullCmd, '/dev/null'], {
      cwd: cwd,
      env: processEnv,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    session = createChildProcessSession(id, proc, tool, cwd, 'script', profileId);
    setupChildProcessHandlers(session);

  } else {
    // Direct spawn - no PTY, but always works
    proc = spawn(command, args, {
      cwd: cwd,
      env: processEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: os.platform() === 'win32'
    });

    session = createChildProcessSession(id, proc, tool, cwd, 'direct', profileId);
    setupChildProcessHandlers(session);
  }

  sessions.set(id, session);
  return session;
}

function createChildProcessSession(id, proc, tool, cwd, method, profileId) {
  return {
    id,
    pty: proc,
    pid: proc.pid,
    tool,
    cwd,
    profileId,
    status: 'running',
    createdAt: new Date().toISOString(),
    buffer: '',
    outputHandler: null,
    exitHandler: null,
    ptyMethod: method
  };
}

function setupChildProcessHandlers(session) {
  const proc = session.pty;

  // Handle stdout
  proc.stdout.on('data', (data) => {
    const str = data.toString();
    session.buffer += str;
    if (session.buffer.length > 500000) {
      session.buffer = session.buffer.slice(-500000);
    }
    if (session.outputHandler) {
      session.outputHandler(str);
    }
  });

  // Handle stderr
  proc.stderr.on('data', (data) => {
    const str = data.toString();
    session.buffer += str;
    if (session.buffer.length > 500000) {
      session.buffer = session.buffer.slice(-500000);
    }
    if (session.outputHandler) {
      session.outputHandler(str);
    }
  });

  // Handle exit
  proc.on('exit', (exitCode) => {
    session.status = 'stopped';
    session.exitCode = exitCode;
    if (session.exitHandler) {
      session.exitHandler(exitCode);
    }
  });

  proc.on('error', (err) => {
    console.error('[pty-manager] Process error:', err.message);
    session.status = 'stopped';
    session.exitCode = 1;
    if (session.exitHandler) {
      session.exitHandler(1);
    }
  });
}

function getSession(id) {
  return sessions.get(id);
}

function getAllSessions() {
  const result = [];
  sessions.forEach((session) => {
    result.push({
      id: session.id,
      pid: session.pid,
      tool: session.tool,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt,
      exitCode: session.exitCode,
      ptyMethod: session.ptyMethod
    });
  });
  return result;
}

function writeToSession(id, data) {
  const session = sessions.get(id);
  if (session && session.pty && session.status === 'running') {
    if (session.ptyMethod === 'node-pty') {
      session.pty.write(data);
    } else {
      session.pty.stdin.write(data);
    }
    return true;
  }
  return false;
}

function resizeSession(id, cols, rows) {
  const session = sessions.get(id);
  if (session && session.pty && session.status === 'running') {
    if (session.ptyMethod === 'node-pty') {
      session.pty.resize(cols, rows);
    }
    // For other methods, resize is not supported
    return true;
  }
  return false;
}

function killSession(id) {
  const session = sessions.get(id);
  if (session) {
    // Explicit user-requested kill: actually terminate the tool. Tear down the
    // tmux session first so the process inside it dies too, not just our client.
    if (session.tmuxName && USE_TMUX) {
      try { spawnSync('tmux', [...TMUX_G, 'kill-session', '-t', '=' + session.tmuxName]); } catch (e) {}
    }
    if (session.pty && session.status === 'running') {
      if (session.ptyMethod === 'node-pty') {
        session.pty.kill();
      } else {
        session.pty.kill('SIGTERM');
      }
    }
    sessions.delete(id);
    return true;
  }
  return false;
}

function killAllSessions() {
  // Called on server shutdown/restart. For tmux-backed tool sessions we must
  // NOT kill the tool — only drop our PTY client (a detach). The tmux server
  // keeps the tool alive so it can be reattached on next start (reviveSessions)
  // or exit cleanly on its own. This is the whole point of the tmux layer:
  // restarting nomacode no longer SIGHUP-kills the running claude session.
  sessions.forEach((session) => {
    if (session.pty && session.status === 'running') {
      if (session.tmuxName && USE_TMUX) {
        try { session.pty.kill(); } catch (e) {} // detach only, tmux session lives on
      } else if (session.ptyMethod === 'node-pty') {
        session.pty.kill();
      } else {
        session.pty.kill('SIGTERM');
      }
    }
  });
  sessions.clear();
}

// Reattach to tmux tool-sessions that outlived a previous server process.
// Call this once at startup so surviving sessions reappear in the UI and the
// browser can reconnect to them by id.
function reviveSessions() {
  if (!USE_TMUX) return [];
  let out;
  try {
    const r = spawnSync('tmux',
      [...TMUX_G, 'list-sessions', '-F', '#{session_name}\t#{pane_current_path}'],
      { encoding: 'utf8' });
    if (r.status !== 0 || !r.stdout) return [];
    out = r.stdout;
  } catch (e) { return []; }

  const revived = [];
  out.split('\n').map((s) => s.trim()).filter(Boolean).forEach((line) => {
    const [name, panePath] = line.split('\t');
    if (!name || !name.startsWith('nc_')) return;
    const id = name.slice(3);
    if (sessions.has(id)) return;
    try {
      // createSession() with a matching id re-runs `tmux new-session -A`, which
      // reattaches to the existing session without starting a second tool.
      createSession(id, {
        tool: 'claude-code',
        cwd: panePath || os.homedir(),
        cols: 80,
        rows: 24
      });
      revived.push(id);
    } catch (e) {
      console.error('[pty-manager] revive failed for', name, '-', e.message);
    }
  });
  if (revived.length) {
    console.log(`[pty-manager] revived ${revived.length} tmux session(s): ${revived.join(', ')}`);
  }
  return revived;
}

function getPtyMethod() {
  return ptyMethod;
}

module.exports = {
  createSession,
  getSession,
  getAllSessions,
  writeToSession,
  resizeSession,
  killSession,
  killAllSessions,
  reviveSessions,
  getPtyMethod
};
