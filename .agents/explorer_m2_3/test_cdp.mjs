import http from "node:http";
import { createHash } from "node:crypto";

const PRIMARY_PORT = 19223;
const SECONDARY_PORT = 19224;
const OFFLINE_PORT = 19225;

let primaryGetCookiesCallCount = 0;
let secondarySetCookiesCallCount = 0;
let receivedCookiesAtSecondary = null;

// Mock Primary Chrome CDP Server (port 19223)
const primaryServer = http.createServer((req, res) => {
  if (req.url === "/json/version" || req.url === "/json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{
      id: "page1",
      type: "page",
      webSocketDebuggerUrl: `ws://127.0.0.1:${PRIMARY_PORT}/devtools/page/primary1`
    }]));
    return;
  }
  res.writeHead(404);
  res.end();
});

primaryServer.on("upgrade", (req, socket, head) => {
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
  );
  socket.on("data", (chunk) => {
    // In Node test, parse mock JSON frame
    // For simplicity, extract JSON string if frame or raw
    const str = chunk.toString();
    const jsonMatch = str.match(/\{.*\}/);
    if (jsonMatch) {
      try {
        const cmd = JSON.parse(jsonMatch[0]);
        if (cmd.method === "Network.getCookies") {
          primaryGetCookiesCallCount++;
          const nowSec = Math.floor(Date.now() / 1000);
          const response = {
            id: cmd.id,
            result: {
              cookies: [
                {
                  name: "session_id",
                  value: "secret_session_cookie",
                  domain: ".internal.sand",
                  path: "/",
                  size: 42,
                  session: true,
                  secure: true,
                  httpOnly: true,
                  expires: -1
                },
                {
                  name: "expired_tracker",
                  value: "expired_val",
                  domain: ".internal.sand",
                  path: "/",
                  size: 25,
                  session: false,
                  secure: false,
                  httpOnly: false,
                  expires: nowSec - 500 // Expired!
                }
              ]
            }
          };
          socket.write(JSON.stringify(response));
        }
      } catch (e) {
        console.error("Primary parse error:", e);
      }
    }
  });
});

// Mock Secondary Chrome CDP Server (port 19224)
const secondaryServer = http.createServer((req, res) => {
  if (req.url === "/json/version" || req.url === "/json") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{
      id: "page2",
      type: "page",
      webSocketDebuggerUrl: `ws://127.0.0.1:${SECONDARY_PORT}/devtools/page/secondary1`
    }]));
    return;
  }
  res.writeHead(404);
  res.end();
});

secondaryServer.on("upgrade", (req, socket, head) => {
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n"
  );
  socket.on("data", (chunk) => {
    const str = chunk.toString();
    const jsonMatch = str.match(/\{.*\}/);
    if (jsonMatch) {
      try {
        const cmd = JSON.parse(jsonMatch[0]);
        if (cmd.method === "Network.setCookies") {
          secondarySetCookiesCallCount++;
          receivedCookiesAtSecondary = cmd.params.cookies;
          const response = { id: cmd.id, result: { success: true } };
          socket.write(JSON.stringify(response));
        }
      } catch (e) {
        console.error("Secondary parse error:", e);
      }
    }
  });
});

primaryServer.listen(PRIMARY_PORT, "127.0.0.1", () => {
  secondaryServer.listen(SECONDARY_PORT, "127.0.0.1", async () => {
    console.log("Mock CDP servers listening");

    // Run synchronization logic
    const { syncCookies, computeCookiesHash, filterAndSanitizeCookies } = await import("./test_cdp_module.mjs");

    const state = { lastSyncedHashes: new Map() };

    // First cycle: Should sync session_id and filter expired_tracker
    await syncCookies({
      primaryPort: PRIMARY_PORT,
      secondaryPorts: [SECONDARY_PORT, OFFLINE_PORT],
      state
    });

    console.log("First cycle completed.");
    console.log("primaryGetCookiesCallCount:", primaryGetCookiesCallCount);
    console.log("secondarySetCookiesCallCount:", secondarySetCookiesCallCount);
    console.log("receivedCookiesAtSecondary:", JSON.stringify(receivedCookiesAtSecondary));

    if (secondarySetCookiesCallCount !== 1) {
      console.error("FAIL: Expected 1 setCookies call");
      process.exit(1);
    }
    if (!receivedCookiesAtSecondary || receivedCookiesAtSecondary.length !== 1) {
      console.error("FAIL: Expected 1 cookie after expired filtering, got:", receivedCookiesAtSecondary);
      process.exit(1);
    }
    if (receivedCookiesAtSecondary[0].name !== "session_id") {
      console.error("FAIL: Expected session_id cookie");
      process.exit(1);
    }
    if ("size" in receivedCookiesAtSecondary[0] || "session" in receivedCookiesAtSecondary[0]) {
      console.error("FAIL: Readonly fields size/session were not stripped");
      process.exit(1);
    }

    // Second cycle: Unchanged cookies -> Deduping must prevent setCookies!
    await syncCookies({
      primaryPort: PRIMARY_PORT,
      secondaryPorts: [SECONDARY_PORT, OFFLINE_PORT],
      state
    });

    console.log("Second cycle completed.");
    console.log("secondarySetCookiesCallCount after second cycle:", secondarySetCookiesCallCount);
    if (secondarySetCookiesCallCount !== 1) {
      console.error("FAIL: Deduplication failed, setCookies was called again!");
      process.exit(1);
    }

    console.log("ALL CDP TESTS PASSED SUCCESSFULLY!");
    process.exit(0);
  });
});

setTimeout(() => {
  console.error("TIMEOUT!");
  process.exit(1);
}, 5000);
