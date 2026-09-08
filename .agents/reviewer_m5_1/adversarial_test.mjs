import {
  constantTimeTokenMatch,
  validateBearerToken,
  verifyZeroCredentialLeakage,
  generateSyntheticAssertion,
  createServer
} from '../../cloud/microvm/bin/sand-webauthn-bridge.mjs';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import assert from 'node:assert';

console.log('=== TEST 1: Constant-Time Token Match ===');
assert.strictEqual(constantTimeTokenMatch('abc', 'abc'), true);
assert.strictEqual(constantTimeTokenMatch('abc', 'abd'), false);
assert.strictEqual(constantTimeTokenMatch('short', 'much_longer_token_value_here'), false);
assert.strictEqual(constantTimeTokenMatch('', 'abc'), false);
assert.strictEqual(constantTimeTokenMatch(null, 'abc'), false);
assert.strictEqual(constantTimeTokenMatch('abc', undefined), false);
console.log('  PASS: constantTimeTokenMatch verified');

console.log('=== TEST 2: Zero Credential Leakage ===');
assert.strictEqual(verifyZeroCredentialLeakage({ id: 'pub-key-1', type: 'public-key' }), true);
assert.strictEqual(verifyZeroCredentialLeakage('{"id":"test","sig":"ok"}'), true);
assert.strictEqual(verifyZeroCredentialLeakage('-----BEGIN PRIVATE KEY-----...'), false);
assert.strictEqual(verifyZeroCredentialLeakage('-----BEGIN RSA PRIVATE KEY-----...'), false);
assert.strictEqual(verifyZeroCredentialLeakage('-----BEGIN EC PRIVATE KEY-----...'), false);
assert.strictEqual(verifyZeroCredentialLeakage('{"kty":"EC","d":"secret-val"}'), false);
assert.strictEqual(verifyZeroCredentialLeakage('{"privKey":"secret"}'), false);
console.log('  PASS: verifyZeroCredentialLeakage verified');

console.log('=== TEST 3: Synthetic Assertion Structure ===');
const assertionStr = generateSyntheticAssertion({
  kind: 'get',
  origin: 'https://github.com',
  optionsJson: JSON.stringify({ rpId: 'github.com', challenge: 'dGVzdA' })
});
const assertion = JSON.parse(assertionStr);
assert.strictEqual(assertion.type, 'public-key');
assert(assertion.id && assertion.rawId);
assert(assertion.response.clientDataJSON);
assert(assertion.response.authenticatorData);
assert(assertion.response.signature);
assert.strictEqual(verifyZeroCredentialLeakage(assertionStr), true);
console.log('  PASS: generateSyntheticAssertion verified');

console.log('=== TEST 4: Bearer Token Validation Invariants ===');
process.env.FROSTFIRE_GATEWAY_TOKEN = 'adversarial-gate-token-xyz';
assert.strictEqual(validateBearerToken('Bearer adversarial-gate-token-xyz'), true);
assert.strictEqual(validateBearerToken('Bearer wrong-token'), false);
assert.strictEqual(validateBearerToken('adversarial-gate-token-xyz'), true);
assert.strictEqual(validateBearerToken(''), false);
assert.strictEqual(validateBearerToken(undefined), false);
console.log('  PASS: validateBearerToken verified');

console.log('=== TEST 5: HTTP Server Endpoints & Auth Gate ===');
const TEST_PORT = 13411;
process.env.FROSTFIRE_HOST_PORT = String(TEST_PORT);
const server = createServer();

await new Promise((resolve) => server.listen(TEST_PORT, '127.0.0.1', resolve));

try {
  // 5.1 Health Check
  const healthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/health`);
  assert.strictEqual(healthRes.status, 200);
  const healthJson = await healthRes.json();
  assert.strictEqual(healthJson.status, 'ok');

  // 5.2 Missing Auth
  const noAuthRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/requestWebAuthnCeremony`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'get' }),
  });
  assert.strictEqual(noAuthRes.status, 403);
  const noAuthJson = await noAuthRes.json();
  assert.strictEqual(noAuthJson.ok, false);
  assert.strictEqual(noAuthJson.error.name, 'NotAllowedError');

  // 5.3 Wrong Method (GET instead of POST)
  const wrongMethodRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/requestWebAuthnCeremony`, {
    method: 'GET',
    headers: { Authorization: 'Bearer adversarial-gate-token-xyz' },
  });
  assert.strictEqual(wrongMethodRes.status, 404);

  // 5.4 Malformed Request Body
  const badJsonRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/requestWebAuthnCeremony`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer adversarial-gate-token-xyz',
    },
    body: 'this is not valid json {{{',
  });
  assert.strictEqual(badJsonRes.status, 400);

  // 5.5 Valid Ceremony Request
  const validRes = await fetch(`http://127.0.0.1:${TEST_PORT}/api/requestWebAuthnCeremony`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer adversarial-gate-token-xyz',
    },
    body: JSON.stringify({
      kind: 'get',
      origin: 'https://login.live.com',
      optionsJson: JSON.stringify({ rpId: 'login.live.com', challenge: 'Y2hhbGxlbmdl' }),
    }),
  });
  assert.strictEqual(validRes.status, 200);
  const validJson = await validRes.json();
  assert.strictEqual(validJson.ok, true);
  assert(validJson.credentialJson);
  console.log('  PASS: HTTP server endpoints & auth gates verified');

  console.log('=== TEST 6: Native Messaging Host Stdio Framing E2E ===');
  const proc = spawn('node', ['./cloud/microvm/bin/webauthn-proxy-host.mjs'], {
    env: {
      ...process.env,
      FROSTFIRE_GATEWAY_TOKEN: 'adversarial-gate-token-xyz',
      FROSTFIRE_HOST_PORT: String(TEST_PORT),
    },
    cwd: process.cwd(),
  });

  const msg = {
    kind: 'create',
    origin: 'https://passkey.org',
    optionsJson: JSON.stringify({
      rp: { id: 'passkey.org', name: 'Passkey Org' },
      challenge: 'cGFzc2tleS1jaGFsbGVuZ2U',
    }),
  };
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);

  const stdoutChunks = [];
  proc.stdout.on('data', (d) => stdoutChunks.push(d));

  await new Promise((resolve, reject) => {
    proc.on('exit', (code) => {
      assert.strictEqual(code, 0);
      const combined = Buffer.concat(stdoutChunks);
      assert(combined.length >= 4, 'stdout must have at least 4-byte header');
      const respLen = combined.readUInt32LE(0);
      const respBody = JSON.parse(combined.subarray(4, 4 + respLen).toString('utf8'));
      assert.strictEqual(respBody.ok, true);
      const cred = JSON.parse(respBody.credentialJson);
      assert.strictEqual(cred.type, 'public-key');
      console.log('  PASS: Native Messaging Host Stdio Framing E2E verified');
      resolve();
    });
    proc.on('error', reject);

    // Send frame in two fragmented pieces to test chunk reassembly
    proc.stdin.write(header);
    proc.stdin.write(body.subarray(0, Math.floor(body.length / 2)));
    setTimeout(() => {
      proc.stdin.write(body.subarray(Math.floor(body.length / 2)));
      proc.stdin.end();
    }, 50);
  });

  console.log('=== ALL 6 ADVERSARIAL TESTS PASSED SUCCESSFULLY! ===');
} finally {
  server.close();
}
