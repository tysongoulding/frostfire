"""
Feature 15: Inverted WebAuthn Passkey Bridge (ORIGINAL_REQUEST §R3)
Tests local ECDSA P-256 assertion signing, W3C authenticator data, and Zero Credential Leakage.
"""

import unittest
import os
import hashlib
from ..harness import (
    InvertedWebAuthnBroker,
    WebAuthnCeremonyRequest,
    WebAuthnCeremonyResponse,
)


class TestFeature15WebAuthnBridge(unittest.TestCase):
    """Verifies inverted WebAuthn passkey ceremony signing preserving Zero Credential Leakage."""

    def setUp(self):
        self.broker = InvertedWebAuthnBroker()

    def test_feat15_01_ceremony_request_contract(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R3 line 40 & tunnel.proto WebAuthnCeremonyRequest."""
        challenge = os.urandom(32)
        req = WebAuthnCeremonyRequest(
            challenge=challenge,
            rp_id="cloud.frostfire.internal",
            credential_id=b"cred_p256_001",
            user_verification="preferred"
        )
        self.assertEqual(len(req.challenge), 32)
        self.assertEqual(req.rp_id, "cloud.frostfire.internal")

    def test_feat15_02_ecdsa_p256_assertion_signing(self):
        """Authoritative Source: PROJECT.md Feature 16 (ECDSA P-256 assertion signer)."""
        challenge = os.urandom(32)
        req = WebAuthnCeremonyRequest(
            challenge=challenge,
            rp_id="auth.github.com",
            credential_id=b"cred_github_42"
        )
        res = self.broker.sign_ceremony(req)
        self.assertIsInstance(res, WebAuthnCeremonyResponse)
        self.assertGreater(len(res.signature), 0)
        self.assertGreater(len(res.authenticator_data), 32)

    def test_feat15_03_w3c_authenticator_data_structure(self):
        """Authoritative Source: W3C WebAuthn Level 2 AuthenticatorData specification."""
        req = WebAuthnCeremonyRequest(
            challenge=b"sample_challenge_bytes_12345678",
            rp_id="frostfire.cloud",
            credential_id=b"cred_1"
        )
        res = self.broker.sign_ceremony(req)

        # 1. First 32 bytes: rpIdHash
        expected_rp_hash = hashlib.sha256(b"frostfire.cloud").digest()
        self.assertEqual(res.authenticator_data[:32], expected_rp_hash)

        # 2. Byte 32: flags (bit 0 must be 1 for User Present)
        flags = res.authenticator_data[32]
        self.assertEqual(flags & 0x01, 0x01, "User Present flag must be set")

        # 3. Bytes 33-36: signCount (4 bytes big-endian)
        sign_count = int.from_bytes(res.authenticator_data[33:37], byteorder="big")
        self.assertGreaterEqual(sign_count, 1)

    def test_feat15_04_zero_credential_leakage_verification(self):
        """Authoritative Source: AGENTS.md § Invariants (Zero Credential Leakage)."""
        req = WebAuthnCeremonyRequest(
            challenge=os.urandom(32),
            rp_id="secure.okta.com",
            credential_id=b"cred_sec_77"
        )
        res = self.broker.sign_ceremony(req)
        is_safe = InvertedWebAuthnBroker.verify_zero_credential_leakage(res)
        self.assertTrue(is_safe, "Zero Credential Leakage violated: private key material detected")

    def test_feat15_05_assertion_signature_verification(self):
        """Authoritative Source: W3C WebAuthn signature verification procedure."""
        challenge = os.urandom(32)
        rp_id = "agent.tunnel.cloud"
        req = WebAuthnCeremonyRequest(
            challenge=challenge,
            rp_id=rp_id,
            credential_id=b"cred_key_10"
        )
        res = self.broker.sign_ceremony(req)

        valid = InvertedWebAuthnBroker.verify_assertion(
            public_key=self.broker.public_key,
            response=res,
            expected_challenge=challenge,
            expected_rp_id=rp_id
        )
        self.assertTrue(valid, "Assertion signature failed cryptographic verification")


if __name__ == "__main__":
    unittest.main()
