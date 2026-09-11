import { readdirSync, readFileSync } from "node:fs";

import { SAND_BOX_CDP_PORT_BASE } from "./box-contract.generated.mjs";

const X11_UNIX_DIR = "/tmp/.X11-unix";
export const CDP_PORT_BASE = SAND_BOX_CDP_PORT_BASE;
const MAX_DISPLAY_NUMBER = 256;

export function discoverMonitorPorts(x11Dir = X11_UNIX_DIR) {
  let entries;
  try {
    entries = readdirSync(x11Dir);
  } catch {
    return [];
  }
  const ports = [];
  for (const entry of entries) {
    const match = /^X(\d+)$/.exec(entry);
    if (match == null) continue;
    const displayNumber = Number.parseInt(match[1], 10);
    if (!Number.isInteger(displayNumber) || displayNumber <= 0) continue;
    if (displayNumber > MAX_DISPLAY_NUMBER) continue;
    ports.push(CDP_PORT_BASE + displayNumber);
  }
  return ports.sort((a, b) => a - b);
}

// Chrome children re-list --remote-debugging-port; skip --type= (box-doctor).
export function discoverChromeDebugPorts(procRoot = "/proc") {
  let entries;
  try {
    entries = readdirSync(procRoot);
  } catch {
    return [];
  }
  const ports = new Set();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let cmdline;
    try {
      cmdline = readFileSync(`${procRoot}/${entry}/cmdline`, "utf8");
    } catch {
      continue;
    }
    const args = cmdline.split("\0");
    if (args.some((arg) => arg.startsWith("--type="))) continue;
    for (const arg of args) {
      if (!arg.startsWith("--remote-debugging-port=")) continue;
      const port = Number.parseInt(
        arg.slice("--remote-debugging-port=".length),
        10,
      );
      if (Number.isInteger(port) && port > 0 && port <= 65535) ports.add(port);
    }
  }
  return [...ports].sort((a, b) => a - b);
}

export async function getBrowserWsUrl(port, timeoutMs = WS_OPEN_TIMEOUT_MS) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`/json/version HTTP ${res.status}`);
  const body = await res.json();
  const url = body.webSocketDebuggerUrl;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("no webSocketDebuggerUrl");
  }
  return url;
}

// The per-Chrome identity, extracted from the browser WebSocket endpoint
// (ws://127.0.0.1:<port>/devtools/browser/<GUID>). The GUID is minted fresh on
// every Chrome launch, so it changes when a monitor's Chrome is replaced on the
// same CDP port — which is exactly the signal a caller needs to drop per-port
// state (e.g. the sync daemon's "already offered" maps) that a new Chrome must
// not inherit. Falls back to the whole URL when the path is not the expected
// shape, so two genuinely different endpoints never collapse to one identity.
export function browserIdFromWsUrl(wsUrl) {
  if (typeof wsUrl !== "string" || wsUrl.length === 0) return "";
  const match = /\/devtools\/browser\/([^/?#]+)/.exec(wsUrl);
  return match != null ? match[1] : wsUrl;
}

export function chromeVersionFromProduct(product) {
  const match = /Chrome\/(\d+(?:\.\d+){3})$/.exec(typeof product === "string" ? product : "");
  return match != null ? match[1] : "";
}

export function chromeProductFromVersion(browserString) {
  const match = /Chrome\/(\d+\.\d+\.\d+\.\d+)/.exec(
    typeof browserString === "string" ? browserString : "",
  );
  return match != null ? match[0] : "";
}

export async function getBrowserVersion(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/version`);
  if (!res.ok) throw new Error(`/json/version HTTP ${res.status}`);
  const body = await res.json();
  const version = chromeVersionFromProduct(body.Browser);
  if (version === "") throw new Error(`/json/version Browser not a Chrome version: ${body.Browser}`);
  return version;
}

// Every send resolves or rejects within this bound. Chrome answers live
// commands in milliseconds; the case this guards is a command that will NEVER
// be answered — above all Runtime.evaluate against a DISCARDED tab (Memory
// Saver), whose target still attaches but has no renderer to run anything.
// Without the bound one discarded tab wedges a session-sync tick forever.
export const CDP_SEND_TIMEOUT_MS = 15000;

export class CdpBrowser {
  constructor(port, ws, browserId = "") {
    this.port = port;
    this.ws = ws;
    this.browserId = browserId;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Set();
    this.isClosed = false;
    ws.onmessage = event => this.onMessage(event);
    ws.onclose = () => this.fail(new Error("socket closed"));
    ws.onerror = () => this.fail(new Error("socket error"));
  }

  onMessage(event) {
    let msg;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (msg.id === undefined) {
      for (const listener of this.eventListeners) listener(msg);
      return;
    }
    if (!this.pending.has(msg.id)) return;
    const { resolve, reject } = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message ?? "CDP error"));
    else resolve(msg.result);
  }

  fail(error) {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    try {
      this.ws.close();
    } catch {}
  }

  close() {
    this.fail(new Error("connection closed"));
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  send(method, params, sessionId) {
    if (this.isClosed) return Promise.reject(new Error("connection closed"));
    const id = this.nextId++;
    const payload = { id, method, params: params ?? {} };
    // A flat-session command (per-page localStorage read/seed + reload) carries
    // the page's sessionId; a browser-level command (Storage.getCookies) omits
    // it. Responses come back by id either way, so onMessage is unchanged.
    if (sessionId != null) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${CDP_SEND_TIMEOUT_MS}ms`));
      }, CDP_SEND_TIMEOUT_MS);
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
}

