// Dual-tier live CDP cookie sync daemon
// Polls primary Chrome instance on port 9223 and pushes cookies into secondary instances (9224, 9225) in RAM.

import http from "node:http";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const PRIMARY_PORT = Number(process.env.PRIMARY_CDP_PORT || 9223);
export const SECONDARY_PORTS = process.env.SECONDARY_CDP_PORTS
  ? process.env.SECONDARY_CDP_PORTS.split(",").map(Number)
  : [9224, 9225];
export const POLL_INTERVAL_MS = Number(process.env.CDP_POLL_INTERVAL_MS || 1500);

let cdpSeq = 0;

export async function fetchJson(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve(JSON.parse(raw));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

export function filterAndSanitizeCookies(cookies, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(cookies)) return [];
  const sanitized = [];
  for (const c of cookies) {
    if (!c || typeof c.name !== "string" || !c.name) continue;
    // Discard expired cookies
    if (typeof c.expires === "number" && c.expires > 0 && c.expires < nowSec) {
      continue;
    }
    const item = {
      name: c.name,
      value: String(c.value ?? ""),
      domain: String(c.domain ?? ""),
      path: String(c.path ?? "/"),
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
    };
    if (typeof c.expires === "number" && c.expires > 0) {
      item.expires = c.expires;
    }
    if (c.sameSite) {
      item.sameSite = c.sameSite;
    }
    sanitized.push(item);
  }
  return sanitized;
}

export function computeCookiesHash(cookies) {
  const sorted = [...cookies].sort((a, b) => {
    const keyA = `${a.domain}:${a.path}:${a.name}`;
    const keyB = `${b.domain}:${b.path}:${b.name}`;
    return keyA.localeCompare(keyB);
  });
  const serialized = JSON.stringify(
    sorted.map((c) => [c.domain, c.path, c.name, c.value, c.expires, c.secure, c.httpOnly])
  );
  return createHash("sha256").update(serialized).digest("hex");
}

export function executeCdpCommand(wsUrl, method, params = {}, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(wsUrl);
      const port = Number(url.port) || 80;
      const host = url.hostname;
      const path = url.pathname + url.search;
      const id = ++cdpSeq;

      const req = http.request({
        host,
        port,
        path,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        },
      });

      const timer = setTimeout(() => {
        req.destroy(new Error(`CDP ${method} timed out`));
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);

      req.on("upgrade", (res, socket, head) => {
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf8");
          const jsonMatch = buffer.match(/\{.*\}/);
          if (jsonMatch) {
            try {
              const msg = JSON.parse(jsonMatch[0]);
              if (msg.id === id) {
                clearTimeout(timer);
                socket.destroy();
                if (msg.error) {
                  reject(new Error(msg.error.message || JSON.stringify(msg.error)));
                } else {
                  resolve(msg.result);
                }
              }
            } catch {
              // Await further data chunks
            }
          }
        });

        socket.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        const payload = JSON.stringify({ id, method, params });
        socket.write(payload);
      });

      req.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

export const syncState = {
  lastSyncedHashes: new Map(),
};

export async function syncCookies(state = syncState) {
  try {
    const primaryTargets = await fetchJson(`http://127.0.0.1:${PRIMARY_PORT}/json`);
    const primaryVersion = await fetchJson(`http://127.0.0.1:${PRIMARY_PORT}/json/version`);
    const primaryWsUrl =
      (primaryTargets && primaryTargets.length > 0 && primaryTargets[0].webSocketDebuggerUrl) ||
      (primaryVersion && primaryVersion.webSocketDebuggerUrl);

    if (!primaryWsUrl) {
      return;
    }

    const getResult = await executeCdpCommand(primaryWsUrl, "Network.getCookies", {});
    const rawCookies = getResult && Array.isArray(getResult.cookies) ? getResult.cookies : [];
    const sanitizedCookies = filterAndSanitizeCookies(rawCookies);
    const cookieHash = computeCookiesHash(sanitizedCookies);

    for (const secPort of SECONDARY_PORTS) {
      try {
        const lastHash = state.lastSyncedHashes.get(secPort);
        if (lastHash === cookieHash) {
          continue;
        }

        const secTargets = await fetchJson(`http://127.0.0.1:${secPort}/json`);
        const secVersion = await fetchJson(`http://127.0.0.1:${secPort}/json/version`);
        const secWsUrl =
          (secTargets && secTargets.length > 0 && secTargets[0].webSocketDebuggerUrl) ||
          (secVersion && secVersion.webSocketDebuggerUrl);

        if (!secWsUrl) {
          continue;
        }

        if (sanitizedCookies.length > 0) {
          await executeCdpCommand(secWsUrl, "Network.setCookies", {
            cookies: sanitizedCookies,
          });
        }
        state.lastSyncedHashes.set(secPort, cookieHash);
      } catch {
        // Suppress transient secondary port connection drops
      }
    }
  } catch {
    // Suppress transient primary port connection drops
  }
}

export function main() {
  console.log(
    `[cdp-cookies] Starting live cookie synchronization daemon (primary=${PRIMARY_PORT}, targets=${SECONDARY_PORTS})`
  );
  setInterval(() => {
    syncCookies(syncState);
  }, POLL_INTERVAL_MS);
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
