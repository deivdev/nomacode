const express = require('express');
const http = require('http');
const net = require('net');
const path = require('path');
const { exec } = require('child_process');
const { setupWebSocket, broadcastOpenUrl } = require('./websocket');
const reposApi = require('./api/repos');
const sessionsApi = require('./api/sessions');
const settingsApi = require('./api/settings');
const toolsApi = require('./api/tools');
const authApi = require('./api/auth');
const profilesApi = require('./api/profiles');
const config = require('./services/config');
const { version } = require('../package.json');

const app = express();
const server = http.createServer(app);
// process.env.PORT is a string (set by bin/nomacode.js); coerce to a number so
// the busy-port retry does `port + 1` arithmetic, not string concatenation.
const PORT = parseInt(process.env.PORT, 10) || 3000;

// Initialize config
config.init();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// API Routes
app.use('/api/repos', reposApi);
app.use('/api/sessions', sessionsApi);
app.use('/api/settings', settingsApi);
app.use('/api/tools', toolsApi);
app.use('/api/auth', authApi);
app.use('/api/profiles', profilesApi);

// Open URL endpoint - called by browser helper script in sessions
app.post('/api/open-url', (req, res) => {
  const { url } = req.body;
  if (url) {
    broadcastOpenUrl(url);
    res.json({ status: 'ok' });
  } else {
    res.status(400).json({ error: 'Missing url' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  const { getPtyMethod } = require('./services/pty-manager');
  res.json({ status: 'ok', version, pty: getPtyMethod() });
});

// Setup WebSocket for terminal I/O
setupWebSocket(server);

// Auto-open browser (Termux/Android)
function openBrowser(url) {
  const commands = [
    `termux-open-url ${url}`,           // Termux API
    `am start -a android.intent.action.VIEW -d ${url}`,  // Android fallback
    `xdg-open ${url}`,                  // Linux
    `open ${url}`                       // macOS
  ];

  function tryNext(i) {
    if (i >= commands.length) return;
    exec(commands[i], (err) => {
      if (err) tryNext(i + 1);
    });
  }
  tryNext(0);
}

// Find the first free port starting from `startPort`. Uses a throwaway net
// server so we never retry listen() on the real http server — re-listening the
// same http.Server after EADDRINUSE fires spurious 'listening' callbacks.
function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[index] Port ${startPort} is already in use, trying ${startPort + 1}...`);
        probe.close();
        resolve(findFreePort(startPort + 1));
      } else {
        reject(err);
      }
    });
    probe.listen(startPort, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

// Start server - bind to localhost only for security. If the requested port
// is busy, bind to the next free port instead of crashing (EADDRINUSE).
findFreePort(PORT).then((port) => {
  process.env.PORT = String(port);
  server.listen(port, '127.0.0.1', () => {
    console.log(`
┌─────────────────────────────────────────┐
│         📱 Nomacode v${version.padEnd(19)}│
├─────────────────────────────────────────┤
│                                         │
│  Server running at:                     │
│  http://localhost:${String(port).padEnd(5)}                │
│                                         │
│  Tip: Add to Home Screen for PWA        │
│                                         │
│  Press Ctrl+C to stop                   │
│                                         │
└─────────────────────────────────────────┘
`);

    // Reattach to any tool sessions that survived a previous server restart
    // (tmux durability layer in pty-manager). Best-effort; never blocks startup.
    try {
      require('./services/pty-manager').reviveSessions();
    } catch (e) {
      console.error('[index] reviveSessions failed:', e.message);
    }

    // Auto-open browser if enabled
    if (process.env.AUTO_OPEN === '1') {
      setTimeout(() => openBrowser(`http://localhost:${port}`), 500);
    }
  });
}).catch((err) => {
  console.error('[index] Failed to bind a port:', err.message);
  process.exit(1);
});

// Graceful shutdown
let isShuttingDown = false;

function shutdown() {
  if (isShuttingDown) {
    console.log('Force exit...');
    process.exit(1);
  }

  isShuttingDown = true;
  console.log('\nShutting down...');

  const { killAllSessions } = require('./services/pty-manager');
  killAllSessions();

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });

  // Force exit after 3 seconds if graceful shutdown fails
  setTimeout(() => {
    console.log('Force exit (timeout)');
    process.exit(1);
  }, 3000);
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
