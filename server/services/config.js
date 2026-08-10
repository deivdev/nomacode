const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.nomacode');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const REPOS_DIR = path.join(CONFIG_DIR, 'repos');

const defaultConfig = {
  theme: 'dark',
  defaultTool: 'claude-code',
  terminal: {
    fontSize: 14,
    fontFamily: 'monospace'
  },
  profiles: [],
  repos: []
};

let config = null;

function init() {
  // Create config directory if it doesn't exist
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Create repos directory if it doesn't exist
  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }

  // Load or create config file
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      config = { ...defaultConfig, ...JSON.parse(data) };
    } catch (err) {
      console.error('Error reading config file, using defaults:', err.message);
      config = { ...defaultConfig };
    }
  } else {
    config = { ...defaultConfig };
    save();
  }

  return config;
}

function get() {
  if (!config) {
    init();
  }
  return config;
}

function set(newConfig) {
  config = { ...config, ...newConfig };
  save();
  return config;
}

function save() {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
    // writeFileSync only applies `mode` when creating the file, so configs
    // written before profiles existed keep their old, possibly world-readable
    // permissions. The file now holds API keys, so enforce 0600 every save.
    fs.chmodSync(CONFIG_FILE, 0o600);
  } catch (err) {
    console.error('Error saving config file:', err.message);
  }
}

function getReposDir() {
  return REPOS_DIR;
}

function getConfigDir() {
  return CONFIG_DIR;
}

module.exports = {
  init,
  get,
  set,
  save,
  getReposDir,
  getConfigDir
};
