#!/usr/bin/env node

const path = require('path');
const { exec } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
let port = 3000;
let autoOpen = true;
let portFlagged = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' || args[i] === '-p') {
    port = parseInt(args[i + 1], 10) || 3000;
    portFlagged = true;
    i++;
  }
  if (args[i] === '--no-open') {
    autoOpen = false;
  }
  if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Nomacode - Code anywhere, like a local

Usage: nomacode [options] [port]

Options:
  -p, --port <number>  Port to run the server on (default: 3000)
  --no-open            Don't auto-open browser
  -h, --help           Show this help message

Examples:
  nomacode                    # Start on default port 3000
  nomacode --port 8080        # Start on port 8080
  nomacode 8080               # Same as above (bare port number)
  nomacode --no-open          # Start without opening browser

Note: if the port is busy, the next free port is used automatically.
`);
    process.exit(0);
  }
}

// A bare numeric argument is also accepted as the port (npm eats -p, so
// `npm start 3001` is the reliable way to pass a port through npm).
if (!portFlagged) {
  const positional = args.find((a) => /^\d+$/.test(a));
  if (positional) {
    port = parseInt(positional, 10);
  }
}

// Set port in environment for server to use
process.env.PORT = port;
process.env.AUTO_OPEN = autoOpen ? '1' : '0';

// Start the server
require('../server/index.js');
