use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::rand::SystemRandom;
use ring::signature::{self, Ed25519KeyPair, KeyPair};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::error::GatewayError;

/// Claims embedded inside the cryptographically signed Frostfire License JWT.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseClaims {
    /// Canonical user UUID.
    pub sub: String,
    /// User email address.
    pub email: String,
    /// Associated Stripe Customer ID (`cus_...`).
    pub stripe_customer_id: String,
    /// Subscription tier (`"pro"`, `"enterprise"`, `"starter"`).
    pub tier: String,
    /// Issued at (Unix timestamp).
    pub iat: i64,
    /// Expiration timestamp (Unix timestamp).
    pub exp: i64,
}

#[derive(Debug, Serialize, Deserialize)]
struct JwtHeader {
    alg: String,
    typ: String,
}

/// Authority responsible for minting and verifying Ed25519 License JWTs.
#[derive(Clone)]
pub struct LicenseAuthority {
    key_pair: Arc<Ed25519KeyPair>,
    public_key_bytes: Vec<u8>,
}

impl LicenseAuthority {
    /// Generates a new random Ed25519 keypair.
    pub fn generate() -> Result<Self, GatewayError> {
        let rng = SystemRandom::new();
        let pkcs8_bytes = Ed25519KeyPair::generate_pkcs8(&rng)
            .map_err(|e| GatewayError::Internal(format!("Failed to generate Ed25519 key: {e}")))?;

        let key_pair = Ed25519KeyPair::from_pkcs8(pkcs8_bytes.as_ref())
            .map_err(|e| GatewayError::Internal(format!("Failed to parse Ed25519 key: {e}")))?;

        let public_key_bytes = key_pair.public_key().as_ref().to_vec();

        Ok(Self {
            key_pair: Arc::new(key_pair),
            public_key_bytes,
        })
    }

    /// Creates an authority from a raw 32-byte seed (useful for deterministic tests and config loading).
    pub fn from_seed(seed: &[u8; 32]) -> Result<Self, GatewayError> {
        let key_pair = Ed25519KeyPair::from_seed_unchecked(seed)
            .map_err(|e| GatewayError::Internal(format!("Invalid Ed25519 seed: {e}")))?;

        let public_key_bytes = key_pair.public_key().as_ref().to_vec();

        Ok(Self {
            key_pair: Arc::new(key_pair),
            public_key_bytes,
        })
    }

    /// Returns the public key bytes for distribution to clients.
    pub fn public_key_bytes(&self) -> &[u8] {
        &self.public_key_bytes
    }

    /// Returns the base64-encoded public key.
    pub fn public_key_base64(&self) -> String {
        URL_SAFE_NO_PAD.encode(&self.public_key_bytes)
    }

    /// Mints a signed License JWT for the given claims.
    pub fn mint_license_jwt(&self, claims: &LicenseClaims) -> Result<String, GatewayError> {
        let header = JwtHeader {
            alg: "EdDSA".to_string(),
            typ: "JWT".to_string(),
        };

        let header_json = serde_json::to_string(&header)
            .map_err(|e| GatewayError::Internal(format!("Header serialize: {e}")))?;
        let claims_json = serde_json::to_string(claims)
            .map_err(|e| GatewayError::Internal(format!("Claims serialize: {e}")))?;

        let header_b64 = URL_SAFE_NO_PAD.encode(header_json.as_bytes());
        let claims_b64 = URL_SAFE_NO_PAD.encode(claims_json.as_bytes());

        let signing_input = format!("{header_b64}.{claims_b64}");
        let sig = self.key_pair.sign(signing_input.as_bytes());
        let sig_b64 = URL_SAFE_NO_PAD.encode(sig.as_ref());

        Ok(format!("{signing_input}.{sig_b64}"))
    }

