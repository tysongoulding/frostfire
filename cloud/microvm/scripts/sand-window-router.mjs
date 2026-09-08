import http from "node:http";
import net from "node:net";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

export const SAND_BOX_DISPLAY_HEADER = "x-sand-display";
export const SAND_BOX_WINDOW_OWNER_HEADER = "x-sand-window-owner";
export const WINDOW_TOKEN_DIR = process.env.SAND_WINDOW_TOKEN_DIR || "/tmp/sand-window-tokens.d";
export const DEFAULT_LISTEN_PORT = 1339;
export const DEFAULT_PRIMARY_PORT = 1337;
export const DEFAULT_FORK_EXEC_BASE = 14000;

function firstHeader(raw) {
  return Array.isArray(raw) ? raw[0] : raw;
}

export function parseDisplayNumber(raw) {
  const value = firstHeader(raw);
  if (value === undefined || value === null || value === "") return 1;
  const num = Number.parseInt(value, 10);
  return Number.isInteger(num) ? num : 1;
}

export function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length === 0 || bb.length === 0) return false;
  if (ab.length !== bb.length) {
    timingSafeEqual(bb, bb);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function decideWindowRoute({
  displayHeader,
  ownerHeader,
  primaryPort,
  execBase,
  lookupBoundToken,
}) {
  const display = parseDisplayNumber(displayHeader);
  if (display < 1) {
    return {
      reject: {
        status: 400,
        message: `sand-window-router: bad request (display :${display} must be >= 1)`,
      },
    };
  }
  const owner = firstHeader(ownerHeader);
  const bound = lookupBoundToken(display);
  if (bound === undefined || !tokensMatch(owner, bound)) {
    return {
      reject: {
        status: 403,
        message: `sand-window-router: forbidden (display :${display} owner-token mismatch)`,
      },
    };
  }
  if (display === 1) return { port: primaryPort };
  return { port: execBase + display };
}

function readBoundToken(display) {
  try {
    const raw = readFileSync(`${WINDOW_TOKEN_DIR}/${display}`, "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function main() {
  const LISTEN_PORT = Number(process.argv[2] || DEFAULT_LISTEN_PORT);
  const PRIMARY_PORT = Number(process.argv[3] || DEFAULT_PRIMARY_PORT);
  const EXEC_BASE = Number(process.argv[4] || DEFAULT_FORK_EXEC_BASE);

  const server = http.createServer((req, res) => {
    const pathname = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";
    if (pathname === "/health" || pathname === "/ready") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: "lambda-microvm" }));
      req.resume();
      return;
    }

    const decision = decideWindowRoute({
      displayHeader: req.headers[SAND_BOX_DISPLAY_HEADER],
      ownerHeader: req.headers[SAND_BOX_WINDOW_OWNER_HEADER],
      primaryPort: PRIMARY_PORT,
      execBase: EXEC_BASE,
      lookupBoundToken: readBoundToken,
    });
    if (decision.reject !== undefined) {
      if (!res.headersSent) {
        res.writeHead(decision.reject.status, { "content-type": "text/plain" });
      }
      res.end(decision.reject.message);
      req.resume();
      return;
    }
    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: decision.port,
        method: req.method,
        path: req.url,
        headers: req.headers,
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      }
    );
    upstream.on("error", (err) => {
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end(`sand-window-router upstream error: ${String(err)}`);
    });
    req.pipe(upstream);
  });

  // Handle WebSocket / HTTP Upgrade requests
  server.on("upgrade", (req, socket, head) => {
    const decision = decideWindowRoute({
      displayHeader: req.headers[SAND_BOX_DISPLAY_HEADER],
      ownerHeader: req.headers[SAND_BOX_WINDOW_OWNER_HEADER],
      primaryPort: PRIMARY_PORT,
      execBase: EXEC_BASE,
      lookupBoundToken: readBoundToken,
    });
    if (decision.reject !== undefined) {
      const statusText = decision.reject.status === 400 ? "Bad Request" : "Forbidden";
      socket.write(
        `HTTP/1.1 ${decision.reject.status} ${statusText}\r\n` +
          `Content-Type: text/plain\r\n` +
          `Connection: close\r\n\r\n` +
          `${decision.reject.message}\n`
      );
      socket.destroy();
      return;
    }

    const upstreamSocket = net.connect(
      {
        host: "127.0.0.1",
        port: decision.port,
      },
      () => {
        let rawReq = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          rawReq += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        rawReq += "\r\n";
        upstreamSocket.write(rawReq);
        if (head && head.length > 0) {
          upstreamSocket.write(head);
        }
        upstreamSocket.pipe(socket);
        socket.pipe(upstreamSocket);
      }
    );

    upstreamSocket.on("error", (err) => {
      if (socket.writable) {
        socket.write(
          `HTTP/1.1 502 Bad Gateway\r\n` +
            `Content-Type: text/plain\r\n` +
            `Connection: close\r\n\r\n` +
            `sand-window-router upstream upgrade error: ${String(err)}\n`
        );
      }
      socket.destroy();
    });

    socket.on("error", () => {
      upstreamSocket.destroy();
    });

    upstreamSocket.on("close", () => {
      socket.destroy();
    });

    socket.on("close", () => {
      upstreamSocket.destroy();
    });
  });

  server.timeout = 0;
  server.listen(LISTEN_PORT, "0.0.0.0", () => {
    process.stdout.write(
      `sand-window-router listening pid=${process.pid} port=${LISTEN_PORT} primary=${PRIMARY_PORT} fork_base=${EXEC_BASE} (owner-token enforced)\n`
    );
  });
}

if (
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
