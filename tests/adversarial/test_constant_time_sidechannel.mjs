import { timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  tokensMatch,
  decideWindowRoute,
  parseDisplayNumber,
} from "../../cloud/microvm/scripts/sand-window-router.mjs";

console.log("=== Running Tier 5 Adversarial & Side-Channel Suite for sand-window-router.mjs ===");

// ---------------------------------------------------------------------------
// 1. Side-Channel Timing Variance Benchmark (Interleaved & JIT Warm)
// ---------------------------------------------------------------------------
console.log("[Audit 1] Benchmarking timingSafeEqual and tokensMatch across varying prefix matches (interleaved)...");

const SECRET = "secret-tenant-authorization-token-9876543210-xyz"; // 48 chars
const secretLen = SECRET.length;

const cand0Match = "x".repeat(secretLen);
const cand16Match = SECRET.slice(0, 16) + "x".repeat(secretLen - 16);
const cand32Match = SECRET.slice(0, 32) + "x".repeat(secretLen - 32);
const cand47Match = SECRET.slice(0, 47) + "x"; // 47 matching bytes, 1 byte mismatch
const candFullMatch = SECRET;
const candShort = SECRET.slice(0, 20); // Length mismatch (shorter)

const candidates = [
  { name: "0 matching bytes", val: cand0Match },
  { name: "16 matching bytes", val: cand16Match },
  { name: "32 matching bytes", val: cand32Match },
  { name: "47 matching bytes", val: cand47Match },
  { name: "Exact match", val: candFullMatch },
  { name: "Length mismatch (short)", val: candShort },
];

// Thorough JIT warmup across all candidates
for (let i = 0; i < 50000; i++) {
  for (const c of candidates) {
    tokensMatch(c.val, SECRET);
  }
}

const ROUNDS = 2000;
const ITERS = 50;
const totalTimes = new Map();
for (const c of candidates) totalTimes.set(c.name, 0n);

for (let r = 0; r < ROUNDS; r++) {
  // Rotate candidate order to prevent execution order bias
  const offset = r % candidates.length;
  for (let idx = 0; idx < candidates.length; idx++) {
    const c = candidates[(idx + offset) % candidates.length];
    const start = process.hrtime.bigint();
    for (let i = 0; i < ITERS; i++) {
      tokensMatch(c.val, SECRET);
    }
    const elapsed = process.hrtime.bigint() - start;
    totalTimes.set(c.name, totalTimes.get(c.name) + elapsed);
  }
}

const means = new Map();
for (const c of candidates) {
  const ns = Number(totalTimes.get(c.name)) / (ROUNDS * ITERS);
  means.set(c.name, ns);
  console.log(`  ${c.name.padEnd(25)}: mean = ${ns.toFixed(2)} ns`);
}

const mean0 = means.get("0 matching bytes");
const mean47 = means.get("47 matching bytes");
const diffNs = Math.abs(mean0 - mean47);
const ratioSameLen = diffNs / Math.min(mean0, mean47);

console.log(`  Timing diff (0 vs 47 match): ${diffNs.toFixed(2)} ns (ratio: ${(ratioSameLen * 100).toFixed(2)}%)`);
assert(ratioSameLen < 0.15, `Timing variance between 0 and 47 match too high: ${(ratioSameLen * 100).toFixed(2)}%`);

console.log("  -> Side-Channel Timing Variance Benchmark PASSED");

// ---------------------------------------------------------------------------
// 2. Hostile Input & Type Confusion Attack Tests
// ---------------------------------------------------------------------------
console.log("[Audit 2] Stress-testing hostile inputs, type confusion, and boundary conditions...");

const hostileCandidates = [
  null,
  undefined,
  12345,
  123.456,
  true,
  false,
  {},
  [],
  [SECRET],
  { toString: () => SECRET },
  Buffer.from(SECRET),
  new Uint8Array([1, 2, 3]),
  "",
  " ",
  "\t\r\n",
  "\0",
  `${SECRET}\0`,
  `\0${SECRET}`,
  SECRET + "\r\n",
  " ".repeat(1000),
  "A".repeat(100000), // 100KB string
  "👑".repeat(50),    // 4-byte UTF-8 emojis
  "\uFEFF" + SECRET,  // Byte Order Mark
  "secret-tenant-authorization-token-9876543210-xyz\u00A0", // Non-breaking space
];

