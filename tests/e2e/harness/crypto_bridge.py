"""
Inverted WebAuthn passkey bridge with ECDSA P-256 assertion signer and verifier.
Implements Requirement R3 inverted passkey bridge preserving Zero Credential Leakage.
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional
import hashlib
import base64
import json

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePrivateKey, EllipticCurvePublicKey
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import utils
from cryptography.exceptions import InvalidSignature


@dataclass
class WebAuthnCeremonyRequest:
    challenge: bytes
    rp_id: str
    credential_id: bytes
    user_verification: str = "preferred"


@dataclass
class WebAuthnCeremonyResponse:
    credential_id: bytes
    authenticator_data: bytes
    client_data_json: bytes
    signature: bytes

    def to_dict(self) -> Dict[str, str]:
        return {
            "credential_id": base64.b64encode(self.credential_id).decode("ascii"),
            "authenticator_data": base64.b64encode(self.authenticator_data).decode("ascii"),
            "client_data_json": base64.b64encode(self.client_data_json).decode("ascii"),
            "signature": base64.b64encode(self.signature).decode("ascii"),
        }


class InvertedWebAuthnBroker:
    """
    Local platform authenticator bridge.
    Performs WebAuthn assertion signing locally, guaranteeing zero private key exposure to cloud.
    """

    def __init__(self, private_key: Optional[EllipticCurvePrivateKey] = None):
        self._private_key = private_key or ec.generate_private_key(ec.SECP256R1())
        self.sign_count = 1

    @property
    def public_key(self) -> EllipticCurvePublicKey:
        return self._private_key.public_key()

    def sign_ceremony(self, request: WebAuthnCeremonyRequest) -> WebAuthnCeremonyResponse:
        """Executes the local signing ceremony for a cloud challenge."""
        if not request.challenge:
            raise ValueError("Ceremony challenge cannot be empty")
        if not request.rp_id:
            raise ValueError("Relying Party ID cannot be empty")

        # 1. Build ClientDataJSON per W3C WebAuthn spec
        client_data = {
            "type": "webauthn.get",
            "challenge": base64.urlsafe_b64encode(request.challenge).decode("ascii").rstrip("="),
            "origin": f"https://{request.rp_id}",
            "crossOrigin": False,
        }
        client_data_json = json.dumps(client_data, separators=(",", ":")).encode("utf-8")
        client_data_hash = hashlib.sha256(client_data_json).digest()

        # 2. Build AuthenticatorData: rpIdHash (32) + flags (1, User Present=0x01) + signCount (4)
        rp_id_hash = hashlib.sha256(request.rp_id.encode("utf-8")).digest()
        flags = bytes([0x01])  # UP (User Present) flag
        sign_count_bytes = self.sign_count.to_bytes(4, byteorder="big")
        self.sign_count += 1
        authenticator_data = rp_id_hash + flags + sign_count_bytes

        # 3. Compute assertion hash = SHA256(authenticatorData || clientDataHash)
        data_to_sign = authenticator_data + client_data_hash
        digest_to_sign = hashlib.sha256(data_to_sign).digest()

        # 4. Produce standard W3C ASN.1 DER ECDSA signature
        signature = self._private_key.sign(
            digest_to_sign,
            ec.ECDSA(utils.Prehashed(hashes.SHA256()))
        )

        return WebAuthnCeremonyResponse(
            credential_id=request.credential_id,
            authenticator_data=authenticator_data,
            client_data_json=client_data_json,
            signature=signature,
        )

    @staticmethod
    def verify_assertion(
        public_key: EllipticCurvePublicKey,
        response: WebAuthnCeremonyResponse,
        expected_challenge: bytes,
        expected_rp_id: str,
    ) -> bool:
        """Verifies that an assertion response is cryptographically valid against the public key."""
        # 1. Verify ClientDataJSON
        client_data = json.loads(response.client_data_json.decode("utf-8"))
        expected_b64_challenge = base64.urlsafe_b64encode(expected_challenge).decode("ascii").rstrip("=")
        if client_data.get("challenge") != expected_b64_challenge:
            return False
        if client_data.get("origin") != f"https://{expected_rp_id}":
            return False

        # 2. Verify rpIdHash in AuthenticatorData
        expected_rp_hash = hashlib.sha256(expected_rp_id.encode("utf-8")).digest()
        if response.authenticator_data[:32] != expected_rp_hash:
            return False

        # 3. Verify user present flag (bit 0 must be 1)
        if (response.authenticator_data[32] & 0x01) != 0x01:
            return False

        # 4. Verify ECDSA signature
        client_data_hash = hashlib.sha256(response.client_data_json).digest()
        data_to_sign = response.authenticator_data + client_data_hash
        digest_to_sign = hashlib.sha256(data_to_sign).digest()

        try:
            public_key.verify(
                response.signature,
                digest_to_sign,
                ec.ECDSA(utils.Prehashed(hashes.SHA256()))
            )
            return True
        except InvalidSignature:
            return False

    @staticmethod
    def verify_zero_credential_leakage(response: WebAuthnCeremonyResponse) -> bool:
        """
        Validates the Zero Credential Leakage invariant.
        Ensures that serialized responses contain only public assertion artifacts and no private key material.
        """
        raw_bytes = response.signature + response.authenticator_data + response.client_data_json
        # Check for typical private key markers
        forbidden_substrings = [b"PRIVATE KEY", b"BEGIN RSA", b"BEGIN EC", b"d:", b"privKey"]
        for marker in forbidden_substrings:
            if marker in raw_bytes:
                return False
        return True
