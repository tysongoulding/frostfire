import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

import {
  parseDisplayNumber,
  tokensMatch,
  decideWindowRoute,
} from "../../cloud/microvm/scripts/sand-window-router.mjs";

console.log("=== Starting sand-window-router.mjs Adversarial & Empirical Test Suite ===");

// ---------------------------------------------------------------------------
// 1. Unit Level Empirical Checks
// ---------------------------------------------------------------------------
console.log("[Test 1] Testing parseDisplayNumber boundary values...");
assert.equal(parseDisplayNumber(undefined), 1);
assert.equal(parseDisplayNumber(""), 1);
assert.equal(parseDisplayNumber(null), 1);
assert.equal(parseDisplayNumber("abc"), 1);
assert.equal(parseDisplayNumber("0"), 0);
assert.equal(parseDisplayNumber("-1"), -1);
assert.equal(parseDisplayNumber("1"), 1);
assert.equal(parseDisplayNumber("2"), 2);
assert.equal(parseDisplayNumber("65535"), 65535);
assert.equal(parseDisplayNumber(["3", "1"]), 3);
console.log("  -> parseDisplayNumber PASSED");

console.log("[Test 2] Testing tokensMatch constant-time comparison...");
assert.equal(tokensMatch("secret123", "secret123"), true);
assert.equal(tokensMatch("secret123", "secret124"), false);
assert.equal(tokensMatch("secret123", "secret12"), false); // length mismatch
assert.equal(tokensMatch("secret12", "secret123"), false); // length mismatch
assert.equal(tokensMatch("", ""), false);
assert.equal(tokensMatch("", "secret"), false);
assert.equal(tokensMatch(null, "secret"), false);
assert.equal(tokensMatch(12345, "12345"), false);
console.log("  -> tokensMatch PASSED");

console.log("[Test 3] Testing decideWindowRoute authorization logic...");
const mockLookup = (display) => {
  if (display === 1) return "token-d1";
  if (display === 2) return "token-d2";
  return undefined;
};

// Display 1: missing owner header -> 403
let res = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: undefined,
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.reject?.status, 403, "Display 1 with undefined token must be 403");

// Display 1: empty token -> 403
res = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: "",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.reject?.status, 403, "Display 1 with empty token must be 403");

// Display 1: invalid token -> 403
res = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: "wrong-token",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.reject?.status, 403, "Display 1 with wrong token must be 403");

// Display 1: valid token -> port 1337
res = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: "token-d1",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.port, 1337, "Display 1 with valid token must route to primary port 1337");

// Display 2: valid token -> port 14002
res = decideWindowRoute({
  displayHeader: "2",
  ownerHeader: "token-d2",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.port, 14002, "Display 2 with valid token must route to 14002");

// Display 0: invalid display number -> 400
res = decideWindowRoute({
  displayHeader: "0",
  ownerHeader: "token-d1",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.reject?.status, 400, "Display 0 must be 400");

// Display -1 -> 400
res = decideWindowRoute({
  displayHeader: "-1",
  ownerHeader: "token-d1",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.reject?.status, 400, "Negative display must be 400");

// Display 99: missing token file -> 403
res = decideWindowRoute({
  displayHeader: "99",
  ownerHeader: "some-token",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: mockLookup,
});
assert.equal(res.reject?.status, 403, "Missing token file must be 403");
console.log("  -> decideWindowRoute PASSED");

// ---------------------------------------------------------------------------
// 2. Integration / Server-level Adversarial Testing
// ---------------------------------------------------------------------------
const TEST_PORT = 29339;
const PRIMARY_PORT = 29337;
const EXEC_BASE = 39000;
const D2_PORT = EXEC_BASE + 2; // 39002

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sand-test-tokens-"));
fs.writeFileSync(path.join(tempDir, "1"), "alpha-secret-token-d1\n");
fs.writeFileSync(path.join(tempDir, "2"), "bravo-secret-token-d2\n");

function createMockBackend(port, name) {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "x-backend": name });
    res.end(`RESPONSE_FROM_${name}:${req.url}`);
  });
  srv.on("upgrade", (req, socket, head) => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
    );
    socket.on("data", (chunk) => {
      const msg = chunk.toString();
      socket.write(`ACK_${name}:${msg}`);
    });
  });
  return new Promise((resolve) => {
    srv.listen(port, "127.0.0.1", () => resolve(srv));
  });
}

