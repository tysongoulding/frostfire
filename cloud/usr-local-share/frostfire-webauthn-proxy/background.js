const NATIVE_HOST = "co.anysphere.sand.webauthn_proxy";

const inFlight = new Set();

function log(...args) {
	console.log("[sand-webauthn-proxy]", ...args);
}

// Listeners are registered at top level, synchronously: the MV3 service worker
// is suspended when idle, and a listener attached later (inside a promise
// callback, say) would miss the very event that woke the worker.
chrome.webAuthenticationProxy.onRemoteSessionStateChange.addListener(() => {
	void attach();
});

// On a browser relaunch nothing runs this file (the extension is already
// installed), so these two events are what wake the worker and re-attach; the
// top-level attach() only covers the install that spawned this worker.
chrome.runtime.onStartup.addListener(() => {
	void attach();
});
chrome.runtime.onInstalled.addListener(() => {
	void attach();
});

chrome.webAuthenticationProxy.onIsUvpaaRequest.addListener((request) => {
	// The laptop key is a roaming authenticator, never a platform one. Claiming
	// otherwise makes sites offer a platform passkey the box cannot produce.
	chrome.webAuthenticationProxy.completeIsUvpaaRequest({
		requestId: request.requestId,
		isUvpaa: false,
	});
});

chrome.webAuthenticationProxy.onCreateRequest.addListener((request) => {
	void handleRequest("create", request);
});

chrome.webAuthenticationProxy.onGetRequest.addListener((request) => {
	void handleRequest("get", request);
});

chrome.webAuthenticationProxy.onRequestCanceled.addListener((requestId) => {
	// Chrome forbids completing a canceled request; dropping the id is what
	// stops a late native reply from reporting a result.
	if (inFlight.delete(requestId)) {
		log(`request ${requestId} canceled by the page`);
	}
});

async function attach() {
	try {
		const refusal = await chrome.webAuthenticationProxy.attach();
		if (refusal) {
			log("attach refused:", refusal);
			return;
		}
		log("attached — box WebAuthn now routes to the user's machine");
	} catch (error) {
		log("attach failed:", error?.message ?? error);
	}
}

// A loopback host is a secure context, so WebAuthn runs there over plain http
// and `localhost` is a legal rpId. Requiring https alone would refuse a
// developer signing in to a relying party on their own machine.
const LOOPBACK_HOSTNAMES = new Set(["localhost", "[::1]"]); // pragma: allowlist secret

function isLoopbackHostname(hostname) {
	if (LOOPBACK_HOSTNAMES.has(hostname)) {
		return true;
	}
	const octets = hostname.split(".");
	return (
		octets.length === 4 &&
		Number(octets[0]) === 127 &&
		octets.every(octet => /^\d+$/.test(octet) && Number(octet) <= 255)
	);
}

// WebAuthn lets a document claim any rpId equal to its own domain or a
// registrable suffix of it, so a sign-in page a label down — accounts.google.com
// asserting for google.com — is the ordinary shape, not a suspicious one. The
// leading dot is load-bearing: a bare endsWith accepts notgoogle.com here.
function tabCanSpeakFor(url, rpId) {
	const secureContext =
		url.protocol === "https:" ||
		(url.protocol === "http:" && isLoopbackHostname(url.hostname));
	return (
		secureContext &&
		(url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))
	);
}

// Fallback only, for a Chrome that forwards no client override. The proxy API
// exposes no calling origin of its own, so the focused tab is the one remaining
// signal, and it stands in when it could legitimately have made this request.
async function originFromFocusedTab(rpId) {
	try {
		const [tab] = await chrome.tabs.query({
			active: true,
			lastFocusedWindow: true,
		});
		if (tab?.url) {
			const url = new URL(tab.url);
			if (tabCanSpeakFor(url, rpId)) {
				return url.origin;
			}
			log(`focused tab ${url.origin} cannot claim rpId ${rpId}`);
		}
	} catch (error) {
		log("tab lookup failed:", error?.message ?? error);
	}
	return undefined;
}

