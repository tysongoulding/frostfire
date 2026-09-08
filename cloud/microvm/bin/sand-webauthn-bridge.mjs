#!/usr/bin/env node
/**
 * In-VM WebAuthn Port 1340 HTTP Bridge
 * Reverse-engineered from GrokBot / Cursor Sand hostGateway contract (port 1340).
 *
 * Listens on port 1340, validates Bearer authentication tokens in constant time,
 * enforces Zero Credential Leakage, and forwards or handles WebAuthn ceremony requests.
 */

import http from "node:http";
import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";

const LISTEN_PORT = Number(
  process.env.FROSTFIRE_HOST_PORT || process.env.SAND_HOST_PORT || 1340
);
const WINDOW_TOKEN_DIR =
  process.env.SAND_WINDOW_TOKEN_DIR || "/tmp/sand-window-tokens.d";
const TIMEOUT_MS = Number(process.env.WEBAUTHN_CEREMONY_TIMEOUT_MS || 60000);

// In-flight ceremony registry: ceremonyId -> { res, timer }
const inFlight = new Map();

/**
 * Constant-time string equality with SHA-256 pre-hashing.
 * Pre-hashing guarantees 32-byte buffers to avoid length leakage in timingSafeEqual.
 *
 * @param {string} candidate
 * @param {string} expected
 * @returns {boolean}
 */
export function constantTimeTokenMatch(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  if (!candidate || !expected) return false;

  const candHash = createHash("sha256").update(candidate).digest();
  const expHash = createHash("sha256").update(expected).digest();

  return timingSafeEqual(candHash, expHash);
}

/**
 * Validates candidate Bearer token against window tokens, runtime credential files,
 * and environment variables in constant time.
 *
 * @param {string|undefined} rawHeader
 * @returns {boolean}
 */
export function validateBearerToken(rawHeader) {
  if (!rawHeader) return false;
  const token = rawHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  // 1. Scan window token directory
  try {
    const files = readdirSync(WINDOW_TOKEN_DIR);
    for (const f of files) {
      try {
        const expected = readFileSync(`${WINDOW_TOKEN_DIR}/${f}`, "utf8").trim();
        if (expected && constantTimeTokenMatch(token, expected)) {
          return true;
        }
      } catch {}
    }
  } catch {}

  // 2. Scan XDG runtime credential files
  const xdgDirs = [
    process.env.FROSTFIRE_PRIMARY_XDG_RUNTIME_DIR,
    process.env.SAND_PRIMARY_XDG_RUNTIME_DIR,
    process.env.XDG_RUNTIME_DIR,
    "/tmp/xdg-runtime-box",
    "/tmp/frostfire-runtime",
  ].filter(Boolean);

  for (const dir of xdgDirs) {
    for (const file of ["sand-gateway-credential", "frostfire-gateway-credential", "gateway-credential"]) {
      try {
        const [expected] = readFileSync(`${dir}/${file}`, "utf8").split("\n");
        if (expected && constantTimeTokenMatch(token, expected.trim())) {
          return true;
        }
      } catch {}
    }
  }

  // 3. Scan environment variables
  for (const v of ["FROSTFIRE_GATEWAY_TOKEN", "SAND_GATEWAY_TOKEN", "FROSTFIRE_TENANT_TOKEN"]) {
    const expected = process.env[v];
    if (expected && constantTimeTokenMatch(token, expected.trim())) {
      return true;
    }
  }

  return false;
}

/**
 * Zero Credential Leakage Invariant:
 * Verifies that the credential JSON contains no private key material or master secrets.
 *
 * @param {string|object} credentialJson
 * @returns {boolean}
 */
export function verifyZeroCredentialLeakage(credentialJson) {
  if (!credentialJson) return true;
  const str = typeof credentialJson === "string" ? credentialJson : JSON.stringify(credentialJson);
  const forbiddenMarkers = [
    "PRIVATE KEY",
    "BEGIN RSA",
    "BEGIN EC",
    "BEGIN PRIVATE",
    "\"d\":",
    "\"privKey\":",
    "\"kty\":\"EC\",\"d\":",
  ];

  for (const marker of forbiddenMarkers) {
    if (str.includes(marker)) {
      return false;
    }
  }
  return true;
}

/**
 * Generate mock/synthetic passkey assertion for local development / testing
 * when no upstream tunnel daemon is connected.
 *
 * @param {object} payload
 * @returns {string} serialized credential JSON
 */
