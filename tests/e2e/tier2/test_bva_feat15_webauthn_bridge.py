"""
Tier 2 BVA: Feature 15 WebAuthn Bridge Boundary Value Analysis
Tests empty challenges, empty rp_id, corrupted DER signatures, mismatched keys, and origin spoofing.
"""

import unittest
import os
from ..harness import (
    InvertedWebAuthnBroker,
    WebAuthnCeremonyRequest,
    WebAuthnCeremonyResponse,
)


class TestBvaFeature15WebAuthnBridge(unittest.TestCase):
    """Boundary and corner case analysis for inverted WebAuthn signing broker."""

    def setUp(self):
        self.broker = InvertedWebAuthnBroker()

    def test_bva15_01_empty_challenge_bytes(self):
        """Verifies that empty ceremony challenge bytes raise ValueError."""
        with self.assertRaises(ValueError):
            req = WebAuthnCeremonyRequest(challenge=b"", rp_id="example.com", credential_id=b"1")
            self.broker.sign_ceremony(req)

    def test_bva15_02_empty_rp_id(self):
        """Verifies that an empty relying party ID raises ValueError."""
        with self.assertRaises(ValueError):
            req = WebAuthnCeremonyRequest(challenge=b"valid_challenge", rp_id="", credential_id=b"1")
            self.broker.sign_ceremony(req)

    def test_bva15_03_corrupted_der_signature(self):
        """Verifies that tampered signature bytes fail cryptographic verification."""
        challenge = os.urandom(32)
        rp_id = "frostfire.cloud"
        req = WebAuthnCeremonyRequest(challenge=challenge, rp_id=rp_id, credential_id=b"c1")
        res = self.broker.sign_ceremony(req)

        # Corrupt last byte of signature
        bad_sig = bytearray(res.signature)
        bad_sig[-1] ^= 0xFF
        bad_res = WebAuthnCeremonyResponse(
            credential_id=res.credential_id,
            authenticator_data=res.authenticator_data,
            client_data_json=res.client_data_json,
            signature=bytes(bad_sig)
        )

        valid = InvertedWebAuthnBroker.verify_assertion(
            public_key=self.broker.public_key,
            response=bad_res,
            expected_challenge=challenge,
            expected_rp_id=rp_id
        )
        self.assertFalse(valid, "Corrupted signature must not pass verification")

    def test_bva15_04_wrong_public_key_verification(self):
        """Verifies that verifying with an unrelated public key fails."""
        another_broker = InvertedWebAuthnBroker()
        challenge = os.urandom(32)
        rp_id = "frostfire.cloud"
        req = WebAuthnCeremonyRequest(challenge=challenge, rp_id=rp_id, credential_id=b"c1")
        res = self.broker.sign_ceremony(req)

        valid = InvertedWebAuthnBroker.verify_assertion(
            public_key=another_broker.public_key,
            response=res,
            expected_challenge=challenge,
            expected_rp_id=rp_id
        )
        self.assertFalse(valid, "Signature verified against different public key must fail")

    def test_bva15_05_mismatched_client_data_origin(self):
        """Verifies that challenge signed for a different origin is rejected."""
        challenge = os.urandom(32)
        req = WebAuthnCeremonyRequest(challenge=challenge, rp_id="original.com", credential_id=b"c1")
        res = self.broker.sign_ceremony(req)

        # Expecting verification on "spoofed.com"
        valid = InvertedWebAuthnBroker.verify_assertion(
            public_key=self.broker.public_key,
            response=res,
            expected_challenge=challenge,
            expected_rp_id="spoofed.com"
        )
        self.assertFalse(valid, "Assertion verified against mismatched origin must fail")


if __name__ == "__main__":
    unittest.main()
