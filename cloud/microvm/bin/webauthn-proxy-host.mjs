// ==============================================================================
// Frostfire Cloud MicroVM WebAuthn Native Messaging Host
//
// Bridges Chrome's webAuthenticationProxy extension with the microVM in-box
// gateway on port 1340 via stdio binary framing and HTTP REST dispatch.
// ==============================================================================

import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

const HEADER_BYTES = 4;
const MAX_MESSAGE_BYTES = 64 * 1024 * 1024; // 64 MB maximum message limit
const DEFAULT_GATEWAY_PORT = "1340";
const DEFAULT_CEREMONY_TIMEOUT_MS = 120000; // 2 minute timeout for human interaction

/**
 * Read environment variable with fallback.
 *
 * @param {string} name
 * @param {string|undefined} fallback
 * @returns {string|undefined}
 */
function readEnv(name, fallback) {
	const value = process.env[name];
	return value === undefined || value === "" ? fallback : value;
}

/**
 * Discover in-box gateway credentials from filesystem or runtime environment.
 * Searches candidate XDG directories for gateway credential files.
 *
 * @returns {{ token: string, port?: string } | undefined}
 */
function credentialFile() {
	const candidateDirs = [
		readEnv("FROSTFIRE_PRIMARY_XDG_RUNTIME_DIR", undefined),
		readEnv("SAND_PRIMARY_XDG_RUNTIME_DIR", undefined),
		readEnv("XDG_RUNTIME_DIR", undefined),
		"/tmp/xdg-runtime-box",
		"/tmp/frostfire-runtime",
		"/tmp/sand-window-tokens.d",
	].filter((dir) => dir !== undefined && dir !== "");

	const candidateFilenames = [
		"frostfire-gateway-credential",
		"sand-gateway-credential",
		"gateway-credential",
	];

	for (const runtimeDir of candidateDirs) {
		for (const filename of candidateFilenames) {
			const credentialPath = `${runtimeDir}/${filename}`;
			try {
				const content = readFileSync(credentialPath, "utf8");
				const lines = content.split(/\r?\n/).map((line) => line.trim());
				const token = lines[0];
				const port = lines[1] && lines[1] !== "" ? lines[1] : undefined;
				if (token !== undefined && token !== "") {
					return { token, port };
				}
			} catch {
				// Continue search if file does not exist or is unreadable
			}
		}
	}
	return undefined;
}

/**
 * Resolve the base URL for the in-box gateway HTTP service.
 *
 * @param {{ port?: string } | undefined} credential
 * @returns {string}
 */
function gatewayBaseUrl(credential) {
	const port =
		readEnv("FROSTFIRE_HOST_PORT", undefined) ??
		readEnv("SAND_HOST_PORT", undefined) ??
		credential?.port ??
		DEFAULT_GATEWAY_PORT;
	return `http://127.0.0.1:${port}`;
}

/**
 * Write a framed message to Chrome on process.stdout.
 * Format: [4-byte unsigned int LE length][UTF-8 JSON string]
 *
 * @param {object} payload
 */
function writeMessage(payload) {
	const body = Buffer.from(JSON.stringify(payload), "utf8");
	const header = Buffer.alloc(HEADER_BYTES);
	header.writeUInt32LE(body.length, 0);
	process.stdout.write(Buffer.concat([header, body]));
}

/**
 * Construct standard error payload matching W3C WebAuthn proxy expectations.
 *
 * @param {string} name - e.g. 'NotAllowedError', 'DataError'
 * @param {string} message - Descriptive error message
 * @returns {{ ok: false, error: { name: string, message: string } }}
 */
function failure(name, message) {
	return { ok: false, error: { name, message } };
}

/**
 * Read and decode a single native messaging frame from process.stdin.
 *
 * @returns {Promise<object | undefined>} Resolves to parsed JSON or undefined on EOF
 */
async function readMessage() {
	const chunks = [];
	let total = 0;

	for await (const chunk of process.stdin) {
		chunks.push(chunk);
		total += chunk.length;

		if (total > MAX_MESSAGE_BYTES) {
			throw new Error("native message exceeded the maximum size (64MB)");
		}

		const buffered = Buffer.concat(chunks, total);
		if (buffered.length < HEADER_BYTES) {
			continue;
		}

		const length = buffered.readUInt32LE(0);
		if (length > MAX_MESSAGE_BYTES) {
			throw new Error(
				`native message specified length (${length} bytes) exceeds maximum size (64MB)`
			);
		}

		if (buffered.length >= HEADER_BYTES + length) {
			const bodyBuffer = buffered.subarray(HEADER_BYTES, HEADER_BYTES + length);
			return JSON.parse(bodyBuffer.toString("utf8"));
		}
	}

	return undefined;
}

/**
 * Dispatch ceremony parameters to in-box host gateway on port 1340.
 *
 * @param {object} message
 * @returns {Promise<object>}
 */
async function requestCeremony(message) {
	const credential = credentialFile();
	const token =
		readEnv("FROSTFIRE_GATEWAY_TOKEN", undefined) ??
		readEnv("SAND_GATEWAY_TOKEN", undefined) ??
		credential?.token;

	if (token === undefined) {
		return failure(
			"NotAllowedError",
			"Frostfire in-box gateway token is not available to the browser bridge."
		);
	}

	const timeoutMs = Number(
		readEnv("FROSTFIRE_WEBAUTHN_TIMEOUT_MS", String(DEFAULT_CEREMONY_TIMEOUT_MS))
	);
	const targetUrl = `${gatewayBaseUrl(credential)}/api/requestWebAuthnCeremony`;

	let response;
	try {
		response = await fetch(targetUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				kind: message.kind,
				origin: message.origin,
				optionsJson: message.optionsJson,
			}),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (networkError) {
		if (networkError?.name === "TimeoutError") {
			return failure(
				"NotAllowedError",
				`Frostfire in-box gateway timed out waiting for ceremony completion (${timeoutMs}ms).`
			);
		}
		return failure(
			"NotAllowedError",
			`Could not reach Frostfire in-box host: ${networkError?.message ?? networkError}`
		);
	}

	if (!response.ok) {
		let errorDetail = `HTTP ${response.status}`;
		try {
			const errJson = await response.json();
			if (errJson?.error?.message) {
				errorDetail = errJson.error.message;
			}
		} catch {
			try {
				const errText = await response.text();
				if (errText) errorDetail = errText.slice(0, 200);
			} catch {}
		}
		return failure(
			"NotAllowedError",
			`Frostfire in-box host refused the ceremony (${errorDetail}).`
		);
	}

	try {
		return await response.json();
	} catch (jsonErr) {
		return failure(
			"DataError",
			`Malformed JSON response from Frostfire in-box host: ${jsonErr?.message ?? jsonErr}`
		);
	}
}

/**
 * Main host entry point.
 */
async function main() {
	let message;
	try {
		message = await readMessage();
	} catch (error) {
		writeMessage(failure("DataError", `unreadable native message: ${error.message}`));
		return;
	}

	if (message === undefined) {
		writeMessage(failure("DataError", "no native message was received (stdin closed)"));
		return;
	}

	try {
		const result = await requestCeremony(message);
		writeMessage(result);
	} catch (error) {
		writeMessage(
			failure(
				"NotAllowedError",
				`unexpected host failure during ceremony dispatch: ${error?.message ?? error}`
			)
		);
	}
}

await main();
