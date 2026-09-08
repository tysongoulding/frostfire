import assert from "node:assert/strict";
import {
  filterAndSanitizeCookies,
  computeCookiesHash,
} from "../../cloud/microvm/scripts/cdp-cookies.mjs";

console.log("=== Starting cdp-cookies.mjs Adversarial & Empirical Test Suite ===");

// ---------------------------------------------------------------------------
// 1. filterAndSanitizeCookies Edge Cases
// ---------------------------------------------------------------------------
console.log("[Test 1] Testing filterAndSanitizeCookies input validation...");

// Non-array inputs
assert.deepEqual(filterAndSanitizeCookies(null), []);
assert.deepEqual(filterAndSanitizeCookies(undefined), []);
assert.deepEqual(filterAndSanitizeCookies("not-an-array"), []);
assert.deepEqual(filterAndSanitizeCookies(12345), []);
assert.deepEqual(filterAndSanitizeCookies({}), []);

// Malformed items within array
const dirtyArray = [
  null,
  undefined,
  {},
  { name: "" }, // empty name
  { name: null },
  { name: 123 }, // non-string name
  { name: "valid_cookie", value: "secret123" },
];
const sanitizedDirty = filterAndSanitizeCookies(dirtyArray);
assert.equal(sanitizedDirty.length, 1);
assert.equal(sanitizedDirty[0].name, "valid_cookie");
assert.equal(sanitizedDirty[0].value, "secret123");
assert.equal(sanitizedDirty[0].path, "/");
assert.equal(sanitizedDirty[0].secure, false);
assert.equal(sanitizedDirty[0].httpOnly, false);
console.log("  -> Input validation PASSED");

// ---------------------------------------------------------------------------
// 2. Cookie Expiration Filtering
// ---------------------------------------------------------------------------
console.log("[Test 2] Testing cookie expiration filtering boundary...");
const now = 1700000000;
const testCookies = [
  { name: "expired_1s_ago", value: "old", expires: now - 1 },
  { name: "expired_long_ago", value: "ancient", expires: now - 86400 },
  { name: "valid_session", value: "session_val", expires: 0 }, // session cookie
  { name: "valid_no_expires", value: "session_val2" }, // session cookie
  { name: "valid_future_1s", value: "fresh", expires: now + 1 },
  { name: "valid_future_far", value: "fresh2", expires: now + 31536000 },
];

const filtered = filterAndSanitizeCookies(testCookies, now);
const remainingNames = filtered.map((c) => c.name);
assert.deepEqual(
  remainingNames,
  ["valid_session", "valid_no_expires", "valid_future_1s", "valid_future_far"],
  "Must discard expired cookies and preserve session + future cookies"
);
console.log("  -> Cookie expiration filtering PASSED");

// ---------------------------------------------------------------------------
// 3. Cookie Hashing Determinism & Order-Independence
// ---------------------------------------------------------------------------
console.log("[Test 3] Testing computeCookiesHash determinism & order-independence...");
const cookiesA = [
  { name: "c1", value: "v1", domain: ".example.com", path: "/" },
  { name: "c2", value: "v2", domain: ".example.com", path: "/app" },
  { name: "c3", value: "v3", domain: "sub.example.com", path: "/" },
];
const cookiesB = [
  { name: "c3", value: "v3", domain: "sub.example.com", path: "/" },
  { name: "c1", value: "v1", domain: ".example.com", path: "/" },
  { name: "c2", value: "v2", domain: ".example.com", path: "/app" },
];

const hashA = computeCookiesHash(filterAndSanitizeCookies(cookiesA, now));
const hashB = computeCookiesHash(filterAndSanitizeCookies(cookiesB, now));
assert.equal(hashA, hashB, "Hash must be identical regardless of input order");

// Value alteration produces different hash
const cookiesC = [
  { name: "c1", value: "v1_altered", domain: ".example.com", path: "/" },
  { name: "c2", value: "v2", domain: ".example.com", path: "/app" },
  { name: "c3", value: "v3", domain: "sub.example.com", path: "/" },
];
const hashC = computeCookiesHash(filterAndSanitizeCookies(cookiesC, now));
assert.notEqual(hashA, hashC, "Altered cookie value must produce different hash");
console.log("  -> Cookie hashing determinism PASSED");

// ---------------------------------------------------------------------------
// 4. Unicode & Special Character Handling
// ---------------------------------------------------------------------------
console.log("[Test 4] Testing unicode, symbols, and multi-byte cookie values...");
const unicodeCookies = [
  { name: "auth_token", value: "Bearer 🔐✨🚀", domain: "example.com", path: "/" },
  { name: "user_name", value: "Týsøn Éxamplé", domain: "example.com", path: "/" },
  { name: "json_cookie", value: '{"id":123,"role":"admin"}', domain: "example.com", path: "/" },
];
const sanitizedUnicode = filterAndSanitizeCookies(unicodeCookies, now);
assert.equal(sanitizedUnicode.length, 3);
assert.equal(sanitizedUnicode[0].value, "Bearer 🔐✨🚀");
assert.equal(sanitizedUnicode[1].value, "Týsøn Éxamplé");
const unicodeHash = computeCookiesHash(sanitizedUnicode);
assert.equal(typeof unicodeHash, "string");
assert.equal(unicodeHash.length, 64); // Valid SHA-256 hex string
console.log("  -> Unicode handling PASSED");

console.log("=== ALL cdp-cookies.mjs ADVERSARIAL TESTS PASSED! ===");
