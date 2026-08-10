const express = require('express');
const http = require('http');
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
const PORT = process.env.PORT || 3000;

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

// Start server - bind to localhost only for security
server.listen(PORT, '127.0.0.1', () => {
  console.log(`
┌─────────────────────────────────────────┐
│         📱 Nomacode v${version.padEnd(19)}│
├─────────────────────────────────────────┤
│                                         │
│  Server running at:                     │
│  http://localhost:${PORT.toString().padEnd(5)}                │
│                                         │
│  Tip: Add to Home Screen for PWA        │
│                                         │
│  Press Ctrl+C to stop                   │
│                                         │
└─────────────────────────────────────────┘
`);

  // Auto-open browser if enabled
  if (process.env.AUTO_OPEN === '1') {
    setTimeout(() => openBrowser(`http://localhost:${PORT}`), 500);
  }
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
