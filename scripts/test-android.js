#!/usr/bin/env node

// Smoke test for Nomacode on Android (Termux).
//
// Verifies, end to end over the real HTTP + WebSocket protocol:
//   1. The server is up and the PTY backend is usable (node-pty preferred).
//   2. claude-code and opencode are installed and detected by /api/tools.
//   3. A real terminal session boots, renders output, and exits cleanly for:
//      - a plain shell baseline (echo round-trip through the PTY)
//      - claude-code
//      - opencode
//
// Usage (server must already be running):
//   node scripts/test-android.js
//   NOMACODE_URL=http://127.0.0.1:8080 node scripts/test-android.js
//
// Exit code is 0 only if everything passes.

const http = require('http');
const WebSocket = require('ws');

const BASE_URL = new URL(process.env.NOMACODE_URL || 'http://127.0.0.1:3000');
const WS_URL = `${BASE_URL.protocol === 'https:' ? 'wss' : 'ws'}://${BASE_URL.host}`;

const FIRST_OUTPUT_MS = 25000;
const EXIT_GRACE_MS = 8000;

let passed = 0;
let failed = 0;

function log(ok, label, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? passed++ : failed++;
}

function api(path, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: BASE_URL.hostname,
      port: BASE_URL.port,
      path,
      method,
      headers: data
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        : {},
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json = raw;
        try { json = JSON.parse(raw); } catch { /* keep raw string */ }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, timeoutMs) => {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < timeoutMs) await sleep(250);
  return cond();
};

// Exercise a terminal session end to end.
// mode 'shell': echo marker round-trip, then `exit`.
// mode 'tool':  wait for any rendered output, then `/exit`.
async function testSession(label, tool, mode) {
  console.log(`\n  → ${label}`);
  let ws = null;
  let sessionId = null;
  let output = '';
  let exited = false;
  let exitCode = null;
  let socketError = null;

  const created = await api('/api/sessions', { method: 'POST', body: { tool, cols: 80, rows: 24 } });
  if (created.status !== 201) {
    log(false, `${label} create session`, `HTTP ${created.status}: ${JSON.stringify(created.body).slice(0, 160)}`);
    return;
  }
  sessionId = created.body.id;
  log(true, `${label} create session`, `id=${sessionId.slice(0, 8)} pid=${created.body.pid}`);

  try {
    ws = new WebSocket(WS_URL);
    ws.on('error', (e) => (socketError = e.message));
    await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });

    ws.on('message', (d) => {
      let m;
      try { m = JSON.parse(d.toString()); } catch { return; }
      if (m.type === 'output') output += m.data || '';
      if (m.type === 'exit') { exited = true; exitCode = m.code; }
    });

    ws.send(JSON.stringify({ type: 'attach', sessionId }));

    if (mode === 'shell') {
      const marker = `NC_OK_${Date.now()}`;
      ws.send(JSON.stringify({ type: 'input', sessionId, data: `echo ${marker}\r` }));
      const saw = await waitFor(() => output.includes(marker) || exited, FIRST_OUTPUT_MS);
      if (exited) {
        log(false, `${label} echo round-trip`, `process exited (code=${exitCode}) before echoing`);
      } else if (!saw) {
        log(false, `${label} echo round-trip`, `marker not seen within ${FIRST_OUTPUT_MS / 1000}s`);
      } else {
        log(true, `${label} echo round-trip`, 'PTY write + read OK');
      }
      ws.send(JSON.stringify({ type: 'input', sessionId, data: 'exit\r' }));
    } else {
      const alive = await waitFor(() => output.length > 0 || exited, FIRST_OUTPUT_MS);
      if (exited) {
        log(false, `${label} first output`, `process exited (code=${exitCode}) before producing output. Last output: ${JSON.stringify(output.slice(-200))}`);
      } else if (!alive) {
        log(false, `${label} first output`, `no output within ${FIRST_OUTPUT_MS / 1000}s`);
      } else {
        log(true, `${label} first output`, `${output.length} bytes rendered`);
      }
      // TUIs quit with Ctrl+C, not /exit. Try once; if it only cancelled a
      // command, a second Ctrl+C quits from the empty prompt.
      ws.send(JSON.stringify({ type: 'input', sessionId, data: '\x03' }));
      await waitFor(() => exited, EXIT_GRACE_MS);
      if (!exited) {
        ws.send(JSON.stringify({ type: 'input', sessionId, data: '\x03' }));
      }
    }

    const clean = await waitFor(() => exited, EXIT_GRACE_MS);
    log(clean, `${label} clean exit`, clean ? `code=${exitCode}` : `no exit within ${EXIT_GRACE_MS / 1000}s, killing`);
    if (socketError) log(false, `${label} socket`, socketError);
  } catch (e) {
    log(false, `${label} websocket`, e.message);
  } finally {
    if (sessionId) {
      try { await api(`/api/sessions/${sessionId}`, { method: 'DELETE' }); } catch {}
    }
    if (ws) { try { ws.close(); } catch {} }
  }
}

async function main() {
  console.log('Nomacode Android smoke test');
  console.log(`Target: ${BASE_URL.href}\n`);

  let health;
  try {
    health = await api('/api/health');
  } catch (e) {
    console.log(`  [FAIL] server unreachable at ${BASE_URL.href}: ${e.message}`);
    console.log('\nStart the server first, then re-run:');
    console.log('  npm start -- --no-open');
    process.exit(1);
  }

  if (health.status !== 200 || health.body.status !== 'ok') {
    log(false, 'health check', `HTTP ${health.status}: ${JSON.stringify(health.body).slice(0, 160)}`);
  } else {
    log(true, 'health check', `nomacode ${health.body.version}`);
    const pty = health.body.pty;
    if (pty === 'node-pty') {
      log(true, 'PTY backend', 'node-pty — full TTY');
    } else if (pty === 'script') {
      log(false, 'PTY backend', 'script fallback — works but no true TTY (arrows/editors may glitch)');
    } else {
      log(false, 'PTY backend', `${pty} — no PTY at all, terminal will not render properly`);
    }
  }

  let tools = null;
  try {
    tools = (await api('/api/tools')).body;
  } catch (e) {
    log(false, 'tools detection', e.message);
  }
  if (tools && tools.available) {
    for (const id of ['claude-code', 'opencode']) {
      const t = [...(tools.available || []), ...(tools.unavailable || [])].find((x) => x.id === id);
      if (!t) {
        log(false, `${id} installed`, 'not reported by /api/tools');
      } else if (t.available) {
        log(true, `${id} installed`, t.name);
      } else {
        log(false, `${id} installed`, `not found — install via: ${t.installCmd || 'see /api/tools'}`);
      }
    }
  }

  await testSession('shell baseline', null, 'shell');

  const toolAvail = (tools && tools.available) ? tools.available.map((t) => t.id) : [];
  for (const tool of ['claude-code', 'opencode']) {
    if (toolAvail.includes(tool)) {
      await testSession(tool, tool, 'tool');
    } else {
      console.log(`\n  → ${tool}`);
      log(false, 'session test skipped', 'tool is not installed');
    }
  }

  console.log(`\n${'='.repeat(48)}`);
  console.log(`Result: ${failed === 0 ? 'ALL PASS' : `${failed} FAILED`} (${passed} passed, ${failed} failed)`);
  if (failed > 0) {
    console.log('\nTroubleshooting on the phone:');
    console.log('  - no PTY backend?  Check server startup logs for "Using ..." under [pty-manager]');
    console.log('  - tool not installed?  Run the install command shown above, then restart the server.');
    console.log('  - tool exits immediately?  Likely missing auth/login — configure it first.');
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
