// Nomacode - Terminal-like UI

class Nomacode {
  constructor() {
    this.sessions = [];
    this.repos = [];
    this.activeSessionId = null;
    this.settings = null;
    this.tools = { available: [], unavailable: [], defaultTool: 'shell' };
    this.ws = null;
    this.terminals = new Map();
    this.paletteItems = [];
    this.paletteIndex = 0;
    this.serverOnline = false;
    this.retryCount = 0;
    this.maxRetries = 3;

    // Modifier keys state (toolbar toggles)
    this.modifiers = { ctrl: false, alt: false };
    // Physical keyboard shift state
    this.shiftHeld = false;


    // Claude Code mode tracking
    this.claudeMode = null;

    // API profiles
    this.profiles = [];

    // GitHub auth state
    this.githubAuth = { authenticated: false, username: null };
    this.deviceFlowPollInterval = null;
  }

  async init() {
    // Setup viewport handling for keyboard
    this.setupViewport();

    // Bind events early so UI is interactive during data loading
    this.bindEvents();

    // Check server connectivity first
    const online = await this.checkServer();

    if (!online) {
      this.showOfflineScreen();
      this.startServerCheck();
      return;
    }

    await this.loadSettings();
    await this.loadGitHubAuthStatus();
    await this.loadTools();
    await this.loadProfiles();
    await this.loadRepos();
    await this.loadSessions();

    this.connectWebSocket();
    this.updateUI();

    // Show welcome or restore session
    if (this.sessions.length > 0) {
      const running = this.sessions.find(s => s.status === 'running');
      if (running) {
        this.switchToSession(running.id);
      }
    } else {
      this.showWelcome();
    }
  }

  // ─── Viewport Handling (keyboard) ───────────────────────────

  setupViewport() {
    // Store initial viewport height to detect keyboard
    const initialHeight = window.innerHeight;
    const keyboardThreshold = 150; // Keyboard is ~150px+ tall

    const updateViewport = () => {
      const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--viewport-height', `${vh}px`);

      // Detect keyboard: viewport shrunk significantly
      const heightDiff = initialHeight - vh;
      const keyboardVisible = heightDiff > keyboardThreshold;

      // Toggle keyboard visibility class and toolbar
      const toolbar = document.getElementById('key-toolbar');
      if (keyboardVisible) {
        document.body.classList.add('keyboard-visible');
        toolbar?.classList.add('visible');
      } else {
        document.body.classList.remove('keyboard-visible');
        toolbar?.classList.remove('visible');
      }

      // Refit terminal when viewport changes
      if (this.activeSessionId) {
        const terminal = this.terminals.get(this.activeSessionId);
        if (terminal) {
          setTimeout(() => terminal.fitAddon.fit(), 50);
        }
      }
    };

    // Initial update
    updateViewport();

    // Listen for viewport changes (keyboard show/hide)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewport);
      window.visualViewport.addEventListener('scroll', updateViewport);
    }