export function generateSyntheticAssertion(payload) {
  let parsedOptions = {};
  try {
    parsedOptions = typeof payload.optionsJson === "string"
      ? JSON.parse(payload.optionsJson)
      : (payload.optionsJson || {});
  } catch {}

  const rawId = Buffer.from(randomUUID()).toString("base64url");
  const clientData = Buffer.from(JSON.stringify({
    type: payload.kind === "create" ? "webauthn.create" : "webauthn.get",
    challenge: parsedOptions.challenge || "mockChallenge",
    origin: payload.origin || "https://localhost",
    crossOrigin: false,
  })).toString("base64url");

  const rpId = parsedOptions.rpId || parsedOptions.rp?.id || "localhost";
  const rpidHash = createHash("sha256").update(rpId).digest();
  const flags = Buffer.from([0x01]); // Bit 0: User Present (UP)
  const signCount = Buffer.from([0x00, 0x00, 0x00, 0x01]);
  const authData = Buffer.concat([rpidHash, flags, signCount]).toString("base64url");
  const signature = Buffer.from("mock-passkey-assertion-signature-secp256r1").toString("base64url");

  const result = {
    id: rawId,
    rawId: rawId,
    type: "public-key",
    response: payload.kind === "create"
      ? {
          clientDataJSON: clientData,
          attestationObject: authData,
        }
      : {
          clientDataJSON: clientData,
          authenticatorData: authData,
          signature: signature,
          userHandle: null,
        },
  };

  return JSON.stringify(result);
}

/**
 * Create the HTTP server instance.
 */
export function createServer() {
  return http.createServer(async (req, res) => {
    const url = (req.url || "").split("?")[0].replace(/\/+$/, "") || "/";

    if (url === "/health" || url === "/ready") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        service: "sand-webauthn-bridge",
        port: LISTEN_PORT,
      }));
      return;
    }

    if (req.method !== "POST" || url !== "/api/requestWebAuthnCeremony") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    // Enforce constant-time Bearer authentication
    const authHeader = req.headers["authorization"] || req.headers["x-sand-window-owner"];
    if (!validateBearerToken(authHeader)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: false,
        error: {
          name: "NotAllowedError",
          message: "unauthorized: invalid or missing gateway bearer token",
        },
      }));
      return;
    }

    // Buffer incoming request JSON
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyText = Buffer.concat(chunks).toString("utf8");

    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: false,
        error: {
          name: "DataError",
          message: `invalid request JSON: ${err?.message ?? err}`,
        },
      }));
      return;
    }

    const ceremonyId = randomUUID();
    const timer = setTimeout(() => {
      inFlight.delete(ceremonyId);
      if (!res.headersSent) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          error: {
            name: "TimeoutError",
            message: "ceremony timed out waiting for client response",
          },
        }));
      }
    }, TIMEOUT_MS);

    inFlight.set(ceremonyId, { res, timer });

    // Forward to upstream daemon if configured, or handle via synthetic assertion
    const upstreamUrl = process.env.FROSTFIRE_AGENT_UPSTREAM_URL || process.env.SAND_AGENT_UPSTREAM_URL;

    if (upstreamUrl) {
      try {
        const upstreamResp = await fetch(`${upstreamUrl}/api/requestWebAuthnCeremony`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: bodyText,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        const data = await upstreamResp.json();
        clearTimeout(timer);
        inFlight.delete(ceremonyId);

        if (data?.credentialJson && !verifyZeroCredentialLeakage(data.credentialJson)) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            ok: false,
            error: {
              name: "SecurityViolation",
              message: "Zero Credential Leakage invariant violated: private key material detected",
            },
          }));
          return;
        }

        res.writeHead(upstreamResp.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (upstreamErr) {
        clearTimeout(timer);
        inFlight.delete(ceremonyId);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          error: {
            name: "NotAllowedError",
            message: `upstream agent unavailable: ${upstreamErr?.message ?? upstreamErr}`,
          },
        }));
      }
    } else {
      // Standalone / Test mode: generate synthetic assertion
      clearTimeout(timer);
      inFlight.delete(ceremonyId);

      const credentialJson = generateSyntheticAssertion(payload);
      if (!verifyZeroCredentialLeakage(credentialJson)) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          error: {
            name: "SecurityViolation",
            message: "Zero Credential Leakage invariant violated",
          },
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        credentialJson,
      }));
    }
  });
}

// Start server when executed directly
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith("sand-webauthn-bridge.mjs") ||
  process.argv[1].endsWith("sand-webauthn-bridge")
);

if (isDirectExecution) {
  const server = createServer();
  server.listen(LISTEN_PORT, "127.0.0.1", () => {
    process.stdout.write(
      `sand-webauthn-bridge listening on 127.0.0.1:${LISTEN_PORT} (constant-time token enforced)\n`
    );
  });
}