export const WS_OPEN_TIMEOUT_MS = 10000;

export async function connectBrowser(port) {
  const wsUrl = await getBrowserWsUrl(port);
  const browserId = browserIdFromWsUrl(wsUrl);
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {}
      reject(new Error("WebSocket open timed out"));
    }, WS_OPEN_TIMEOUT_MS);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(new CdpBrowser(port, ws, browserId));
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connect failed"));
    };
  });
}

export function partitionKeyString(cookie) {
  const key = cookie.partitionKey;
  if (key == null) return "";
  return typeof key === "string" ? key : JSON.stringify(key);
}

// The identity of a cookie: two cookies with the same key are "the same cookie"
// (a set overwrites rather than adds). Matches how a browser scopes a cookie.
export function cookieKey(cookie) {
  return [
    cookie.domain,
    cookie.path,
    cookie.name,
    partitionKeyString(cookie),
  ].join("\u0000");
}

export function cookieFingerprint(cookie) {
  return [
    cookie.value,
    cookie.secure ? 1 : 0,
    cookie.httpOnly ? 1 : 0,
    cookie.sameSite ?? "",
  ].join("\u0000");
}

// Google's short-lived, per-Chrome auth cookies, rotated roughly every ~10
// minutes. They are excluded from the DURABLE SEED only (sand-cookie-persist): a
// value captured now is stale by the next box recreate, and the restored shared
// on-disk cookie file already carries a fresher copy for a fresh Chrome to load.
// The LIVE cross-monitor sync (sand-session-sync) deliberately DOES seed them,
// fill-gap only: Google refuses to serve a session on the long-lived SID/LSID
// cookies alone (a monitor without the rotating companions lands on the
// signed-out account chooser — runtime-verified), and a monitor that already
// holds one keeps its own value, so its rotation chain is never rolled back.
// (The box-browser sign-outs historically blamed on cross-sharing these were
// actually Chrome's DICE identity layer performing a server-side logout-all on
// the fork profile; that layer is disabled via the BrowserSignin:0 policy in the
// Dockerfile, which is what makes any cross-monitor Google cookie sync viable.)
export const ROTATING_AUTH_COOKIE_NAMES = new Set([
  "__Secure-1PSIDTS",
  "__Secure-3PSIDTS",
  "SIDCC",
  "__Secure-1PSIDCC",
  "__Secure-3PSIDCC",
]);

export function isRotatingAuthCookie(name) {
  return ROTATING_AUTH_COOKIE_NAMES.has(name);
}

export function cookieRecency(cookie) {
  return typeof cookie.expires === "number" && cookie.expires > 0
    ? cookie.expires
    : 0;
}

const COOKIE_SAMESITE = new Set(["Strict", "Lax", "None"]);

function cookieHost(domain) {
  if (typeof domain !== "string" || domain.length === 0) return null;
  const host = domain.replace(/^\./, "");
  if (host.length === 0 || /[\0-\x20/@\\]/.test(host)) return null;
  return host;
}

function hostOnlyCookieUrl(domain, path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const host = cookieHost(domain);
  if (host == null) return null;
  const url = `https://${host}${path}`;
  try {
    const parsed = new URL(url);
    if (parsed.username !== "" || parsed.password !== "") return null;
    if (parsed.hostname.toLowerCase() !== host.toLowerCase()) return null;
    return url;
  } catch {
    return null;
  }
}

