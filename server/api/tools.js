const express = require('express');
const router = express.Router();
const { spawn } = require('child_process');
const toolDetector = require('../services/tool-detector');

// Track active installations
const activeInstalls = new Map();

// Get all tools with availability status
router.get('/', (req, res) => {
  try {
    const tools = toolDetector.detectTools();
    const defaultTool = toolDetector.getDefaultTool();
    res.json({
      ...tools,
      defaultTool
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check if specific tool is available
router.get('/:id', (req, res) => {
  try {
    const toolId = req.params.id;
    const available = toolDetector.isToolAvailable(toolId);
    const info = toolDetector.getToolInfo(toolId);

    if (!info) {
      return res.status(404).json({ error: 'Unknown tool' });
    }

    res.json({
      id: toolId,
      name: info.name,
      description: info.description,
      available,
      installCmd: info.installCmd
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Install a tool
router.post('/:id/install', (req, res) => {
  const toolId = req.params.id;
  const info = toolDetector.getToolInfo(toolId);

  if (!info) {
    return res.status(404).json({ error: 'Unknown tool' });
  }

  if (!info.installCmd && !info.installScript) {
    return res.status(400).json({ error: 'Tool cannot be installed' });
  }

  if (toolDetector.isToolAvailable(toolId)) {
    return res.status(400).json({ error: 'Tool is already installed' });
  }

  if (activeInstalls.has(toolId)) {
    return res.status(409).json({ error: 'Installation already in progress' });
  }

  // Multi-step installs (download, dpkg, dependency) need a shell; simple
  // ones stay argv-style so no shell parsing is involved. Both come from the
  // TOOLS table in tool-detector.js, never from user input.
  const useScript = !!info.installScript;
  const cmd = useScript ? 'sh' : info.installCmd.split(' ')[0];
  const args = useScript
    ? ['-c', info.installScript]
    : info.installCmd.split(' ').slice(1);
  const displayCmd = useScript ? 'OpenCode (Termux aarch64 build)' : info.installCmd;

  // Set up SSE for streaming output
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  sendEvent('start', { tool: toolId, command: displayCmd });

  const proc = spawn(cmd, args, {
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  activeInstalls.set(toolId, proc);

  proc.stdout.on('data', (data) => {
    sendEvent('output', data.toString());
  });

  proc.stderr.on('data', (data) => {
    sendEvent('output', data.toString());
  });

  proc.on('error', (err) => {
    sendEvent('error', err.message);
    activeInstalls.delete(toolId);
    res.end();
  });

  proc.on('close', (code) => {
    activeInstalls.delete(toolId);
    // Clear tool cache to refresh availability
    toolDetector.clearCache();

    if (code === 0) {
      sendEvent('complete', { success: true, tool: toolId });
    } else {
      sendEvent('complete', { success: false, code, tool: toolId });
    }
    res.end();
  });

  // Handle client disconnect
  req.on('close', () => {
    if (activeInstalls.has(toolId)) {
      // Don't kill - let install continue in background
      activeInstalls.delete(toolId);
    }
  });
});

// Get installation status
router.get('/:id/install', (req, res) => {
  const toolId = req.params.id;
  const installing = activeInstalls.has(toolId);
  res.json({ installing });
});

module.exports = router;