// Chrome injects remoteDesktopClientOverride into the forwarded options (a
// page cannot send it) carrying the verbatim calling origin, already passed
// through Chrome's own rpId validation including Related Origin Requests — so
// it is authoritative where the focused tab is a guess. Confirmed on Chrome
// 150 for both get and create, and in a Chrome 151 production capture.
function callerFromClientOverride(options, rpId) {
	const override = options?.extensions?.remoteDesktopClientOverride;
	if (typeof override?.origin !== "string" || override.origin === "") {
		return undefined;
	}
	// An embedded caller's clientDataJSON must carry crossOrigin:true and a
	// topOrigin, and the signer emits neither — refuse rather than misstate
	// how the ceremony was invoked.
	if (override.sameOriginWithAncestors === false) {
		return {
			refusal: `Grok Bot cannot sign for a security key request made inside an embedded frame (rpId ${rpId}).`,
		};
	}
	return { origin: override.origin };
}

// The origin is signed into clientDataJSON — get it wrong and the relying
// party rejects an otherwise valid assertion.
async function resolveCaller(options, rpId) {
	const declared = callerFromClientOverride(options, rpId);
	if (declared !== undefined) {
		return declared;
	}
	const guessed = await originFromFocusedTab(rpId);
	if (guessed !== undefined) {
		return { origin: guessed };
	}
	return {
		refusal: `Grok Bot could not confirm which page requested the security key (rpId ${rpId}).`,
	};
}

async function complete(kind, requestId, credentialJson) {
	if (!inFlight.has(requestId)) {
		return;
	}
	const details = { requestId, responseJson: credentialJson };
	try {
		await (kind === "create"
			? chrome.webAuthenticationProxy.completeCreateRequest(details)
			: chrome.webAuthenticationProxy.completeGetRequest(details));
	} catch (error) {
		// Chrome rejects a malformed responseJson here; without this rescue the
		// page's credential promise stays pending forever.
		log(`complete ${kind} rejected: ${error?.message ?? error}`);
		fail(
			kind,
			requestId,
			"NotAllowedError",
			"Grok Bot could not deliver the security key response to this page.",
		);
	}
}

function fail(kind, requestId, name, message) {
	log(`request ${requestId} failed: ${name}: ${message}`);
	if (!inFlight.has(requestId)) {
		return;
	}
	const details = { requestId, error: { name, message } };
	const settled =
		kind === "create"
			? chrome.webAuthenticationProxy.completeCreateRequest(details)
			: chrome.webAuthenticationProxy.completeGetRequest(details);
	settled.catch(error =>
		log(`fail ${kind} rejected: ${error?.message ?? error}`),
	);
}

async function handleRequest(kind, request) {
	const { requestId, requestDetailsJson } = request;
	inFlight.add(requestId);

	let options;
	try {
		options = JSON.parse(requestDetailsJson);
	} catch (error) {
		fail(kind, requestId, "DataError", `unparseable request options: ${error}`);
		inFlight.delete(requestId);
		return;
	}

	const declaredRpId = kind === "create" ? options?.rp?.id : options?.rpId;
	if (!declaredRpId) {
		fail(kind, requestId, "NotAllowedError", "request carried no rpId");
		inFlight.delete(requestId);
		return;
	}
	const rpId = declaredRpId.toLowerCase();

	const caller = await resolveCaller(options, rpId);
	if (caller.refusal !== undefined) {
		fail(kind, requestId, "NotAllowedError", caller.refusal);
		inFlight.delete(requestId);
		return;
	}
	const origin = caller.origin;
	log(`${kind} request ${requestId}: rpId=${rpId} origin=${origin}`);

	try {
		const result = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
			kind,
			origin,
			optionsJson: requestDetailsJson,
		});
		if (result?.ok) {
			await complete(kind, requestId, result.credentialJson);
			log(`${kind} request ${requestId} completed`);
		} else {
			const error = result?.error ?? {
				name: "NotAllowedError",
				message: "the Grok Bot bridge returned no result",
			};
			fail(kind, requestId, error.name, error.message);
		}
	} catch (error) {
		fail(
			kind,
			requestId,
			"NotAllowedError",
			`Grok Bot bridge unavailable: ${error?.message ?? error}`,
		);
	} finally {
		inFlight.delete(requestId);
	}
}

void attach();