async function runServerTests() {
  console.log("[Test 4] Launching mock backends and sand-window-router...");
  const primaryBackend = await createMockBackend(PRIMARY_PORT, "PRIMARY");
  const d2Backend = await createMockBackend(D2_PORT, "DISPLAY_2");

  const routerProc = spawn(
    process.execPath,
    [
      path.resolve("cloud/microvm/scripts/sand-window-router.mjs"),
      String(TEST_PORT),
      String(PRIMARY_PORT),
      String(EXEC_BASE),
    ],
    {
      env: {
        ...process.env,
        SAND_WINDOW_TOKEN_DIR: tempDir,
      },
      stdio: ["pipe", "pipe", "pipe"],
    }
  );

  await new Promise((resolve, reject) => {
    routerProc.stdout.on("data", (data) => {
      const line = data.toString();
      if (line.includes("sand-window-router listening")) {
        resolve();
      }
    });
    routerProc.stderr.on("data", (data) => {
      console.error("Router stderr:", data.toString());
    });
    routerProc.on("error", reject);
    routerProc.on("exit", (code) => {
      if (code !== 0) reject(new Error(`Router exited early with code ${code}`));
    });
  });
  console.log("  -> sand-window-router started successfully on port", TEST_PORT);

  // Helper for HTTP requests
  function makeRequest({ display, owner, path: reqPath = "/test" }) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (display !== undefined) headers["x-sand-display"] = display;
      if (owner !== undefined) headers["x-sand-window-owner"] = owner;

      const req = http.request(
        {
          host: "127.0.0.1",
          port: TEST_PORT,
          method: "GET",
          path: reqPath,
          headers,
        },
        (res) => {
          let body = "";
          res.on("data", (c) => (body += c.toString()));
          res.on("end", () => {
            resolve({ status: res.statusCode, headers: res.headers, body });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  }

  // 4a. HTTP authorization tests
  console.log("[Test 5] Testing HTTP requests with missing, invalid, and valid tokens...");

  // Missing token on Display 1 -> must be 403
  let resp = await makeRequest({ display: "1", owner: undefined });
  assert.equal(resp.status, 403, "Display 1 without token must be 403 Forbidden");
  assert.match(resp.body, /forbidden/);

  // Wrong token on Display 1 -> must be 403
  resp = await makeRequest({ display: "1", owner: "wrong-token" });
  assert.equal(resp.status, 403, "Display 1 with wrong token must be 403");

  // Valid token on Display 1 -> 200 from PRIMARY
  resp = await makeRequest({ display: "1", owner: "alpha-secret-token-d1" });
  assert.equal(resp.status, 200);
  assert.equal(resp.headers["x-backend"], "PRIMARY");
  assert.equal(resp.body, "RESPONSE_FROM_PRIMARY:/test");

  // Default display (no display header) defaults to 1 -> valid token -> 200
  resp = await makeRequest({ owner: "alpha-secret-token-d1" });
  assert.equal(resp.status, 200);
  assert.equal(resp.headers["x-backend"], "PRIMARY");

  // Display 2 with valid token -> 200 from DISPLAY_2
  resp = await makeRequest({ display: "2", owner: "bravo-secret-token-d2" });
  assert.equal(resp.status, 200);
  assert.equal(resp.headers["x-backend"], "DISPLAY_2");
  assert.equal(resp.body, "RESPONSE_FROM_DISPLAY_2:/test");

  // Display 0 -> 400 Bad Request
  resp = await makeRequest({ display: "0", owner: "alpha-secret-token-d1" });
  assert.equal(resp.status, 400, "Display 0 must be 400");
  assert.match(resp.body, /bad request/);

  // Display -5 -> 400 Bad Request
  resp = await makeRequest({ display: "-5", owner: "alpha-secret-token-d1" });
  assert.equal(resp.status, 400, "Display -5 must be 400");
  console.log("  -> HTTP authorization tests PASSED");

  // 4b. WebSocket Upgrade authorization tests
  console.log("[Test 6] Testing WebSocket upgrade rejection on unauthorized requests...");

  function testUpgradeRaw({ display, owner }) {
    return new Promise((resolve) => {
      const client = net.connect(TEST_PORT, "127.0.0.1", () => {
        let reqStr = "GET /ws HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${TEST_PORT}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n";
        if (display !== undefined) reqStr += `x-sand-display: ${display}\r\n`;
        if (owner !== undefined) reqStr += `x-sand-window-owner: ${owner}\r\n`;
        reqStr += "\r\n";
        client.write(reqStr);
      });

      let responseData = "";
      client.on("data", (chunk) => {
        responseData += chunk.toString();
      });
      client.on("close", () => {
        resolve(responseData);
      });
      client.on("error", (err) => {
        resolve(`ERROR:${err.message}`);
      });
    });
  }

  // Display 1 missing token upgrade -> 403 Forbidden
  let upResp = await testUpgradeRaw({ display: "1", owner: undefined });
  assert.match(upResp, /HTTP\/1\.1 403 Forbidden/, "Upgrade without token must return 403");

  // Display 1 wrong token upgrade -> 403 Forbidden
  upResp = await testUpgradeRaw({ display: "1", owner: "invalid-token" });
  assert.match(upResp, /HTTP\/1\.1 403 Forbidden/, "Upgrade with wrong token must return 403");

  // Display 0 upgrade -> 400 Bad Request
  upResp = await testUpgradeRaw({ display: "0", owner: "alpha-secret-token-d1" });
  assert.match(upResp, /HTTP\/1\.1 400 Bad Request/, "Upgrade with display 0 must return 400");

  console.log("  -> WebSocket upgrade rejection tests PASSED");

  // 4c. WebSocket Upgrade valid session & concurrent stress testing
  console.log("[Test 7] Stress-testing WebSocket upgrade proxy under concurrent load...");
  const CONCURRENT_CLIENTS = 50;
  const MESSAGES_PER_CLIENT = 10;

  function runWsClient(id) {
    return new Promise((resolve, reject) => {
      const display = id % 2 === 0 ? "1" : "2";
      const token = display === "1" ? "alpha-secret-token-d1" : "bravo-secret-token-d2";
      const expectedBackend = display === "1" ? "PRIMARY" : "DISPLAY_2";

      const client = net.connect(TEST_PORT, "127.0.0.1", () => {
        const reqStr = "GET /ws HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${TEST_PORT}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          `x-sand-display: ${display}\r\n` +
          `x-sand-window-owner: ${token}\r\n\r\n`;
        client.write(reqStr);
      });

      let upgraded = false;
      let buffer = "";
      let sentCount = 0;
      let ackCount = 0;

      client.on("data", (chunk) => {
        buffer += chunk.toString();
        if (!upgraded && buffer.includes("101 Switching Protocols")) {
          upgraded = true;
          // Start ping-pong
          sentCount = 1;
          client.write(`MSG_${id}_0`);
        } else if (upgraded) {
          while (buffer.includes(`ACK_${expectedBackend}:MSG_${id}_`)) {
            ackCount++;
            const marker = `ACK_${expectedBackend}:MSG_${id}_${ackCount - 1}`;
            const idx = buffer.indexOf(marker);
            buffer = buffer.slice(idx + marker.length);

            if (sentCount < MESSAGES_PER_CLIENT) {
              client.write(`MSG_${id}_${sentCount}`);
              sentCount++;
            } else if (ackCount >= MESSAGES_PER_CLIENT) {
              client.end();
              return resolve({ id, display, ackCount, success: true });
            }
          }
        }
      });

      client.on("error", (err) => {
        reject(new Error(`Client ${id} error: ${err.message}`));
      });

      setTimeout(() => {
        if (ackCount < MESSAGES_PER_CLIENT) {
          client.destroy();
          reject(new Error(`Client ${id} timed out (acked ${ackCount}/${MESSAGES_PER_CLIENT})`));
        }
      }, 8000);
    });
  }

  const clientPromises = [];
  for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
    clientPromises.push(runWsClient(i));
  }

  const results = await Promise.all(clientPromises);
  assert.equal(results.length, CONCURRENT_CLIENTS);
  for (const r of results) {
    assert.equal(r.success, true);
    assert.equal(r.ackCount, MESSAGES_PER_CLIENT);
  }
  console.log(`  -> Successfully transferred ${CONCURRENT_CLIENTS * MESSAGES_PER_CLIENT} messages across ${CONCURRENT_CLIENTS} concurrent WebSocket connections with 0 failures!`);

  // 4d. Unresponsive / Down backend handling
  console.log("[Test 8] Testing backend offline (502 Bad Gateway) handling...");
  // Display 3 has token, but no backend listening on 39003
  fs.writeFileSync(path.join(tempDir, "3"), "charlie-token-d3\n");
  upResp = await testUpgradeRaw({ display: "3", owner: "charlie-token-d3" });
  assert.match(upResp, /HTTP\/1\.1 502 Bad Gateway/, "Offline backend must return 502 Bad Gateway");
  console.log("  -> Backend offline 502 handling PASSED");

  // 4e. Abrupt client disconnect resilience
  console.log("[Test 9] Testing abrupt client disconnect resilience...");
  for (let i = 0; i < 10; i++) {
    const sock = net.connect(TEST_PORT, "127.0.0.1", () => {
      sock.write(
        "GET /ws HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${TEST_PORT}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "x-sand-display: 1\r\n" +
          "x-sand-window-owner: alpha-secret-token-d1\r\n\r\n"
      );
      // Abruptly destroy immediately
      sock.destroy();
    });
  }
  // Wait a short duration to ensure router didn't crash
  await new Promise((r) => setTimeout(r, 300));
  resp = await makeRequest({ display: "1", owner: "alpha-secret-token-d1" });
  assert.equal(resp.status, 200, "Router remains healthy after abrupt client socket drops");
  console.log("  -> Abrupt disconnect resilience PASSED");

  // Cleanup
  try { routerProc.kill(); } catch {}
  if (typeof primaryBackend.closeAllConnections === "function") primaryBackend.closeAllConnections();
  if (typeof d2Backend.closeAllConnections === "function") d2Backend.closeAllConnections();
  try { primaryBackend.close(); } catch {}
  try { d2Backend.close(); } catch {}
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  console.log("=== ALL sand-window-router tests PASSED successfully! ===");
  process.exit(0);
}

runServerTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("FATAL TEST FAILURE:", err);
    process.exit(1);
  });