// Turn a CDP cookie into a Storage.setCookies param. Null when a prefix,
// SameSite, or path would rewrite the URL host or fail Chrome's cookie rules.
export function toCookieParam(cookie) {
  if (cookie == null || typeof cookie.name !== "string" || cookie.name.length === 0) {
    return null;
  }
  if (typeof cookie.path !== "string" || !cookie.path.startsWith("/")) return null;
  const hostPrefixed = cookie.name.startsWith("__Host-");
  const securePrefixed = cookie.name.startsWith("__Secure-");
  if ((hostPrefixed || securePrefixed) && cookie.secure !== true) return null;
  if (hostPrefixed && cookie.path !== "/") return null;
  if (cookie.sameSite != null && !COOKIE_SAMESITE.has(cookie.sameSite)) return null;
  if (cookie.sameSite === "None" && cookie.secure !== true) return null;
  const param = {
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
  if (hostPrefixed) {
    const url = hostOnlyCookieUrl(cookie.domain, cookie.path);
    if (url == null) return null;
    param.url = url;
  } else if (typeof cookie.domain === "string" && cookie.domain.length > 0) {
    param.domain = cookie.domain;
  } else {
    return null;
  }
  if (cookie.sameSite != null) param.sameSite = cookie.sameSite;
  if (cookie.session !== true && typeof cookie.expires === "number" && cookie.expires > 0) {
    param.expires = cookie.expires;
  }
  if (cookie.priority != null) param.priority = cookie.priority;
  if (cookie.partitionKey != null) param.partitionKey = cookie.partitionKey;
  return param;
}

// All cookies in a browser's jar, keyed by identity. Storage.getCookies returns
// the LIVE in-memory jar — including cookies Chrome has not yet flushed to its
// on-disk SQLite file — which is exactly why the durable seed reads them here
// instead of copying the file.
export async function readCookies(browser) {
  const result = await browser.send("Storage.getCookies");
  const byKey = new Map();
  for (const cookie of result.cookies ?? []) byKey.set(cookieKey(cookie), cookie);
  return byKey;
}

// Set cookies in a browser's jar. Batched, with a per-cookie fallback so one
// rejected cookie (e.g. a __Host- prefix rule) can't block the rest.
export async function pushCookies(browser, cookieParams) {
  const params = cookieParams.filter(param => param != null);
  if (params.length === 0) return;
  try {
    await browser.send("Storage.setCookies", { cookies: params });
  } catch {
    for (const param of params) {
      await browser.send("Storage.setCookies", { cookies: [param] }).catch(() => {});
    }
  }
}

export async function listPageTargets(browser) {
  const result = await browser.send("Target.getTargets");
  const targets = [];
  for (const info of result.targetInfos ?? []) {
    if (info.type !== "page") continue;
    if (!/^https?:\/\//i.test(info.url ?? "")) continue;
    targets.push({ targetId: info.targetId, url: info.url });
  }
  return targets;
}

export async function attachToPage(browser, targetId) {
  const result = await browser
    .send("Target.attachToTarget", { targetId, flatten: true })
    .catch(() => null);
  return result?.sessionId ?? null;
}

export async function detachSession(browser, sessionId) {
  await browser.send("Target.detachFromTarget", { sessionId }).catch(() => {});
}

async function evaluate(browser, sessionId, expression) {
  const result = await browser.send(
    "Runtime.evaluate",
    { expression, returnByValue: true },
    sessionId
  );
  if (result?.exceptionDetails != null) return undefined;
  return result?.result?.value;
}

// Read a page's origin + full localStorage as a Map(key -> value). Returns null
// when the page has no usable localStorage (opaque origin, access denied, or a
// document that has not finished enough to expose it).
export async function readPageStorage(browser, sessionId) {
  const raw = await evaluate(
    browser,
    sessionId,
    `(() => { try {
       const items = {};
       for (let i = 0; i < localStorage.length; i++) {
         const k = localStorage.key(i);
         if (k != null) items[k] = localStorage.getItem(k);
       }
       return JSON.stringify({ origin: location.origin, items });
     } catch (_e) { return null; } })()`
  ).catch(() => null);
  if (typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed.origin !== "string") return null;
  return {
    origin: parsed.origin,
    items: new Map(Object.entries(parsed.items ?? {})),
  };
}

export async function setPageStorage(browser, sessionId, entries) {
  for (const [key, value] of entries) {
    const expr = `try { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(
      value
    )}); } catch (_e) {}`;
    await browser
      .send("Runtime.evaluate", { expression: expr }, sessionId)
      .catch(() => {});
  }
}

// Reload a page so the app re-reads the freshly-seeded auth (cookies land in the
// jar and localStorage is now present, but a running SPA read them once at boot).
// location.reload() via evaluate needs no Page domain enabled.
export async function reloadPage(browser, sessionId) {
  await browser
    .send("Runtime.evaluate", { expression: "location.reload()" }, sessionId)
    .catch(() => {});
}

// A page host is in scope of a cookie's domain when it equals it or is a
// subdomain (a leading dot is stripped first). Used to decide which open pages a
// freshly-arrived session cookie affects, so only those are reloaded.
export function hostMatchesCookieDomain(host, cookieDomain) {
  if (typeof host !== "string" || typeof cookieDomain !== "string") return false;
  const h = host.toLowerCase();
  const d = cookieDomain.replace(/^\./, "").toLowerCase();
  if (d.length === 0) return false;
  return h === d || h.endsWith(`.${d}`);
}

export function hostOfOrigin(origin) {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return "";
  }
}
