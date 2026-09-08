import http from "node:http";
import net from "node:net";
import { createHash } from "node:crypto";

let seq = 0;

export async function fetchJson(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
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
    }).on("error", () => resolve(null));
  });
}

export function filterAndSanitizeCookies(cookies, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Array.isArray(cookies)) return [];
  const sanitized = [];
  for (const c of cookies) {
    if (!c || typeof c.name !== "string" || !c.name) continue;
    // Expired cookie filtering: expires > 0 and in the past
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
      const id = ++seq;

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
              // Wait for more data
            }
          }
        });

        socket.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });

        // Send CDP command
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

export async function syncCookies({
  primaryPort = 9223,
  secondaryPorts = [9224, 9225],
  state = { lastSyncedHashes: new Map() }
}) {
  try {
    // 1. Discover primary Chrome target
    const primaryTargets = await fetchJson(`http://127.0.0.1:${primaryPort}/json`);
    const primaryVersion = await fetchJson(`http://127.0.0.1:${primaryPort}/json/version`);
    const primaryWsUrl =
      (primaryTargets && primaryTargets.length > 0 && primaryTargets[0].webSocketDebuggerUrl) ||
      (primaryVersion && primaryVersion.webSocketDebuggerUrl);

    if (!primaryWsUrl) {
      return;
    }

    // 2. Fetch session cookies via Network.getCookies
    const getResult = await executeCdpCommand(primaryWsUrl, "Network.getCookies", {});
    const rawCookies = getResult && Array.isArray(getResult.cookies) ? getResult.cookies : [];

    // 3. Filter expired cookies and sanitize for setCookies
    const sanitizedCookies = filterAndSanitizeCookies(rawCookies);
    const cookieHash = computeCookiesHash(sanitizedCookies);

    // 4. Sync to secondary ports if hash changed
    for (const secPort of secondaryPorts) {
      try {
        const lastHash = state.lastSyncedHashes.get(secPort);
        if (lastHash === cookieHash) {
          // Unchanged, avoid redundant setCookies echo
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
        // Disconnected or transient error on secondary port
      }
    }
  } catch {
    // Gracefully handle primary offline
  }
}
