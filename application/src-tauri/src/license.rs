use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::keystore::SecureKeystore;

pub const LICENSE_SECRET_KEY: &str = "frostfire_license_jwt";
pub const SPEND_CAP_KEY: &str = "frostfire_user_spend_cap";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LicenseInfo {
    pub user_uuid: String,
    pub email: String,
    pub stripe_customer_id: String,
    pub tier: String,
    pub expires_at: i64,
    pub is_valid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BillingStatus {
    pub user_uuid: String,
    pub tier: String,
    pub included_credits_micro_cents: i64,
    pub current_balance_micro_cents: i64,
    pub unbilled_tokens: i64,
    pub unbilled_micro_cents: i64,
    pub spend_cap_micro_cents: i64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLicenseClaims {
    pub sub: String,
    pub email: String,
    pub stripe_customer_id: String,
    pub tier: String,
    pub iat: i64,
    pub exp: i64,
}

/// Parses and validates claims from a 3-part Ed25519 JWT string.
pub fn parse_jwt_claims(token: &str) -> Result<RawLicenseClaims, String> {
    let parts: Vec<&str> = token.trim().split('.').collect();
    if parts.len() != 3 {
        return Err("Invalid token format: expected header.payload.signature".to_string());
    }

    let claims_bytes = URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|e| format!("Invalid base64 payload: {e}"))?;

    let claims: RawLicenseClaims = serde_json::from_slice(&claims_bytes)
        .map_err(|e| format!("Invalid JSON claims in token payload: {e}"))?;

    let now = chrono::Utc::now().timestamp();
    if claims.exp < now {
        return Err(format!(
            "License has expired (expired at {}, current time {})",
            claims.exp, now
        ));
    }

    Ok(claims)
}

/// Activates a license token, storing it securely in the OS keystore.
pub async fn activate_license(
    token: &str,
    keystore: &SecureKeystore,
) -> Result<LicenseInfo, String> {
    let claims = parse_jwt_claims(token)?;

    // Store in OS credential vault (DPAPI / Keychain)
    keystore
        .set_secret(LICENSE_SECRET_KEY, token.trim())
        .await
        .map_err(|e| format!("Failed to store license in keystore: {e}"))?;

    Ok(LicenseInfo {
        user_uuid: claims.sub,
        email: claims.email,
        stripe_customer_id: claims.stripe_customer_id,
        tier: claims.tier,
        expires_at: claims.exp,
        is_valid: true,
    })
}

/// Retrieves the active license from the OS keystore.
pub async fn get_active_license(
    keystore: &SecureKeystore,
) -> Result<Option<LicenseInfo>, String> {
    let secret = match keystore.get_secret(LICENSE_SECRET_KEY).await {
        Ok(Some(s)) => s,
        Ok(None) => return Ok(None),
        Err(e) => return Err(format!("Keystore error: {e}")),
    };

    match parse_jwt_claims(&secret) {
        Ok(claims) => Ok(Some(LicenseInfo {
            user_uuid: claims.sub,
            email: claims.email,
            stripe_customer_id: claims.stripe_customer_id,
            tier: claims.tier,
            expires_at: claims.exp,
            is_valid: true,
        })),
        Err(_) => {
            // Token is invalid or expired
            Ok(None)
        }
    }
}

/// Deactivates and removes the license token from the OS keystore.
pub async fn deactivate_license(keystore: &SecureKeystore) -> Result<(), String> {
    keystore
        .delete_secret(LICENSE_SECRET_KEY)
        .await
        .map_err(|e| format!("Failed to remove license from keystore: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_jwt_claims() {
        let now = chrono::Utc::now().timestamp();
        let payload = format!(
            r#"{{"sub":"usr_test_123","email":"dev@example.com","stripe_customer_id":"cus_123","tier":"pro","iat":{},"exp":{}}}"#,
            now,
            now + 86400
        );
        let header = "eyJhbGciOiJFZERTQSIidHlwIjoiSldUIn0";
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let sig_b64 = "fake_signature_bytes_for_testing";

        let token = format!("{header}.{payload_b64}.{sig_b64}");
        let claims = parse_jwt_claims(&token).unwrap();
        assert_eq!(claims.sub, "usr_test_123");
        assert_eq!(claims.email, "dev@example.com");
        assert_eq!(claims.tier, "pro");
    }

    #[test]
    fn test_parse_expired_jwt_claims_fails() {
        let past = chrono::Utc::now().timestamp() - 100;
        let payload = format!(
            r#"{{"sub":"usr_test_123","email":"dev@example.com","stripe_customer_id":"cus_123","tier":"pro","iat":{},"exp":{}}}"#,
            past - 1000,
            past
        );
        let header = "eyJhbGciOiJFZERTQSIidHlwIjoiSldUIn0";
        let payload_b64 = URL_SAFE_NO_PAD.encode(payload.as_bytes());
        let sig_b64 = "fake_signature";

        let token = format!("{header}.{payload_b64}.{sig_b64}");
        let err = parse_jwt_claims(&token).unwrap_err();
        assert!(err.contains("expired"));
    }
}
