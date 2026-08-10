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

function createSession(id, options = {}) {
  const {
    cwd = os.homedir(),
    tool = null,
    cols = 80,
    rows = 24,
    env = {}
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
    proc = ptyModule.spawn(command, args, {
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
      status: 'running',
      createdAt: new Date().toISOString(),
      buffer: '',
      outputHandler: null,
      exitHandler: null,
      ptyMethod: 'node-pty'
    };

    proc.onData((data) => {
      session.buffer += data;
      if (session.buffer.length > 50000) {
        session.buffer = session.buffer.slice(-50000);
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

    session = createChildProcessSession(id, proc, tool, cwd, 'script');
    setupChildProcessHandlers(session);

  } else {
    // Direct spawn - no PTY, but always works
    proc = spawn(command, args, {
      cwd: cwd,
      env: processEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: os.platform() === 'win32'
    });

    session = createChildProcessSession(id, proc, tool, cwd, 'direct');
    setupChildProcessHandlers(session);
  }

  sessions.set(id, session);
  return session;
}

function createChildProcessSession(id, proc, tool, cwd, method) {
  return {
    id,
    pty: proc,
    pid: proc.pid,
    tool,
    cwd,
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
    if (session.buffer.length > 50000) {
      session.buffer = session.buffer.slice(-50000);
    }
    if (session.outputHandler) {
      session.outputHandler(str);
    }
  });

  // Handle stderr
  proc.stderr.on('data', (data) => {
    const str = data.toString();
    session.buffer += str;
    if (session.buffer.length > 50000) {
      session.buffer = session.buffer.slice(-50000);
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
  sessions.forEach((session) => {
    if (session.pty && session.status === 'running') {
      if (session.ptyMethod === 'node-pty') {
        session.pty.kill();
      } else {
        session.pty.kill('SIGTERM');
      }
    }
  });
  sessions.clear();
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
  getPtyMethod
};
