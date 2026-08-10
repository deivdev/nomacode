const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const config = require('../services/config');

// Provider presets: maps provider to env var names
const PROVIDER_ENV = {
  anthropic: { apiKey: 'ANTHROPIC_API_KEY', baseUrl: 'ANTHROPIC_BASE_URL' },
  openai: { apiKey: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL' },
  custom: null
};

// Mask an API key for display: never reveal more than the last 4 chars, and
// keep short keys fully hidden so the masked form leaks no usable fraction.
function maskApiKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `••••${key.slice(-4)}`;
}

function maskProfile(profile) {
  return { ...profile, apiKey: maskApiKey(profile.apiKey) };
}

// List all profiles
router.get('/', (req, res) => {
  try {
    const cfg = config.get();
    // Return profiles without exposing full API keys
    const profiles = (cfg.profiles || []).map(maskProfile);
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create profile
router.post('/', (req, res) => {
  try {
    const { name, provider, apiKey, baseUrl, envKeyName, envUrlName } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!provider || !PROVIDER_ENV.hasOwnProperty(provider)) {
      return res.status(400).json({ error: 'Provider must be "anthropic", "openai", or "custom"' });
    }
    if (!apiKey || !apiKey.trim()) {
      return res.status(400).json({ error: 'API key is required' });
    }
    if (provider === 'custom' && !envKeyName) {
      return res.status(400).json({ error: 'Custom provider requires envKeyName' });
    }

    const profile = {
      id: uuidv4(),
      name: name.trim(),
      provider,
      apiKey: apiKey.trim(),
      baseUrl: baseUrl ? baseUrl.trim() : '',
      envKeyName: provider === 'custom' ? envKeyName.trim() : '',
      envUrlName: provider === 'custom' && envUrlName ? envUrlName.trim() : ''
    };

    const cfg = config.get();
    const profiles = cfg.profiles || [];
    profiles.push(profile);
    config.set({ profiles });

    res.status(201).json(maskProfile(profile));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update profile
router.put('/:id', (req, res) => {
  try {
    const cfg = config.get();
    const profiles = cfg.profiles || [];
    const idx = profiles.findIndex(p => p.id === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { name, provider, apiKey, baseUrl, envKeyName, envUrlName } = req.body;
    const existing = profiles[idx];

    if (provider !== undefined && !PROVIDER_ENV.hasOwnProperty(provider)) {
      return res.status(400).json({ error: 'Provider must be "anthropic", "openai", or "custom"' });
    }
    if (name !== undefined && !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (apiKey !== undefined && !apiKey.trim()) {
      return res.status(400).json({ error: 'API key cannot be empty' });
    }

    // Apply onto a copy so a validation failure leaves the stored profile untouched
    const updated = { ...existing };
    if (name !== undefined) updated.name = name.trim();
    if (provider !== undefined) updated.provider = provider;
    if (apiKey !== undefined) updated.apiKey = apiKey.trim();
    if (baseUrl !== undefined) updated.baseUrl = baseUrl.trim();
    if (envKeyName !== undefined) updated.envKeyName = envKeyName.trim();
    if (envUrlName !== undefined) updated.envUrlName = envUrlName.trim();

    // Validate the resulting shape, not just the incoming fields: switching to
    // "custom" without an envKeyName would silently inject no env vars at all.
    if (updated.provider === 'custom') {
      if (!updated.envKeyName) {
        return res.status(400).json({ error: 'Custom provider requires envKeyName' });
      }
    } else {
      // Preset providers derive env var names from the preset
      updated.envKeyName = '';
      updated.envUrlName = '';
    }

    profiles[idx] = updated;
    config.set({ profiles });

    res.json(maskProfile(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete profile
router.delete('/:id', (req, res) => {
  try {
    const cfg = config.get();
    const profiles = cfg.profiles || [];
    const idx = profiles.findIndex(p => p.id === req.params.id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    profiles.splice(idx, 1);
    config.set({ profiles });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve profile to env vars (internal use)
function resolveProfileEnv(profileId) {
  const cfg = config.get();
  const profile = (cfg.profiles || []).find(p => p.id === profileId);
  if (!profile) return null;

  const env = {};
  const preset = PROVIDER_ENV[profile.provider];

  if (preset) {
    env[preset.apiKey] = profile.apiKey;
    if (profile.baseUrl) env[preset.baseUrl] = profile.baseUrl;
  } else {
    // Custom provider
    if (profile.envKeyName) env[profile.envKeyName] = profile.apiKey;
    if (profile.envUrlName && profile.baseUrl) env[profile.envUrlName] = profile.baseUrl;
  }

  return env;
}

module.exports = router;
module.exports.resolveProfileEnv = resolveProfileEnv;
