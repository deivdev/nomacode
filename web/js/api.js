// API Client for Nomacode

const API = {
  baseUrl: '/api',

  async request(method, endpoint, body = null) {
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }

    return data;
  },

  // Repos
  repos: {
    list() {
      return API.request('GET', '/repos');
    },

    get(id) {
      return API.request('GET', `/repos/${id}`);
    },

    clone(url, name, username, token) {
      const body = { url, name };
      if (username) body.username = username;
      if (token) body.token = token;
      return API.request('POST', '/repos', body);
    },

    create(name) {
      return API.request('POST', '/repos', { name });
    },

    delete(id) {
      return API.request('DELETE', `/repos/${id}`);
    },

    pull(id) {
      return API.request('POST', `/repos/${id}/pull`);
    },

    status(id) {
      return API.request('GET', `/repos/${id}/status`);
    }
  },

  // Sessions
  sessions: {
    list() {
      return API.request('GET', '/sessions');
    },

    get(id) {
      return API.request('GET', `/sessions/${id}`);
    },

    create(repoId, tool, cols, rows, profileId) {
      const body = { repoId, tool, cols, rows };
      if (profileId) body.profileId = profileId;
      return API.request('POST', '/sessions', body);
    },

    // Past Claude conversations that can be resumed.
    conversations() {
      return API.request('GET', '/sessions/conversations');
    },

    // Start a new session that resumes a past conversation (`claude --resume`).
    resume(resumeId, cwd) {
      return API.request('POST', '/sessions', { tool: 'claude-code', resumeId, cwd });
    },

    delete(id) {
      return API.request('DELETE', `/sessions/${id}`);
    },

    restart(id) {
      return API.request('POST', `/sessions/${id}/restart`);
    }
  },

  // Profiles
  profiles: {
    list() {
      return API.request('GET', '/profiles');
    },
    create(profile) {
      return API.request('POST', '/profiles', profile);
    },
    update(id, profile) {
      return API.request('PUT', `/profiles/${id}`, profile);
    },
    delete(id) {
      return API.request('DELETE', `/profiles/${id}`);
    }
  },

  // Settings
  settings: {
    get() {
      return API.request('GET', '/settings');
    },

    update(settings) {
      return API.request('PUT', '/settings', settings);
    }
  },

  // Tools
  tools: {
    list() {
      return API.request('GET', '/tools');
    },

    get(id) {
      return API.request('GET', `/tools/${id}`);
    },

    // Install a tool with streaming output
    install(id, onOutput, onComplete) {
      // Buffer for incomplete SSE lines across chunks
      let buffer = '';
      let completed = false;
      const MAX_BUFFER_SIZE = 1024 * 1024; // 1MB limit

      // Safe wrapper to ensure onComplete is only called once
      function safeComplete(result) {
        if (!completed) {
          completed = true;
          try {
            onComplete?.(result);
          } catch (e) {
            console.error('onComplete callback error:', e);
          }
        }
      }

      // Safe wrapper for onOutput
      function safeOutput(data) {
        try {
          onOutput?.(data);
        } catch (e) {
          console.error('onOutput callback error:', e);
        }
      }

      fetch(`${API.baseUrl}/tools/${id}/install`, { method: 'POST' })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder();

          function processSSELine(line) {
            if (line.startsWith('data: ')) {
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'start') {
                  safeOutput(`Installing ${event.data.tool}...\n`);
                } else if (event.type === 'output') {
                  safeOutput(event.data);
                } else if (event.type === 'complete') {
                  safeComplete(event.data);
                } else if (event.type === 'error') {
                  safeOutput(`Error: ${event.data}\n`);
                  safeComplete({ success: false, error: event.data });
                }
              } catch (e) {
                console.warn('SSE parse error:', e, 'line:', line);
              }
            }
          }

          function read() {
            reader.read().then(({ done, value }) => {
              if (done) {
                // Flush any remaining bytes from the decoder
                buffer += decoder.decode();
                // Process any remaining buffered data
                if (buffer.trim()) {
                  processSSELine(buffer.trim());
                }
                // If we never received a complete event, notify caller
                if (!completed) {
                  safeComplete({ success: false, error: 'Stream ended unexpectedly' });
                }
                return;
              }

              // Append new data to buffer
              buffer += decoder.decode(value, { stream: true });

              // Check buffer size to prevent memory issues
              if (buffer.length > MAX_BUFFER_SIZE) {
                console.error('SSE buffer overflow, aborting');
                reader.cancel();
                safeComplete({ success: false, error: 'Buffer overflow' });
                return;
              }

              // Split on newlines
              const lines = buffer.split('\n');

              // Keep the last potentially incomplete line in buffer
              buffer = lines.pop() || '';

              // Process complete lines
              for (const line of lines) {
                if (line.trim()) {
                  processSSELine(line);
                }
              }

              read();
            }).catch(err => {
              console.error('Stream read error:', err);
              safeComplete({ success: false, error: err.message });
            });
          }

          read();
        })
        .catch(err => {
          console.error('Fetch error:', err);
          safeComplete({ success: false, error: err.message });
        });
    }
  },

  // Auth
  auth: {
    github: {
      startDeviceFlow(clientId) {
        return API.request('POST', '/auth/github/device', { clientId });
      },
      pollToken(clientId, deviceCode) {
        return API.request('POST', '/auth/github/poll', { clientId, deviceCode });
      },
      status() {
        return API.request('GET', '/auth/github/status');
      },
      logout() {
        return API.request('DELETE', '/auth/github');
      }
    }
  },

  // Health check
  health() {
    return API.request('GET', '/health');
  }
};

// Make available globally
window.API = API;
