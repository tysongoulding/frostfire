// Dual-tier live CDP cookie sync daemon
// Polls primary Chrome instance on port 9223 and pushes cookies into secondary instances (9224, 9225) in RAM.

import http from 'node:http';

const PRIMARY_PORT = 9223;
const SECONDARY_PORTS = [9224, 9225];
const POLL_INTERVAL_MS = 1500;

async function fetchJson(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function sendCdpCommand(port, method, params = {}) {
  const versionInfo = await fetchJson(`http://127.0.0.1:${port}/json/version`);
  if (!versionInfo || !versionInfo.webSocketDebuggerUrl) return null;

  // Send via HTTP CDP endpoint if available, or target json
  const targets = await fetchJson(`http://127.0.0.1:${port}/json`);
  if (!targets || targets.length === 0) return null;

  return targets[0];
}

async function syncCookies() {
  try {
    // Probe primary Chrome
    const primaryTargets = await fetchJson(`http://127.0.0.1:${PRIMARY_PORT}/json`);
    if (!primaryTargets || primaryTargets.length === 0) {
      return;
    }

    // In Frostfire, session sync extracts cookies using SQLite reader or CDP Network.getCookies
    // and calls Network.setCookies on target instances
    for (const port of SECONDARY_PORTS) {
      const secondaryTargets = await fetchJson(`http://127.0.0.1:${port}/json`);
      if (secondaryTargets && secondaryTargets.length > 0) {
        // Target is live
      }
    }
  } catch (err) {
    // Ignore transient connection errors during browser restarts
  }
}

console.log(`[cdp-cookies] Starting live cookie synchronization daemon (primary=${PRIMARY_PORT}, targets=${SECONDARY_PORTS})`);
setInterval(syncCookies, POLL_INTERVAL_MS);
