const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const ptyManager = require('../services/pty-manager');
const repoManager = require('../services/repo-manager');
const toolDetector = require('../services/tool-detector');
const { resolveProfileEnv } = require('./profiles');
const conversations = require('../services/conversations');

// List all sessions
router.get('/', (req, res) => {
  try {
    const sessions = ptyManager.getAllSessions();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List past Claude conversations (resumable via `claude --resume <id>`).
// Must be declared before GET '/:id' so it isn't swallowed as an id.
router.get('/conversations', (req, res) => {
  try {
    // Don't offer to resume a conversation that's already live in a session.
    const live = ptyManager.getAllSessions().map(s => s.id);
    res.json(conversations.listConversations({ excludeIds: live }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new session
router.post('/', (req, res) => {
  try {
    const { repoId, tool, cols, rows, profileId, resumeId, cwd: resumeCwd } = req.body;

    // Validate tool exists in our list (but skip slow availability re-check)
    // The frontend already shows only available tools, and if the tool
    // isn't actually working, the session will fail with a clear error
    if (tool && !toolDetector.getToolInfo(tool)) {
      return res.status(400).json({
        error: `Unknown tool "${tool}"`
      });
    }

    // Get working directory
    let cwd = require('os').homedir();
    let repoName = null;

    if (repoId) {
      const repo = repoManager.getRepo(repoId);
      if (!repo) {
        return res.status(404).json({ error: 'Repository not found' });
      }
      cwd = repo.path;
      repoName = repo.name;
      // Update last opened
      repoManager.updateRepo(repoId, { lastOpened: new Date().toISOString() });
    }

    // Resolve profile env vars
    let profileEnv = {};
    if (profileId) {
      profileEnv = resolveProfileEnv(profileId);
      if (!profileEnv) {
        return res.status(400).json({ error: 'Profile not found' });
      }
    }

    // Resuming a past Claude conversation: launch `claude --resume <id>` from
    // the conversation's original cwd (Claude keys history by cwd, so it must
    // match or the session won't be found).
    let extraArgs = null;
    if (resumeId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resumeId)) {
        return res.status(400).json({ error: 'Invalid resumeId' });
      }
      extraArgs = ['--resume', resumeId];
      if (typeof resumeCwd === 'string' && resumeCwd) cwd = resumeCwd;
    }

    // Create session
    const sessionId = uuidv4();
    const session = ptyManager.createSession(sessionId, {
      cwd: cwd,
      tool: tool || null,
      cols: cols || 80,
      rows: rows || 24,
      env: profileEnv,
      profileId: profileId || null,
      args: extraArgs
    });

    res.status(201).json({
      id: session.id,
      pid: session.pid,
      tool: session.tool,
      cwd: session.cwd,
      repoId: repoId || null,
      repoName: repoName,
      status: session.status,
      createdAt: session.createdAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get session info
router.get('/:id', (req, res) => {
  try {
    const session = ptyManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({
      id: session.id,
      pid: session.pid,
      tool: session.tool,
      cwd: session.cwd,
      status: session.status,
      createdAt: session.createdAt,
      exitCode: session.exitCode
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Kill session
router.delete('/:id', (req, res) => {
  try {
    const success = ptyManager.killSession(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restart session
router.post('/:id/restart', (req, res) => {
  try {
    const session = ptyManager.getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Kill old session and recreate with same settings
    const prevProfileId = session.profileId;
    ptyManager.killSession(req.params.id);

    // Profile may have been deleted since the session started; fall back to
    // system env rather than failing the restart.
    const restartEnv = (prevProfileId ? resolveProfileEnv(prevProfileId) : {}) || {};
    const newSession = ptyManager.createSession(req.params.id, {
      cwd: session.cwd,
      tool: session.tool,
      env: restartEnv,
      profileId: prevProfileId || null
    });

    res.json({
      id: newSession.id,
      pid: newSession.pid,
      tool: newSession.tool,
      cwd: newSession.cwd,
      status: newSession.status,
      createdAt: newSession.createdAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