    // Fallback for browsers without visualViewport
    window.addEventListener('resize', updateViewport);
  }

  // ─── Server Connectivity ───────────────────────────────────

  async checkServer() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const response = await fetch('/api/health', {
        signal: controller.signal,
        cache: 'no-store'
      });
      clearTimeout(timeout);

      this.serverOnline = response.ok;
      return this.serverOnline;
    } catch (e) {
      this.serverOnline = false;
      return false;
    }
  }

  startServerCheck() {
    // Check every 2 seconds for server availability
    this.serverCheckInterval = setInterval(async () => {
      const online = await this.checkServer();
      if (online) {
        clearInterval(this.serverCheckInterval);
        this.hideOfflineScreen();
        this.init();
      }
    }, 2000);
  }

  showOfflineScreen() {
    const existing = document.getElementById('offline-view');
    if (existing) return;

    // Update indicator to show offline
    this.serverOnline = false;
    this.updateConnectionIndicator();

    const isTermux = /Android/i.test(navigator.userAgent);
    const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                  window.navigator.standalone === true;

    const offlineView = document.createElement('div');
    offlineView.id = 'offline-view';
    offlineView.className = 'view active';
    offlineView.innerHTML = `
      <div class="offline-content">
        <div class="offline-icon">⚡</div>
        <h2 class="offline-title">Server Not Running</h2>
        <p class="offline-subtitle">The Nomacode server isn't reachable</p>

        <div class="offline-spinner">
          <div class="spinner"></div>
          <span>Checking for server...</span>
        </div>

        ${isTermux || isPWA ? `
        <div class="offline-instructions">
          <p class="instruction-title">To start the server:</p>
          <div class="instruction-steps">
            <div class="step">
              <span class="step-num">1</span>
              <span>Open <strong>Termux</strong> app</span>
            </div>
            <div class="step">
              <span class="step-num">2</span>
              <span>Run: <code>cd ~/nomacode && npm start</code></span>
            </div>
          </div>

          <div class="offline-tip">
            <strong>Tip:</strong> Set up auto-start with Termux:Boot
            <br><code>~/.termux/boot/nomacode</code>
          </div>
        </div>
        ` : `
        <div class="offline-instructions">
          <p class="instruction-title">Start the server:</p>
          <code class="instruction-code">npm start</code>
        </div>
        `}

        <button class="btn btn-primary offline-retry" onclick="app.retryConnection()">
          Retry Now
        </button>
      </div>
    `;

    // Hide other views
    document.getElementById('welcome-view')?.classList.add('hidden');
    document.getElementById('terminal-view')?.classList.add('hidden');

    document.getElementById('main-content').appendChild(offlineView);
  }

  hideOfflineScreen() {
    const offlineView = document.getElementById('offline-view');
    if (offlineView) {
      offlineView.remove();
    }

    // Update indicator to show online
    this.serverOnline = true;
    this.updateConnectionIndicator();
  }

  async retryConnection() {
    const btn = document.querySelector('.offline-retry');
    const spinner = document.querySelector('.offline-spinner span');

    if (btn) btn.disabled = true;
    if (spinner) spinner.textContent = 'Connecting...';

    const online = await this.checkServer();

    if (online) {
      clearInterval(this.serverCheckInterval);
      this.hideOfflineScreen();
      this.init();
    } else {
      if (btn) btn.disabled = false;
      if (spinner) spinner.textContent = 'Server not found. Retrying...';
    }
  }

  // ─── Data Loading ────────────────────────────────────────

  async loadSettings() {
    try {
      this.settings = await API.settings.get();
    } catch (e) {
      this.settings = { theme: 'dark', defaultTool: 'claude-code', terminal: { fontSize: 14 } };
    }
  }

  async loadRepos() {
    try {
      this.repos = await API.repos.list();
    } catch (e) {
      this.repos = [];
    }
  }

  async loadSessions() {
    try {
      this.sessions = await API.sessions.list();
    } catch (e) {
      this.sessions = [];
    }
  }

  async loadTools() {
    try {
      this.tools = await API.tools.list();
    } catch (e) {
      this.tools = { available: [{ id: 'shell', name: 'Bash Shell' }], unavailable: [], defaultTool: 'shell' };
    }
  }

  async loadProfiles() {
    try {
      this.profiles = await API.profiles.list();
    } catch (e) {
      this.profiles = [];
    }
  }

  // ─── WebSocket ───────────────────────────────────────────

  connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${location.host}`);

    this.ws.onopen = () => {
      this.serverOnline = true;
      this.updateConnectionIndicator();
      if (this.activeSessionId) {
        this.attachToSession(this.activeSessionId);
      }
    };

    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      this.handleWsMessage(msg);
    };

    this.ws.onclose = () => {
      this.serverOnline = false;
      this.updateConnectionIndicator();
      setTimeout(() => this.connectWebSocket(), 2000);
    };
  }

  updateConnectionIndicator() {
    const indicator = document.getElementById('session-indicator');
    if (!indicator) return;

    if (!this.serverOnline) {
      indicator.className = 'indicator stopped';
      indicator.title = 'Server offline';
    } else {
      const active = this.sessions.find(s => s.id === this.activeSessionId);
      indicator.className = 'indicator' + (active?.status === 'stopped' ? ' stopped' : '');
      indicator.title = active?.status === 'stopped' ? 'Session stopped' : 'Connected';
    }
  }

  handleWsMessage(msg) {
    const terminal = this.terminals.get(msg.sessionId);

    switch (msg.type) {
      case 'output':
        if (terminal) {
          terminal.term.write(msg.data);
          // Detect Claude Code mode from output
          if (msg.sessionId === this.activeSessionId) {
            this.detectClaudeMode(msg.data);
          }
          this.detectOutputUrl(msg.data);
        }
        break;
      case 'exit':
        if (terminal) {
          terminal.term.write(`\r\n\x1b[33m[exited: ${msg.code}]\x1b[0m\r\n`);
        }
        const session = this.sessions.find(s => s.id === msg.sessionId);
        if (session) {
          session.status = 'stopped';
          this.renderTabs();
          this.updateStatusBar();
        }
        break;
      case 'error':
        this.toast(msg.message, 'error');
        break;
      case 'open-url':
        if (msg.url) {
          window.open(msg.url, '_blank');
        }
        break;
    }
  }

  attachToSession(sessionId) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'attach', sessionId }));
    }
  }

  sendInput(sessionId, data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'input', sessionId, data }));
    }
  }

  sendResize(sessionId, cols, rows) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resize', sessionId, cols, rows }));
    }
  }

  // ─── Terminal Management ─────────────────────────────────

  createTerminal(sessionId) {
    const container = document.getElementById('terminal-container');
    const termView = document.getElementById('terminal-view');
    console.log('terminal-view classes:', termView?.className);
    console.log('terminal-view dimensions:', termView?.offsetWidth, 'x', termView?.offsetHeight);
    console.log('Container dimensions:', container?.offsetWidth, 'x', container?.offsetHeight);

    // Hide all terminals
    this.terminals.forEach(t => t.wrapper.classList.remove('active'));

    // Create wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'terminal-wrapper active';
    wrapper.id = `term-${sessionId}`;
    container.appendChild(wrapper);

    // Log after append
    setTimeout(() => {
      console.log('Wrapper dimensions after append:', wrapper.offsetWidth, 'x', wrapper.offsetHeight);
    }, 50);

    // Create xterm
    const term = new Terminal({
      cursorBlink: true,
      fontSize: this.settings?.terminal?.fontSize || 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        cursorAccent: '#0d1117',
        selection: 'rgba(88, 166, 255, 0.3)',
        black: '#484f58',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#a371f7',
        cyan: '#39c5cf',
        white: '#b1bac4',
        brightBlack: '#6e7681',
        brightRed: '#ffa198',
        brightGreen: '#56d364',
        brightYellow: '#e3b341',
        brightBlue: '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan: '#56d4dd',
        brightWhite: '#f0f6fc'
      },
      allowProposedApi: true
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    // Web links addon - makes URLs clickable (opens in browser on tap)
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(webLinksAddon);

    term.open(wrapper);
    fitAddon.fit();

    // Capture Shift shortcuts before terminal processes them
    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true;

      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Shift+N: New session
        if (e.key === 'N') {
          e.preventDefault();
          this.showNewSessionModal();
          return false;
        }
        // Shift+C: Clone repository
        if (e.key === 'C') {
          e.preventDefault();
          this.showCloneModal();
          return false;
        }
        // Shift+W: Close session
        if (e.key === 'W') {
          e.preventDefault();
          if (this.activeSessionId) this.closeSession(this.activeSessionId);
          return false;
        }
        // Shift+K: Command palette
        if (e.key === 'K') {
          e.preventDefault();
          this.showPalette();
          return false;
        }
        // Shift+O: Open repository
        if (e.key === 'O') {
          e.preventDefault();
          this.showOpenRepoModal();
          return false;
        }
        // Shift+1-9: Jump to session by number
        const digitMatch = e.code.match(/^Digit([1-9])$/);
        if (digitMatch) {
          e.preventDefault();
          const idx = parseInt(digitMatch[1]) - 1;
          if (this.sessions[idx]) this.switchToSession(this.sessions[idx].id);
          return false;
        }
      }
      return true;
    });

    // Handle input
    term.onData(data => this.sendInput(sessionId, data));

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (wrapper.classList.contains('active')) {
        fitAddon.fit();
        this.sendResize(sessionId, term.cols, term.rows);
      }
    });
    resizeObserver.observe(wrapper);

    this.terminals.set(sessionId, { term, fitAddon, wrapper, resizeObserver });

    // Attach and focus
    this.attachToSession(sessionId);
    setTimeout(() => {
      fitAddon.fit();
      term.focus();
      this.sendResize(sessionId, term.cols, term.rows);
    }, 100);
  }

  showTerminal(sessionId) {
    this.terminals.forEach(t => t.wrapper.classList.remove('active'));
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.wrapper.classList.add('active');
      // Re-attach to WebSocket session for this terminal
      this.attachToSession(sessionId);
      setTimeout(() => {
        terminal.fitAddon.fit();
        terminal.term.focus();
      }, 50);
    }
  }

  destroyTerminal(sessionId) {
    const terminal = this.terminals.get(sessionId);
    if (terminal) {
      terminal.resizeObserver.disconnect();
      terminal.term.dispose();
      terminal.wrapper.remove();
      this.terminals.delete(sessionId);
    }
  }

  // ─── Session Management ──────────────────────────────────

  async createSession(repoId = null, tool = null, profileId = null) {
    try {
      tool = tool || this.settings?.defaultTool || 'claude-code';
      console.log('Creating session:', { repoId, tool, profileId });
      const session = await API.sessions.create(repoId, tool, 80, 24, profileId);
      console.log('Session created:', session);
      this.sessions.push(session);
      this.switchToSession(session.id);
      this.toast(`Started ${session.tool || 'shell'}`, 'success');
    } catch (e) {
      console.error('Session creation error:', e);
      this.toast(e.message, 'error');
    }
  }

  switchToSession(sessionId) {
    console.log('switchToSession:', sessionId);
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      console.error('Session not found:', sessionId);
      return;
    }

    this.activeSessionId = sessionId;
    // Reset mode when switching sessions
    this.claudeMode = null;
    this.updateClaudeModeDisplay();
    console.log('Showing terminal view');
    this.showView('terminal');

    if (!this.terminals.has(sessionId)) {
      console.log('Creating terminal for session');
      this.createTerminal(sessionId);
    } else {
      console.log('Showing existing terminal');
      this.showTerminal(sessionId);
    }

    this.renderTabs();
    this.updateStatusBar();
  }

  async closeSession(sessionId) {
    try {
      await API.sessions.delete(sessionId);
      this.destroyTerminal(sessionId);
      this.sessions = this.sessions.filter(s => s.id !== sessionId);

      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null;
        if (this.sessions.length > 0) {
          this.switchToSession(this.sessions[0].id);
        } else {
          this.showWelcome();
        }
      }

      this.renderTabs();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  nextSession() {
    if (this.sessions.length < 2) return;
    const idx = this.sessions.findIndex(s => s.id === this.activeSessionId);
    const next = this.sessions[(idx + 1) % this.sessions.length];
    this.switchToSession(next.id);
  }

  prevSession() {
    if (this.sessions.length < 2) return;
    const idx = this.sessions.findIndex(s => s.id === this.activeSessionId);
    const prev = this.sessions[(idx - 1 + this.sessions.length) % this.sessions.length];
    this.switchToSession(prev.id);
  }

  // ─── Repository Management ───────────────────────────────

  async cloneRepo(url, name, username, token) {
    try {
      await API.repos.clone(url, name, username, token);
      await this.loadRepos();
      this.toast(`Cloned ${name}`, 'success');
      this.updateRecentRepos();
      return true;
    } catch (e) {
      this.toast(e.message, 'error');
      return false;
    }
  }

  async deleteRepo(id) {
    try {
      const repo = this.repos.find(r => r.id === id);
      await API.repos.delete(id);
      await this.loadRepos();
      this.toast(`Deleted ${repo?.name}`, 'success');
      this.updateRecentRepos();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  // ─── UI Updates ──────────────────────────────────────────

  updateUI() {
    this.renderTabs();
    this.updateRecentRepos();
    this.updateStatusBar();
  }

  renderTabs() {
    const tabs = document.getElementById('tabs');
    tabs.innerHTML = this.sessions.map((s, i) => {
      const active = s.id === this.activeSessionId ? 'active' : '';
      const label = s.repoName || s.tool || 'shell';
      return `
        <button class="tab ${active}" data-id="${s.id}">
          <span class="tab-index">${i + 1}</span>
          <span class="tab-label">${this.escapeHtml(label)}</span>
          <span class="tab-close" data-id="${s.id}">×</span>
        </button>
      `;
    }).join('');

    // Bind events
    tabs.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', e => {
        if (!e.target.classList.contains('tab-close')) {
          this.switchToSession(tab.dataset.id);
        }
      });
    });

    tabs.querySelectorAll('.tab-close').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.closeSession(btn.dataset.id);
      });
    });

    // Update indicator
    this.updateConnectionIndicator();

    // Compact logo only when tabs need space (after DOM updates)
    setTimeout(() => this.updateLogoCompact(), 10);
  }

  updateRecentRepos() {
    const section = document.getElementById('recent-repos');
    const list = document.getElementById('recent-list');

    if (this.repos.length === 0) {
      section.classList.add('hidden');
      return;
    }

    section.classList.remove('hidden');
    const recent = [...this.repos].sort((a, b) =>
      new Date(b.lastOpened || 0) - new Date(a.lastOpened || 0)
    ).slice(0, 5);

    list.innerHTML = recent.map(r => `
      <button class="recent-item" data-id="${r.id}">
        <span class="repo-icon">📁</span>
        <span class="repo-name">${this.escapeHtml(r.name)}</span>
      </button>
    `).join('');

    list.querySelectorAll('.recent-item').forEach(item => {
      item.addEventListener('click', () => {
        this.createSession(item.dataset.id);
      });
    });
  }

  updateStatusBar() {
    const session = this.sessions.find(s => s.id === this.activeSessionId);

    document.getElementById('status-tool').textContent = session?.tool || '';
    document.getElementById('status-cwd').textContent = session?.cwd ?
      session.cwd.replace(/^.*\//, '') : '~';
    document.getElementById('status-session').textContent = session ?
      `${this.sessions.indexOf(session) + 1}/${this.sessions.length}` : '';
  }

  detectClaudeMode(data) {
    // Strip ANSI escape codes for pattern matching
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').toLowerCase();

    // Detect mode changes from Claude Code status line.
    // Default is `undefined` = "this output chunk carries no mode info, leave
    // the current label alone". Using `null` here reset the label to NORMAL on
    // every unrelated redraw, so ACCEPT/PLAN flickered straight back to NORMAL.
    let newMode = undefined;

    // Check the exit markers FIRST: "plan mode off" and "exited plan mode"
    // both contain "plan mode", so an entry-first ordering claims them and the
    // label sticks on PLAN forever. No loose /plan.*mode/ regex either — it
    // matches ordinary prose like "I'll plan the refactor in normal mode",
    // and Claude's own output is echoed to the terminal.
    if (clean.includes('exited plan') || clean.includes('plan mode off') || clean.includes('accept edits off')) {
      newMode = null;
    } else if (clean.includes('plan mode on') || clean.includes('[plan]')) {
      newMode = 'PLAN';
    } else if (clean.includes('accept edits on') || clean.includes('autoaccept') || clean.includes('auto-accept') || clean.includes('[auto]')) {
      newMode = 'ACCEPT';
    }

    if (newMode !== undefined && newMode !== this.claudeMode) {
      this.claudeMode = newMode;
      this.updateClaudeModeDisplay();
    }
  }

  detectOutputUrl(data) {
    // Strip ANSI escape codes
    const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                       .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
                       .replace(/\x1b[()][0-9A-B]/g, '');

    // Buffer for handling URLs split across chunks
    this._urlBuffer = ((this._urlBuffer || '') + clean).slice(-2000);

    const urlRegex = /https?:\/\/[^\s"'<>\x00-\x1f\])}]+/g;
    let match;
    if (!this._shownUrls) this._shownUrls = new Set();

    while ((match = urlRegex.exec(this._urlBuffer)) !== null) {
      let url = match[0].replace(/[.,;:!?]+$/, '');
      if (this._shownUrls.has(url)) continue;

      // Only show banner for auth/login URLs to avoid noise
      if (/oauth|authorize|\/login|\/auth[\/?]|anthropic\.com|claude\.ai|\/device/i.test(url)) {
        this._shownUrls.add(url);
        this.showUrlBanner(url);
      }
    }
  }

  showUrlBanner(url) {
    // Remove existing banner
    const existing = document.getElementById('url-banner');
    if (existing) existing.remove();
    if (this._urlBannerTimer) clearTimeout(this._urlBannerTimer);

    const banner = document.createElement('div');
    banner.id = 'url-banner';
    banner.className = 'url-banner';

    const label = document.createElement('div');
    label.className = 'url-banner-label';
    label.textContent = 'Authentication link detected';

    const urlText = document.createElement('div');
    urlText.className = 'url-banner-url';
    urlText.textContent = url.length > 60 ? url.slice(0, 57) + '...' : url;

    const actions = document.createElement('div');
    actions.className = 'url-banner-actions';

    const openBtn = document.createElement('a');
    openBtn.href = url;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
    openBtn.className = 'url-banner-open';
    openBtn.textContent = 'Open in Browser';
    openBtn.addEventListener('click', () => {
      setTimeout(() => banner.remove(), 500);
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'url-banner-dismiss';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => banner.remove());

    actions.appendChild(openBtn);
    actions.appendChild(dismissBtn);
    banner.appendChild(label);
    banner.appendChild(urlText);
    banner.appendChild(actions);

    document.getElementById('app').appendChild(banner);

    this._urlBannerTimer = setTimeout(() => {
      if (banner.parentNode) banner.remove();
    }, 30000);
  }

  cycleMode() {
    // Actually cycle Claude Code's permission mode by sending a real
    // Shift+Tab (backtab, ESC[Z) to the PTY. The displayed label is driven
    // by parsing Claude's output in detectClaudeMode(), so we don't set it
    // optimistically here (doing so just fought the parser and flickered
    // back to NORMAL). This is also the only way to send Shift+Tab on mobile,
    // where there's no physical Shift key.
    const terminal = this.terminals.get(this.activeSessionId);
    if (!terminal) return;
    this.sendInput(this.activeSessionId, '\x1b[Z');
    terminal.term.focus();
  }

  updateLogoCompact() {
    const topbar = document.getElementById('topbar');
    const tabsContainer = document.getElementById('tabs-container');
    const tabs = document.getElementById('tabs');

    if (!tabsContainer || !tabs) return;

    // Check if tabs are overflowing their container
    const needsSpace = tabs.scrollWidth > tabsContainer.clientWidth - 50;
    topbar.classList.toggle('compact', needsSpace);
  }

  updateClaudeModeDisplay() {
    const modeEl = document.getElementById('status-mode');

    if (this.claudeMode) {
      modeEl.textContent = this.claudeMode;
      modeEl.className = this.claudeMode.toLowerCase();
    } else {
      modeEl.textContent = 'NORMAL';
      modeEl.className = '';
    }
  }

  // ─── Views ───────────────────────────────────────────────

  showView(name) {
    const terminalView = document.getElementById('terminal-view');
    const welcomeView = document.getElementById('welcome-view');

    if (name === 'terminal') {
      terminalView.classList.remove('hidden');
      terminalView.classList.add('active');
      welcomeView.classList.add('hidden');
      welcomeView.classList.remove('active');
    } else {
      welcomeView.classList.remove('hidden');
      welcomeView.classList.add('active');
      terminalView.classList.add('hidden');
      terminalView.classList.remove('active');
    }
  }

  showWelcome() {
    this.showView('welcome');
    this.activeSessionId = null;
    this.claudeMode = null;
    this.updateClaudeModeDisplay();
    this.renderTabs();
    this.updateStatusBar();
    this.updateRecentConversations();
  }

  // Populate the "Resume Conversation" list from past Claude sessions on disk.
  async updateRecentConversations() {
    const section = document.getElementById('recent-convos');
    const list = document.getElementById('convo-list');
    if (!section || !list) return;

    let convos = [];
    try { convos = await API.sessions.conversations(); } catch (e) { /* offline: hide */ }

    if (!convos.length) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');

    list.innerHTML = convos.slice(0, 8).map(c => `
      <button class="recent-item" data-id="${c.id}" data-cwd="${this.escapeHtml(c.cwd || '')}">
        <span class="repo-icon">💬</span>
        <span class="repo-name">${this.escapeHtml(c.title)}</span>
        <span class="convo-meta">${c.messages}</span>
      </button>
    `).join('');

    list.querySelectorAll('.recent-item').forEach(item => {
      item.addEventListener('click', () =>
        this.resumeConversation(item.dataset.id, item.dataset.cwd));
    });
  }

  // Resume a past conversation in a fresh session (`claude --resume <id>`).
  async resumeConversation(id, cwd) {
    try {
      const session = await API.sessions.resume(id, cwd);
      this.sessions.push(session);
      this.switchToSession(session.id);
      this.toast('Resuming conversation…', 'success');
    } catch (e) {
      console.error('Resume error:', e);
      this.toast(e.message, 'error');
    }
  }

  // ─── Command Palette ─────────────────────────────────────

  showPalette(items = null) {
    this.paletteItems = items || this.getDefaultCommands();
    this.paletteIndex = 0;

    const overlay = document.getElementById('palette-overlay');
    const input = document.getElementById('palette-input');
    const results = document.getElementById('palette-results');

    overlay.classList.remove('hidden');
    input.value = '';
    input.focus();

    this.renderPaletteResults();
  }

  hidePalette() {
    document.getElementById('palette-overlay').classList.add('hidden');
    // Refocus terminal
    const terminal = this.terminals.get(this.activeSessionId);
    if (terminal) terminal.term.focus();
  }

  getDefaultCommands() {
    const cmds = [
      { icon: '+', label: 'New session', hint: 'Ctrl+T', action: () => this.showNewSessionModal() },
      { icon: '📁', label: 'Clone repository', hint: 'Ctrl+Shift+C', action: () => this.showCloneModal() },
      { icon: '🗑', label: 'Delete repository', action: () => this.showDeleteRepoModal() },
      { icon: '⚙', label: 'Settings', action: () => this.showSettingsModal() },
    ];

    // Add repos
    this.repos.forEach(r => {
      cmds.push({
        icon: '→',
        label: `Open ${r.name}`,
        hint: r.path,
        action: () => this.createSession(r.id)
      });
    });

    // Add session switching
    this.sessions.forEach((s, i) => {
      cmds.push({
        icon: `${i + 1}`,
        label: `Switch to ${s.repoName || s.tool || 'shell'}`,
        hint: `Alt+${i + 1}`,
        action: () => this.switchToSession(s.id)
      });
    });

    return cmds;
  }

  filterPaletteItems(query) {
    if (!query) return this.paletteItems;
    const q = query.toLowerCase();
    return this.paletteItems.filter(item =>
      item.label.toLowerCase().includes(q)
    );
  }

  renderPaletteResults() {
    const input = document.getElementById('palette-input');
    const results = document.getElementById('palette-results');
    const filtered = this.filterPaletteItems(input.value);

    results.innerHTML = filtered.map((item, i) => `
      <div class="palette-item ${i === this.paletteIndex ? 'selected' : ''}" data-index="${i}">
        <span class="palette-item-icon">${item.icon}</span>
        <span class="palette-item-label">${this.escapeHtml(item.label)}</span>
        ${item.hint ? `<span class="palette-item-hint">${this.escapeHtml(item.hint)}</span>` : ''}
      </div>
    `).join('');

    results.querySelectorAll('.palette-item').forEach(item => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.index);
        filtered[idx]?.action();
        this.hidePalette();
      });
    });
  }

  executePaletteItem() {
    const filtered = this.filterPaletteItems(document.getElementById('palette-input').value);
    if (filtered[this.paletteIndex]) {
      filtered[this.paletteIndex].action();
      this.hidePalette();
    }
  }

  // ─── Modals ──────────────────────────────────────────────

  showModal(title, content) {
    document.getElementById('modal-header').textContent = title;
    document.getElementById('modal-body').innerHTML = content;
    document.getElementById('modal-overlay').classList.remove('hidden');

    const firstInput = document.querySelector('#modal-body input, #modal-body select');
    if (firstInput) firstInput.focus();
  }

  hideModal() {
    if (this.deviceFlowPollInterval) {
      clearInterval(this.deviceFlowPollInterval);
      this.deviceFlowPollInterval = null;
    }
    document.getElementById('modal-overlay').classList.add('hidden');
    const terminal = this.terminals.get(this.activeSessionId);
    if (terminal) terminal.term.focus();
  }

  showNewSessionModal() {
    const repoOptions = this.repos.map(r =>
      `<option value="${r.id}">${this.escapeHtml(r.name)}</option>`
    ).join('');

    // Build tool options from available tools (fallback to shell if not loaded yet)
    const availableTools = this.tools?.available?.length > 0
      ? this.tools.available
      : [{ id: 'shell', name: 'Bash Shell' }];
    const toolOptions = availableTools.map(t =>
      `<option value="${t.id}">${this.escapeHtml(t.name)}</option>`
    ).join('');

    // Build unavailable tools with install buttons (exclude coming soon tools)
    const comingSoonIds = ['codex'];
    let unavailableHint = '';
    const installableTools = (this.tools?.unavailable || []).filter(t => !comingSoonIds.includes(t.id));
    if (installableTools.length > 0) {
      const hints = installableTools.map(t =>
        `<div class="install-hint">
          <span class="hint-name">${this.escapeHtml(t.name)}</span>
          <button class="btn-install" data-tool="${t.id}" onclick="app.installTool('${t.id}')">Install</button>
        </div>`
      ).join('');
      unavailableHint = `
        <div class="form-group">
          <label class="form-label form-label-muted">Install AI tools:</label>
          ${hints}
        </div>
      `;
    }

    // Show coming soon tools (if not available)
    let comingSoonHint = '';
    const comingSoonTools = (this.tools?.unavailable || []).filter(t => comingSoonIds.includes(t.id));
    if (comingSoonTools.length > 0) {
      const hints = comingSoonTools.map(t =>
        `<div class="coming-soon-hint">
          <span class="hint-name">${this.escapeHtml(t.name)}</span>
          <span class="coming-soon-badge">Coming soon</span>
        </div>`
      ).join('');
      comingSoonHint = `
        <div class="form-group">
          ${hints}
        </div>
      `;
    }

    const profileOptions = this.profiles.map(p =>
      `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`
    ).join('');

    this.showModal('New Session', `
      <div class="form-group">
        <label class="form-label">Repository</label>
        <select id="new-repo" class="form-select">
          <option value="">~ (Home directory)</option>
          ${repoOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Tool</label>
        <select id="new-tool" class="form-select">
          ${toolOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">API Profile</label>
        <select id="new-profile" class="form-select">
          <option value="">Default (system env)</option>
          ${profileOptions}
        </select>
      </div>
      ${unavailableHint}
      ${comingSoonHint}
      <div class="form-actions">
        <button class="btn" onclick="app.hideModal()">Cancel</button>
        <button class="btn btn-primary" onclick="app.submitNewSession()">Start</button>
      </div>
    `);

    // Set default tool
    document.getElementById('new-tool').value = this.tools?.defaultTool || 'shell';
  }

  submitNewSession() {
    const repoId = document.getElementById('new-repo').value || null;
    const tool = document.getElementById('new-tool').value || null;
    const profileId = document.getElementById('new-profile').value || null;
    this.hideModal();
    this.createSession(repoId, tool, profileId);
  }

  showCloneModal() {
    const authSection = this.githubAuth.authenticated
      ? `<div class="auth-connected">
           <span class="auth-status-dot"></span>
           Connected as <strong>@${this.escapeHtml(this.githubAuth.username)}</strong>
           <a href="#" class="auth-logout-link" onclick="event.preventDefault(); app.githubLogout()">Logout</a>
         </div>`
      : `<button class="btn btn-github" onclick="app.githubLogin()">Login with GitHub</button>`;

    this.showModal('Clone Repository', `
      <div class="form-group">
        <label class="form-label">Search GitHub <span class="form-label-muted">(or paste URL)</span></label>
        <div class="search-container">
          <input type="text" id="clone-search" class="form-input" placeholder="Search repositories..." autocomplete="off">
          <div id="search-results" class="search-results hidden"></div>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Repository URL</label>
        <input type="text" id="clone-url" class="form-input" placeholder="https://github.com/user/repo.git">
      </div>
      <div class="form-group">
        <label class="form-label">Local name</label>
        <input type="text" id="clone-name" class="form-input" placeholder="repo-name">
      </div>
      <div class="github-auth-section" id="github-auth-section">
        <label class="form-label">Private repos</label>
        ${authSection}
      </div>
      <details class="manual-auth-section">
        <summary class="auth-toggle">Or enter credentials manually</summary>
        <div class="auth-fields">
          <div class="form-group">
            <label class="form-label">Username</label>
            <input type="text" id="clone-username" class="form-input" placeholder="github-username">
          </div>
          <div class="form-group">
            <label class="form-label">Token <span class="form-label-muted">(PAT or password)</span></label>
            <input type="password" id="clone-token" class="form-input" placeholder="ghp_xxxxxxxxxxxx">
          </div>
        </div>
      </details>
      <div class="form-actions">
        <button class="btn" onclick="app.hideModal()">Cancel</button>
        <button class="btn btn-primary" onclick="app.submitClone()">Clone</button>
      </div>
    `);

    // GitHub search with debounce
    let searchTimeout = null;
    const searchInput = document.getElementById('clone-search');
    const searchResults = document.getElementById('search-results');

    searchInput.addEventListener('input', e => {
      const query = e.target.value.trim();
      clearTimeout(searchTimeout);

      if (query.length < 2) {
        searchResults.classList.add('hidden');
        return;
      }

      searchTimeout = setTimeout(() => this.searchGitHub(query), 300);
    });

    // Close results when clicking outside
    searchInput.addEventListener('blur', () => {
      setTimeout(() => searchResults.classList.add('hidden'), 200);
    });

    searchInput.addEventListener('focus', () => {
      if (searchResults.children.length > 0) {
        searchResults.classList.remove('hidden');
      }
    });

    // Auto-fill local name from URL
    document.getElementById('clone-url').addEventListener('input', e => {
      const url = e.target.value.trim();
      const nameInput = document.getElementById('clone-name');
      // Extract repo name from URL (handles .git suffix and trailing slashes)
      const match = url.match(/\/([^\/]+?)(\.git)?\/?$/);
      if (match && !nameInput.value) {
        nameInput.value = match[1];
      }
    });
  }

  async searchGitHub(query) {
    const searchResults = document.getElementById('search-results');

    try {
      searchResults.innerHTML = '<div class="search-loading">Searching...</div>';
      searchResults.classList.remove('hidden');

      const response = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=8`);

      if (!response.ok) {
        if (response.status === 403) {
          searchResults.innerHTML = '<div class="search-error">Rate limit exceeded. Try again later.</div>';
        } else {
          searchResults.innerHTML = '<div class="search-error">Search failed</div>';
        }
        return;
      }

      const data = await response.json();

      if (data.items.length === 0) {
        searchResults.innerHTML = '<div class="search-empty">No repositories found</div>';
        return;
      }

      searchResults.innerHTML = data.items.map(repo => `
        <div class="search-item" data-url="${repo.clone_url}" data-name="${repo.name}">
          <div class="search-item-name">${this.escapeHtml(repo.full_name)}</div>
          <div class="search-item-desc">${this.escapeHtml(repo.description || 'No description')}</div>
          <div class="search-item-meta">
            <span>${repo.stargazers_count.toLocaleString()} stars</span>
            <span>${repo.language || 'Unknown'}</span>
          </div>
        </div>
      `).join('');

      // Add click handlers to results
      searchResults.querySelectorAll('.search-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          const url = item.dataset.url;
          const name = item.dataset.name;
          document.getElementById('clone-url').value = url;
          document.getElementById('clone-name').value = name;
          document.getElementById('clone-search').value = '';
          searchResults.classList.add('hidden');
        });
      });

    } catch (err) {
      searchResults.innerHTML = '<div class="search-error">Search failed</div>';
    }
  }

  async submitClone() {
    const url = document.getElementById('clone-url').value.trim();
    const name = document.getElementById('clone-name').value.trim();
    const username = document.getElementById('clone-username')?.value.trim() || '';
    const token = document.getElementById('clone-token')?.value.trim() || '';

    if (!url || !name) {
      this.toast('Please fill all fields', 'error');
      return;
    }

    // Show loading state
    const cloneBtn = document.querySelector('.modal .btn-primary');
    const originalText = cloneBtn.textContent;
    cloneBtn.textContent = 'Cloning...';
    cloneBtn.disabled = true;

    const success = await this.cloneRepo(url, name, username, token);
    if (success) {
      this.hideModal();
    } else {
      // Restore button on failure
      cloneBtn.textContent = originalText;
      cloneBtn.disabled = false;
    }
  }

  showDeleteRepoModal() {
    if (this.repos.length === 0) {
      this.toast('No repositories to delete', 'error');
      return;
    }

    const repoList = this.repos.map(r => `
      <div class="repo-item" style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; border-bottom: 1px solid var(--border);">
        <div>
          <div style="font-weight: 500;">${this.escapeHtml(r.name)}</div>
          <div style="font-size: 0.8rem; opacity: 0.7;">${this.escapeHtml(r.path)}</div>
        </div>
        <button class="btn btn-danger" onclick="app.confirmDeleteRepo('${r.id}', '${this.escapeHtml(r.name)}')" style="background: #dc3545; padding: 0.25rem 0.5rem;">Delete</button>
      </div>
    `).join('');

    this.showModal('Delete Repository', `
      <div style="max-height: 300px; overflow-y: auto;">
        ${repoList}
      </div>
      <div class="form-actions" style="margin-top: 1rem;">
        <button class="btn" onclick="app.hideModal()">Close</button>
      </div>
    `);
  }

  confirmDeleteRepo(id, name) {
    this.showModal('Confirm Delete', `
      <p>Delete <strong>${name}</strong>?</p>
      <p style="font-size: 0.9rem; opacity: 0.7;">This will remove the repository from Nomacode but won't delete the files from disk.</p>
      <div class="form-actions">
        <button class="btn" onclick="app.showDeleteRepoModal()">Cancel</button>
        <button class="btn btn-danger" onclick="app.deleteRepo('${id}'); app.hideModal();" style="background: #dc3545;">Delete</button>
      </div>
    `);
  }

  showSettingsModal() {
    // Build tool options from available tools (fallback to shell if not loaded yet)
    const availableTools = this.tools?.available?.length > 0
      ? this.tools.available
      : [{ id: 'shell', name: 'Bash Shell' }];
    const toolOptions = availableTools.map(t =>
      `<option value="${t.id}">${this.escapeHtml(t.name)}</option>`
    ).join('');

    const profilesList = this.profiles.length > 0
      ? this.profiles.map(p => `
        <div class="profile-item">
          <span class="profile-name">${this.escapeHtml(p.name)}</span>
          <span class="profile-provider">${this.escapeHtml(p.provider)}</span>
          <button class="btn-icon" onclick="app.showEditProfileModal('${this.escapeAttr(p.id)}')" title="Edit">&#9998;</button>
          <button class="btn-icon btn-icon-danger" onclick="app.deleteProfile('${this.escapeAttr(p.id)}')" title="Delete">&times;</button>
        </div>`
      ).join('')
      : '<p class="form-hint">No profiles configured.</p>';

    this.showModal('Settings', `
      <div class="form-group">
        <label class="form-label">Default tool</label>
        <select id="setting-tool" class="form-select">
          ${toolOptions}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Font size</label>
        <input type="number" id="setting-fontsize" class="form-input" min="10" max="24" value="${this.settings?.terminal?.fontSize || 14}">
      </div>
      <div class="form-group">
        <label class="form-label">API Profiles</label>
        <div class="profiles-list">${profilesList}</div>
        <button class="btn btn-sm" onclick="app.showAddProfileModal()" style="margin-top: 8px;">+ Add profile</button>
      </div>
      <div class="form-actions">
        <button class="btn" onclick="app.hideModal()">Cancel</button>
        <button class="btn btn-primary" onclick="app.submitSettings()">Save</button>
      </div>
    `);

    document.getElementById('setting-tool').value = this.settings?.defaultTool || '';
  }

  async submitSettings() {
    const tool = document.getElementById('setting-tool').value;
    const fontSize = parseInt(document.getElementById('setting-fontsize').value);

    try {
      this.settings = await API.settings.update({
        defaultTool: tool,
        terminal: { fontSize }
      });

      // Update terminal font sizes
      this.terminals.forEach(t => {
        t.term.options.fontSize = fontSize;
        t.fitAddon.fit();
      });

      this.hideModal();
      this.toast('Settings saved', 'success');
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  showAddProfileModal() {
    this.showProfileModal();
  }

  showEditProfileModal(id) {
    const profile = this.profiles.find(p => p.id === id);
    if (profile) this.showProfileModal(profile);
  }

  showProfileModal(profile = null) {
    const isEdit = !!profile;
    const title = isEdit ? 'Edit Profile' : 'New Profile';

    this.showModal(title, `
      <div class="form-group">
        <label class="form-label">Name</label>
        <input type="text" id="profile-name" class="form-input" placeholder="e.g. MiniMax, Ollama..." value="${isEdit ? this.escapeAttr(profile.name) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">Provider</label>
        <select id="profile-provider" class="form-select" onchange="app.onProfileProviderChange()">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div id="custom-env-fields" style="display: none;">
        <div class="form-group">
          <label class="form-label">API Key env var name</label>
          <input type="text" id="profile-envkey" class="form-input" placeholder="e.g. MY_API_KEY" value="${isEdit && profile.envKeyName ? this.escapeAttr(profile.envKeyName) : ''}">
        </div>
        <div class="form-group">
          <label class="form-label">Base URL env var name <span class="form-label-muted">(optional)</span></label>
          <input type="text" id="profile-envurl" class="form-input" placeholder="e.g. MY_BASE_URL" value="${isEdit && profile.envUrlName ? this.escapeAttr(profile.envUrlName) : ''}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">API Key</label>
        <input type="password" id="profile-apikey" class="form-input" placeholder="sk-..." value="">
      </div>
      <div class="form-group">
        <label class="form-label">Base URL <span class="form-label-muted">(optional)</span></label>
        <input type="text" id="profile-baseurl" class="form-input" placeholder="https://api.example.com/v1" value="${isEdit && profile.baseUrl ? this.escapeAttr(profile.baseUrl) : ''}">
      </div>
      <div class="form-actions">
        <button class="btn" onclick="app.showSettingsModal()">Back</button>
        <button class="btn btn-primary" onclick="app.submitProfile('${isEdit ? this.escapeAttr(profile.id) : ''}')">${isEdit ? 'Update' : 'Create'}</button>
      </div>
    `);

    if (isEdit) {
      document.getElementById('profile-provider').value = profile.provider;
      this.onProfileProviderChange();
    }
  }

  onProfileProviderChange() {
    const provider = document.getElementById('profile-provider').value;
    document.getElementById('custom-env-fields').style.display = provider === 'custom' ? 'block' : 'none';
  }

  async submitProfile(id) {
    const name = document.getElementById('profile-name').value;
    const provider = document.getElementById('profile-provider').value;
    const apiKey = document.getElementById('profile-apikey').value;
    const baseUrl = document.getElementById('profile-baseurl').value;
    const envKeyName = document.getElementById('profile-envkey')?.value || '';
    const envUrlName = document.getElementById('profile-envurl')?.value || '';

    if (!name.trim()) { this.toast('Name is required', 'error'); return; }
    if (!apiKey.trim() && !id) { this.toast('API key is required', 'error'); return; }
    if (provider === 'custom' && !envKeyName.trim()) {
      this.toast('Custom provider requires an API key env var name', 'error');
      return;
    }

    try {
      const data = { name, provider, baseUrl, envKeyName, envUrlName };
      if (apiKey.trim()) data.apiKey = apiKey;

      if (id) {
        await API.profiles.update(id, data);
        this.toast('Profile updated', 'success');
      } else {
        await API.profiles.create(data);
        this.toast('Profile created', 'success');
      }

      await this.loadProfiles();
      this.showSettingsModal();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  async deleteProfile(id) {
    try {
      await API.profiles.delete(id);
      await this.loadProfiles();
      this.toast('Profile deleted', 'success');
      this.showSettingsModal();
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  showOpenRepoModal() {
    if (this.repos.length === 0) {
      this.toast('No repositories. Clone one first.', 'error');
      return;
    }

    const items = this.repos.map(r => ({
      icon: '📁',
      label: r.name,
      hint: r.path,
      action: () => this.createSession(r.id)
    }));

    this.showPalette(items);
  }

  installTool(toolId) {
    const tool = this.tools.unavailable.find(t => t.id === toolId);
    if (!tool) return;

    this.showModal(`Installing ${tool.name}`, `
      <div class="install-output" id="install-output"></div>
      <div class="install-status" id="install-status">
        <span class="spinner"></span> Installing...
      </div>
    `);

    const output = document.getElementById('install-output');
    const status = document.getElementById('install-status');

    API.tools.install(
      toolId,
      // onOutput
      (text) => {
        output.textContent += text;
        output.scrollTop = output.scrollHeight;
      },
      // onComplete
      async (result) => {
        if (result.success) {
          status.innerHTML = '<span class="success">Installed successfully!</span>';
          this.toast(`${tool.name} installed!`, 'success');
          // Reload tools
          await this.loadTools();
          // Close modal after a moment
          setTimeout(() => this.hideModal(), 1500);
        } else {
          status.innerHTML = `<span class="error">Installation failed (code ${result.code || 'unknown'})</span>`;
          this.toast('Installation failed', 'error');
        }
      }
    );
  }

  // ─── GitHub OAuth ───────────────────────────────────────

  async loadGitHubAuthStatus() {
    try {
      const status = await API.auth.github.status();
      this.githubAuth = status;
    } catch (e) {
      this.githubAuth = { authenticated: false };
    }
  }

  async githubLogin() {
    const section = document.getElementById('github-auth-section');
    if (!section) return;

    let clientId = this.settings?.githubClientId;

    if (!clientId) {
      // Show client ID input
      section.innerHTML = `
        <label class="form-label">GitHub OAuth Setup</label>
        <p class="form-hint">Create a free OAuth App at
          <a href="https://github.com/settings/developers" target="_blank" rel="noopener">github.com/settings/developers</a>
          and enable Device Flow.
        </p>
        <div class="form-group">
          <label class="form-label">Client ID</label>
          <input type="text" id="github-client-id" class="form-input" placeholder="Ov23li...">
        </div>
        <button class="btn btn-primary" onclick="app.startDeviceFlow()">Continue</button>
      `;
      return;
    }

    this.startDeviceFlow(clientId);
  }

  async startDeviceFlow(clientIdOverride) {
    const section = document.getElementById('github-auth-section');
    if (!section) return;

    // Clear any existing poll from a previous attempt
    if (this.deviceFlowPollInterval) {
      clearInterval(this.deviceFlowPollInterval);
      this.deviceFlowPollInterval = null;
    }

    const clientId = clientIdOverride || document.getElementById('github-client-id')?.value.trim();
    if (!clientId) {
      this.toast('Enter a Client ID', 'error');
      return;
    }

    // Save clientId for future use
    if (!this.settings?.githubClientId || this.settings.githubClientId !== clientId) {
      await API.settings.update({ githubClientId: clientId });
      this.settings.githubClientId = clientId;
    }

    section.innerHTML = `
      <label class="form-label">Connecting to GitHub...</label>
      <div class="device-flow-box">
        <div class="spinner"></div>
      </div>
    `;

    try {
      const result = await API.auth.github.startDeviceFlow(clientId);

      section.innerHTML = `
        <label class="form-label">Enter this code on GitHub</label>
        <div class="device-flow-box">
          <div class="user-code" id="device-user-code">${this.escapeHtml(result.user_code)}</div>
          <button class="btn-copy" onclick="app.copyUserCode()" title="Copy code">Copy</button>
        </div>
        <a href="${this.escapeHtml(result.verification_uri)}" target="_blank" rel="noopener" class="device-flow-link">
          Open ${this.escapeHtml(result.verification_uri)}
        </a>
        <div class="device-flow-status" id="device-flow-status">
          <span class="spinner"></span> Waiting for authorization...
        </div>
      `;

      // Auto-open verification URL
      window.open(result.verification_uri, '_blank');

      // Start polling
      const interval = (result.interval || 5) * 1000;
      const deviceCode = result.device_code;

      const pollFn = async () => {
        try {
          const pollResult = await API.auth.github.pollToken(clientId, deviceCode);

          if (pollResult.status === 'success') {
            clearInterval(this.deviceFlowPollInterval);
            this.deviceFlowPollInterval = null;
            this.githubAuth = { authenticated: true, username: pollResult.username };

            section.innerHTML = `
              <label class="form-label">Private repos</label>
              <div class="auth-connected">
                <span class="auth-status-dot"></span>
                Connected as <strong>@${this.escapeHtml(pollResult.username)}</strong>
                <a href="#" class="auth-logout-link" onclick="event.preventDefault(); app.githubLogout()">Logout</a>
              </div>
            `;
            this.toast(`Authenticated as @${pollResult.username}`, 'success');
          } else if (pollResult.status === 'expired_token' || pollResult.status === 'access_denied') {
            clearInterval(this.deviceFlowPollInterval);
            this.deviceFlowPollInterval = null;
            const statusEl = document.getElementById('device-flow-status');
            if (statusEl) {
              statusEl.innerHTML = `<span class="device-flow-error">${pollResult.status === 'expired_token' ? 'Code expired.' : 'Access denied.'} <a href="#" onclick="event.preventDefault(); app.githubLogin()">Try again</a></span>`;
            }
          } else if (pollResult.status === 'slow_down') {
            // GitHub wants us to slow down — restart with longer interval
            clearInterval(this.deviceFlowPollInterval);
            this.deviceFlowPollInterval = setInterval(pollFn, interval + 5000);
          }
          // authorization_pending: keep polling
        } catch (e) {
          clearInterval(this.deviceFlowPollInterval);
          this.deviceFlowPollInterval = null;
          const statusEl = document.getElementById('device-flow-status');
          if (statusEl) {
            statusEl.innerHTML = `<span class="device-flow-error">Error: ${this.escapeHtml(e.message)} <a href="#" onclick="event.preventDefault(); app.githubLogin()">Retry</a></span>`;
          }
        }
      };

      this.deviceFlowPollInterval = setInterval(pollFn, interval);

    } catch (e) {
      section.innerHTML = `
        <label class="form-label">Private repos</label>
        <div class="device-flow-error">Failed to start: ${this.escapeHtml(e.message)}</div>
        <button class="btn btn-github" onclick="app.githubLogin()">Try Again</button>
      `;
    }
  }

  async githubLogout() {
    try {
      await API.auth.github.logout();
      this.githubAuth = { authenticated: false };
      const section = document.getElementById('github-auth-section');
      if (section) {
        section.innerHTML = `
          <label class="form-label">Private repos</label>
          <button class="btn btn-github" onclick="app.githubLogin()">Login with GitHub</button>
        `;
      }
      this.toast('GitHub disconnected', 'success');
    } catch (e) {
      this.toast(e.message, 'error');
    }
  }

  copyUserCode() {
    const codeEl = document.getElementById('device-user-code');
    if (!codeEl) return;
    navigator.clipboard.writeText(codeEl.textContent.trim()).then(() => {
      this.toast('Code copied!', 'success');
    }).catch(() => {
      // Fallback: select text
      const range = document.createRange();
      range.selectNodeContents(codeEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
  }

  // ─── Toast ───────────────────────────────────────────────

  toast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;

    setTimeout(() => {
      toast.classList.add('hidden');
    }, 3000);
  }

  // ─── Event Binding ───────────────────────────────────────

  bindEvents() {
    // Track physical keyboard Shift key for toolbar combinations
    document.addEventListener('keydown', e => {
      if (e.key === 'Shift') this.shiftHeld = true;
    });
    document.addEventListener('keyup', e => {
      if (e.key === 'Shift') this.shiftHeld = false;
    });

    // Welcome screen actions
    document.querySelectorAll('.action-item').forEach(item => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        switch (action) {
          case 'new-session': this.showNewSessionModal(); break;
          case 'clone-repo': this.showCloneModal(); break;
          case 'open-repo': this.showOpenRepoModal(); break;
          case 'settings': this.showSettingsModal(); break;
          case 'help': this.toast('Ctrl+K for commands, Ctrl+T for new session'); break;
        }
      });
    });

    // Top bar buttons
    document.querySelector('.app-title').addEventListener('click', () => this.showWelcome());
    document.getElementById('new-tab-btn').addEventListener('click', () => this.showNewSessionModal());
    document.getElementById('menu-btn').addEventListener('click', () => this.showPalette());

    // Status mode click to cycle through modes
    document.getElementById('status-mode').addEventListener('click', () => this.cycleMode());

    // Watch for resize to update logo compact state
    window.addEventListener('resize', () => this.updateLogoCompact());

    // Palette input
    const paletteInput = document.getElementById('palette-input');
    paletteInput.addEventListener('input', () => {
      this.paletteIndex = 0;
      this.renderPaletteResults();
    });

    paletteInput.addEventListener('keydown', e => {
      const filtered = this.filterPaletteItems(paletteInput.value);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.paletteIndex = Math.min(this.paletteIndex + 1, filtered.length - 1);
        this.renderPaletteResults();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.paletteIndex = Math.max(this.paletteIndex - 1, 0);
        this.renderPaletteResults();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        this.executePaletteItem();
      } else if (e.key === 'Escape') {
        this.hidePalette();
      }
    });

    // Close overlays on backdrop click
    document.getElementById('palette-overlay').addEventListener('click', e => {
      if (e.target.id === 'palette-overlay') this.hidePalette();
    });

    document.getElementById('modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'modal-overlay') this.hideModal();
    });

    // Global keyboard shortcuts
    document.addEventListener('keydown', e => {
      // Escape: Close palette/modal (always works)
      if (e.key === 'Escape') {
        if (!document.getElementById('palette-overlay').classList.contains('hidden')) {
          this.hidePalette();
        } else if (!document.getElementById('modal-overlay').classList.contains('hidden')) {
          this.hideModal();
        }
        return;
      }

      // Don't capture other shortcuts if typing in input (except palette)
      if (e.target.tagName === 'INPUT' && e.target.id !== 'palette-input') return;
      if (e.target.tagName === 'SELECT') return;

      // Shift-based shortcuts
      if (e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Shift+N: New session
        if (e.key === 'N') {
          e.preventDefault();
          this.showNewSessionModal();
          return;
        }

        // Shift+C: Clone repository
        if (e.key === 'C') {
          e.preventDefault();
          this.showCloneModal();
          return;
        }

        // Shift+W: Close session
        if (e.key === 'W') {
          e.preventDefault();
          if (this.activeSessionId) this.closeSession(this.activeSessionId);
          return;
        }

        // Shift+K: Command palette
        if (e.key === 'K') {
          e.preventDefault();
          this.showPalette();
          return;
        }

        // Shift+O: Open repository
        if (e.key === 'O') {
          e.preventDefault();
          this.showOpenRepoModal();
          return;
        }

        // Shift+1-9: Jump to session by number
        const digitMatch = e.code.match(/^Digit([1-9])$/);
        if (digitMatch) {
          e.preventDefault();
          const idx = parseInt(digitMatch[1]) - 1;
          if (this.sessions[idx]) this.switchToSession(this.sessions[idx].id);
          return;
        }
      }
    });

    // Handle modal form submission on Enter
    document.getElementById('modal-body').addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        const primaryBtn = document.querySelector('#modal-body .btn-primary');
        if (primaryBtn) primaryBtn.click();
      }
    });

    // Key toolbar
    this.bindKeyToolbar();
  }

  // ─── Key Toolbar ────────────────────────────────────────────

  bindKeyToolbar() {
    const toolbar = document.getElementById('key-toolbar');
    if (!toolbar) return;

    const SWIPE_THRESHOLD = 10;

    toolbar.querySelectorAll('.key-btn').forEach(btn => {
      let touchStartX = null;

      const activate = () => {
        if (btn.dataset.modifier) {
          this.toggleModifier(btn.dataset.modifier);
        } else if (btn.dataset.key) {
          this.sendKey(btn.dataset.key);
        }

        const terminal = this.terminals.get(this.activeSessionId);
        if (terminal?.term) {
          terminal.term.focus();
        }
      };

      // Prevent keyboard from closing on touch, but don't activate yet
      btn.addEventListener('touchstart', e => {
        e.preventDefault();
        touchStartX = e.touches[0].clientX;
      }, { passive: false });

      // Only activate if the touch didn't move (not a swipe/scroll)
      btn.addEventListener('touchend', e => {
        if (touchStartX !== null) {
          const dx = Math.abs(e.changedTouches[0].clientX - touchStartX);
          if (dx < SWIPE_THRESHOLD) {
            activate();
          }
        }
        touchStartX = null;
      });

      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        activate();
      });
    });
  }

  toggleModifier(mod) {
    this.modifiers[mod] = !this.modifiers[mod];

    // Update button visual state
    const btn = document.querySelector(`.key-btn[data-modifier="${mod}"]`);
    if (btn) {
      btn.classList.toggle('active', this.modifiers[mod]);
    }
  }

  clearModifiers() {
    this.modifiers.ctrl = false;
    this.modifiers.alt = false;

    document.querySelectorAll('.key-btn.modifier').forEach(btn => {
      btn.classList.remove('active');
    });
  }

  sendKey(key) {
    const terminal = this.terminals.get(this.activeSessionId);
    if (!terminal) return;

    let data = '';

    // Handle special keys
    switch (key) {
      case 'Escape':
        data = '\x1b';
        break;
      case 'Tab':
        // Shift+Tab sends backtab escape sequence
        data = this.shiftHeld ? '\x1b[Z' : '\t';
        break;
      case 'Enter':
        // Carriage return, not \n: terminals submit on CR. Without this case
        // the default branch would send the literal string "Enter".
        data = '\r';
        break;
      case 'Backspace':
        data = '\x7f';
        break;
      case 'ArrowUp':
        data = '\x1b[A';
        break;
      case 'ArrowDown':
        data = '\x1b[B';
        break;
      case 'ArrowRight':
        data = '\x1b[C';
        break;
      case 'ArrowLeft':
        data = '\x1b[D';
        break;
      default:
        // Handle Ctrl+key combinations
        if (this.modifiers.ctrl && key.length === 1) {
          const code = key.toUpperCase().charCodeAt(0) - 64;
          if (code > 0 && code < 32) {
            data = String.fromCharCode(code);
          }
        } else if (this.modifiers.alt && key.length === 1) {
          data = '\x1b' + key;
        } else {
          data = key;
        }
    }

    if (data) {
      this.sendInput(this.activeSessionId, data);
      terminal.term.focus();
    }

    // Clear modifiers after sending
    this.clearModifiers();
  }

  // ─── Utilities ───────────────────────────────────────────

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // escapeHtml() leaves quotes intact, which is fine for text nodes but breaks
  // out of quoted attribute values. Use this for anything interpolated into an
  // attribute (value="...", onclick="...('...')").
  escapeAttr(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

// Initialize app
const app = new Nomacode();
document.addEventListener('DOMContentLoaded', () => app.init());
