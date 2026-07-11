const fs = require('fs');
const path = require('path');
const os = require('os');

// Claude Code stores one JSONL per conversation under
// ~/.claude/projects/<cwd-slug>/<sessionId>.jsonl . We surface these as
// "past conversations" so the UI can resume one with `claude --resume <id>`.
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

// Pull the light metadata we need without holding the whole file: the cwd and
// the first human message live near the top, so we can stop parsing early; the
// message count / last activity need a full line scan (cheap even for MBs).
function parseMeta(file) {
  let cwd = null, title = null, first = null, last = null, count = 0;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!cwd && typeof o.cwd === 'string') cwd = o.cwd;
    if (o.timestamp) { if (!first) first = o.timestamp; last = o.timestamp; }
    if (o.type === 'user' || o.type === 'assistant') count++;
    if (!title && o.type === 'user') {
      let c = o.message && o.message.content;
      if (Array.isArray(c)) {
        c = c.filter(p => p && p.type === 'text').map(p => p.text).join(' ');
      }
      if (typeof c === 'string') {
        const t = c.trim().replace(/\s+/g, ' ');
        // Skip slash-commands, tool caveats and other non-prose openers.
        if (t && !t.startsWith('<') && !t.startsWith('/')) title = t.slice(0, 120);
      }
    }
  }
  return { cwd, title, first, last, count };
}

// List past conversations, newest first. Skips stubs (< minMessages) and any
// ids in `excludeIds` (e.g. sessions that are currently live).
function listConversations({ limit = 60, minMessages = 2, excludeIds = [] } = {}) {
  const exclude = new Set(excludeIds);
  const out = [];
  let keys;
  try { keys = fs.readdirSync(PROJECTS_DIR); } catch { return out; }

  for (const key of keys) {
    const dir = path.join(PROJECTS_DIR, key);
    let files;
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const id = f.slice(0, -6); // strip ".jsonl"
      if (exclude.has(id)) continue;
      const full = path.join(dir, f);
      let stat, meta;
      try { stat = fs.statSync(full); } catch { continue; }
      try { meta = parseMeta(full); } catch { continue; }
      if (meta.count < minMessages) continue; // drop empty/aborted stubs
      // An untitled session with only a few events is a launch-and-exit stub
      // (e.g. opened then /exit) — not worth resuming.
      if (!meta.title && meta.count < 8) continue;
      out.push({
        id,
        projectKey: key,
        cwd: meta.cwd,
        title: meta.title || '(untitled)',
        messages: meta.count,
        mtime: stat.mtimeMs,
        lastActivity: meta.last,
        sizeKb: Math.round(stat.size / 1024)
      });
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out.slice(0, limit);
}

module.exports = { listConversations };