for (const hostile of hostileCandidates) {
  assert.equal(
    tokensMatch(hostile, SECRET),
    false,
    `Hostile candidate ${typeof hostile === "string" ? hostile.slice(0, 20) : typeof hostile} must return false`
  );
}
console.log(`  -> Evaluated ${hostileCandidates.length} hostile type/string mutations: all safely rejected.`);

// ---------------------------------------------------------------------------
// 3. Display 1 vs Display N Route Invariant Audit
// ---------------------------------------------------------------------------
console.log("[Audit 3] Auditing Display 1 vs Display N token enforcement invariants...");

const tmpTokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "sand-audit-tokens-"));
fs.writeFileSync(path.join(tmpTokenDir, "1"), "disp1-secret-token\n");
fs.writeFileSync(path.join(tmpTokenDir, "2"), "disp2-secret-token\n");
fs.writeFileSync(path.join(tmpTokenDir, "10"), "disp10-secret-token\n");

const lookupFn = (disp) => {
  try {
    const raw = fs.readFileSync(path.join(tmpTokenDir, String(disp)), "utf8").trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
};

// Invariant: Display 1 MUST enforce token verification
let d1Missing = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: undefined,
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d1Missing.reject?.status, 403, "Display 1 without ownerHeader must return 403");

let d1Wrong = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: "wrong-token-for-display-1",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d1Wrong.reject?.status, 403, "Display 1 with wrong token must return 403");

let d1Valid = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: "disp1-secret-token",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d1Valid.port, 1337, "Display 1 with valid token must route to primary port 1337");

// Invariant: Display 2 MUST enforce token verification
let d2Missing = decideWindowRoute({
  displayHeader: "2",
  ownerHeader: undefined,
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d2Missing.reject?.status, 403, "Display 2 without ownerHeader must return 403");

let d2Valid = decideWindowRoute({
  displayHeader: "2",
  ownerHeader: "disp2-secret-token",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d2Valid.port, 14002, "Display 2 with valid token must route to 14002");

// Invariant: Display 10
let d10Valid = decideWindowRoute({
  displayHeader: "10",
  ownerHeader: "disp10-secret-token",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d10Valid.port, 14010, "Display 10 with valid token must route to 14010");

// Invariant: Cross-display token stealing attempt
let d1WithD2Token = decideWindowRoute({
  displayHeader: "1",
  ownerHeader: "disp2-secret-token",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d1WithD2Token.reject?.status, 403, "Using Display 2 token on Display 1 must be rejected 403");

let d2WithD1Token = decideWindowRoute({
  displayHeader: "2",
  ownerHeader: "disp1-secret-token",
  primaryPort: 1337,
  execBase: 14000,
  lookupBoundToken: lookupFn,
});
assert.equal(d2WithD1Token.reject?.status, 403, "Using Display 1 token on Display 2 must be rejected 403");

// Cleanup
fs.rmSync(tmpTokenDir, { recursive: true, force: true });
console.log("  -> Display 1 vs Display N Route Invariants PASSED");

// ---------------------------------------------------------------------------
// 4. Boundary & Injection Attacks on Display Header
// ---------------------------------------------------------------------------
console.log("[Audit 4] Testing path traversal and display injection attacks...");

const invalidDisplays = [
  "0",
  "-1",
  "-9999",
  "../1",
  "../../etc/passwd",
  "1; rm -rf /",
  "1\0",
  "NaN",
  "Infinity",
  "-Infinity",
];

for (const disp of invalidDisplays) {
  const parsed = parseDisplayNumber(disp);
  const route = decideWindowRoute({
    displayHeader: disp,
    ownerHeader: "disp1-secret-token",
    primaryPort: 1337,
    execBase: 14000,
    lookupBoundToken: () => "disp1-secret-token",
  });

  if (parsed < 1) {
    assert.equal(route.reject?.status, 400, `Display '${disp}' parsed as ${parsed} must be rejected with 400`);
  }
}
console.log("  -> Display boundary and injection tests PASSED");

console.log("=== ALL sand-window-router Tier 5 Audits PASSED ===");
