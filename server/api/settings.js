const express = require('express');
const router = express.Router();
const config = require('../services/config');

// Get settings
router.get('/', (req, res) => {
  try {
    const cfg = config.get();
    // Return settings without repos (those have their own endpoint)
    const { repos, ...settings } = cfg;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update settings
router.put('/', (req, res) => {
  try {
    const { theme, defaultTool, terminal } = req.body;
    const updates = {};

    if (theme !== undefined) {
      if (!['dark', 'light'].includes(theme)) {
        return res.status(400).json({ error: 'Theme must be "dark" or "light"' });
      }
      updates.theme = theme;
    }

    if (defaultTool !== undefined) {
      if (!['claude-code', 'opencode', 'bash'].includes(defaultTool)) {
        return res.status(400).json({
          error: 'defaultTool must be "claude-code", "opencode", or "bash"'
        });
      }
      updates.defaultTool = defaultTool;
    }

    if (terminal !== undefined) {
      const terminalUpdates = {};
      if (terminal.fontSize !== undefined) {
        const fontSize = parseInt(terminal.fontSize, 10);
        if (isNaN(fontSize) || fontSize < 8 || fontSize > 32) {
          return res.status(400).json({ error: 'fontSize must be between 8 and 32' });
        }
        terminalUpdates.fontSize = fontSize;
      }
      if (terminal.fontFamily !== undefined) {
        terminalUpdates.fontFamily = terminal.fontFamily;
      }
      if (Object.keys(terminalUpdates).length > 0) {
        const cfg = config.get();
        updates.terminal = { ...cfg.terminal, ...terminalUpdates };
      }
    }

    const newConfig = config.set(updates);
    const { repos, ...settings } = newConfig;
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
