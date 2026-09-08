import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  decideWindowRoute,
  tokensMatch,
  parseDisplayNumber,
} from "../../cloud/microvm/scripts/sand-window-router.mjs";

import {
  filterAndSanitizeCookies,
  computeCookiesHash,
} from "../../cloud/microvm/scripts/cdp-cookies.mjs";

async function runAdversarialAudit() {
  console.log("=== 1. AUDITING sand-window-router.mjs (Display 1 Bypass & Invariants) ===");

  const tokenStore = {
    1: "master-token-display-1-secret-xyz",
    2: "tenant-token-display-2-secret-abc",
  };
  const lookupBoundToken = (d) => tokenStore[d];

  // Check 1: Display 1 with NO token MUST be rejected with 403
  const d1_no_token = decideWindowRoute({
    displayHeader: "1",
    ownerHeader: undefined,
    primaryPort: 1337,
    execBase: 14000,
    lookupBoundToken,
  });
  assert(d1_no_token.reject !== undefined, "Display 1 with NO token MUST be rejected");
  assert.strictEqual(d1_no_token.reject.status, 403, "Display 1 with NO token must return 403");

  // Check 2: Display 1 with WRONG token MUST be rejected with 403
  const d1_wrong_token = decideWindowRoute({
    displayHeader: "1",
    ownerHeader: "wrong-token",
    primaryPort: 1337,
    execBase: 14000,
    lookupBoundToken,
  });
  assert(d1_wrong_token.reject !== undefined, "Display 1 with WRONG token MUST be rejected");
  assert.strictEqual(d1_wrong_token.reject.status, 403);

  // Check 3: Display 1 with VALID token MUST be allowed and route to primaryPort
  const d1_valid_token = decideWindowRoute({
    displayHeader: "1",
    ownerHeader: "master-token-display-1-secret-xyz",
    primaryPort: 1337,
    execBase: 14000,
    lookupBoundToken,
  });
  assert.strictEqual(d1_valid_token.reject, undefined);
  assert.strictEqual(d1_valid_token.port, 1337, "Display 1 must route to primary port 1337");

  // Check 4: Display 2 with VALID token routes to 14002
  const d2_valid_token = decideWindowRoute({
    displayHeader: "2",
    ownerHeader: "tenant-token-display-2-secret-abc",
    primaryPort: 1337,
    execBase: 14000,
    lookupBoundToken,
  });
  assert.strictEqual(d2_valid_token.reject, undefined);
  assert.strictEqual(d2_valid_token.port, 14002, "Display 2 must route to 14002");

  // Check 5: Display < 1 MUST return 400 Bad Request
  for (const invalidDisplay of ["0", "-1", "-99"]) {
    const res = decideWindowRoute({
      displayHeader: invalidDisplay,
      ownerHeader: "some-token",
      primaryPort: 1337,
      execBase: 14000,
      lookupBoundToken,
    });
    assert(res.reject !== undefined, `Display ${invalidDisplay} must be rejected`);
    assert.strictEqual(res.reject.status, 400, `Display ${invalidDisplay} must return 400`);
  }

  // Check 6: tokensMatch timing safe comparison
  assert.strictEqual(tokensMatch("same_secret", "same_secret"), true);
  assert.strictEqual(tokensMatch("same_secret", "diff_secret"), false);
  assert.strictEqual(tokensMatch("same_secret", "short"), false);
  assert.strictEqual(tokensMatch("", "secret"), false);
  assert.strictEqual(tokensMatch(null, "secret"), false);
  assert.strictEqual(tokensMatch(undefined, undefined), false);

  console.log("PASS: sand-window-router.mjs invariants fully verified.");

  console.log("\n=== 2. AUDITING cdp-cookies.mjs (Live Cookie Sync Logic) ===");
  const now = Math.floor(Date.now() / 1000);
  const testCookies = [
    { name: "valid_session", value: "tok123", expires: now + 3600, secure: true },
    { name: "expired_session", value: "tok456", expires: now - 3600, secure: true },
    { name: "session_cookie", value: "tok789", expires: -1 }, // session cookie
    { name: "", value: "empty_name" }, // malformed
    null, // null entry
  ];

  const sanitized = filterAndSanitizeCookies(testCookies, now);
  assert.strictEqual(sanitized.length, 2, "Only 2 valid cookies should remain");
  assert.strictEqual(sanitized[0].name, "valid_session");
  assert.strictEqual(sanitized[1].name, "session_cookie");

  const hash1 = computeCookiesHash(sanitized);
  const hash2 = computeCookiesHash([...sanitized].reverse());
  assert.strictEqual(hash1, hash2, "computeCookiesHash must be deterministic regardless of order");

  console.log("PASS: cdp-cookies.mjs cookie filtering & hashing verified.");

  console.log("\n=== ALL FORENSIC AUDIT EMPIRICAL CHECKS PASSED ===");
}

runAdversarialAudit().catch((err) => {
  console.error("AUDIT FAILED:", err);
  process.exit(1);
});