    /// Verifies a signed License JWT against the provided public key bytes and checks expiration.
    pub fn verify_jwt(token: &str, public_key_bytes: &[u8]) -> Result<LicenseClaims, GatewayError> {
        let parts: Vec<&str> = token.split('.').collect();
        if parts.len() != 3 {
            return Err(GatewayError::InvalidToken(
                "Malformed JWT: expected 3 parts".to_string(),
            ));
        }

        let signing_input = format!("{}.{}", parts[0], parts[1]);
        let sig_bytes = URL_SAFE_NO_PAD
            .decode(parts[2])
            .map_err(|e| GatewayError::InvalidToken(format!("Invalid signature base64: {e}")))?;

        let peer_public_key =
            signature::UnparsedPublicKey::new(&signature::ED25519, public_key_bytes);

        peer_public_key
            .verify(signing_input.as_bytes(), &sig_bytes)
            .map_err(|_| {
                GatewayError::InvalidToken("Ed25519 signature verification failed".to_string())
            })?;

        let claims_bytes = URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|e| GatewayError::InvalidToken(format!("Invalid claims base64: {e}")))?;

        let claims: LicenseClaims = serde_json::from_slice(&claims_bytes)
            .map_err(|e| GatewayError::InvalidToken(format!("Malformed claims JSON: {e}")))?;

        let now = chrono::Utc::now().timestamp();
        if claims.exp < now {
            return Err(GatewayError::LicenseExpired(claims.sub));
        }

        Ok(claims)
    }

    /// Verifies a signed License JWT using this authority's own public key.
    pub fn verify_own_jwt(&self, token: &str) -> Result<LicenseClaims, GatewayError> {
        Self::verify_jwt(token, &self.public_key_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_jwt_mint_and_verify_success() {
        let authority = LicenseAuthority::generate().unwrap();
        let now = chrono::Utc::now().timestamp();

        let claims = LicenseClaims {
            sub: "usr_99887766-5544-3322-1100-aabbccddeeff".to_string(),
            email: "alice@example.com".to_string(),
            stripe_customer_id: "cus_test_12345".to_string(),
            tier: "pro".to_string(),
            iat: now,
            exp: now + 86400, // Valid for 24h
        };

        let jwt = authority.mint_license_jwt(&claims).unwrap();
        assert_eq!(jwt.split('.').count(), 3);

        let decoded = authority.verify_own_jwt(&jwt).unwrap();
        assert_eq!(decoded, claims);
    }

    #[test]
    fn test_jwt_tampered_payload_fails() {
        let authority = LicenseAuthority::generate().unwrap();
        let now = chrono::Utc::now().timestamp();

        let claims = LicenseClaims {
            sub: "usr_1111".to_string(),
            email: "bob@example.com".to_string(),
            stripe_customer_id: "cus_111".to_string(),
            tier: "starter".to_string(),
            iat: now,
            exp: now + 3600,
        };

        let jwt = authority.mint_license_jwt(&claims).unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();

        // Tamper with payload
        let tampered_payload = URL_SAFE_NO_PAD.encode(b"{\"sub\":\"usr_hacker\",\"tier\":\"enterprise\"}");
        let tampered_jwt = format!("{}.{}.{}", parts[0], tampered_payload, parts[2]);

        let result = authority.verify_own_jwt(&tampered_jwt);
        assert!(matches!(result, Err(GatewayError::InvalidToken(_))));
    }

    #[test]
    fn test_jwt_expired_fails() {
        let authority = LicenseAuthority::generate().unwrap();
        let past = chrono::Utc::now().timestamp() - 100;

        let claims = LicenseClaims {
            sub: "usr_expired".to_string(),
            email: "charlie@example.com".to_string(),
            stripe_customer_id: "cus_expired".to_string(),
            tier: "pro".to_string(),
            iat: past - 3600,
            exp: past,
        };

        let jwt = authority.mint_license_jwt(&claims).unwrap();
        let result = authority.verify_own_jwt(&jwt);
        assert!(matches!(result, Err(GatewayError::LicenseExpired(_))));
    }
}
