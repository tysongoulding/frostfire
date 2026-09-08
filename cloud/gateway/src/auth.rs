use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tonic::metadata::MetadataMap;
use tonic::Status;

/// Default dev tenant token for local development and test harnesses.
pub const DEFAULT_DEV_TENANT_TOKEN: &str = "frostfire-dev-tenant-secret";

/// Standard authorization header name.
pub const AUTH_HEADER_BEARER: &str = "authorization";

/// Sand window owner header name (used in display and tunnel routes).
pub const AUTH_HEADER_WINDOW_OWNER: &str = "x-sand-window-owner";

/// Standard unauthenticated status message as specified in contracts.
pub const UNAUTHENTICATED_MSG: &str = "invalid or missing tenant token";

/// Constant-time tenant token authenticator using SHA-256 pre-hashing and subtle::ConstantTimeEq.
#[derive(Debug, Clone)]
pub struct TenantAuthenticator {
    expected_token_hash: [u8; 32],
}

impl TenantAuthenticator {
    /// Creates a new authenticator with the specified expected tenant token.
    /// The token is immediately pre-hashed with SHA-256 so comparison is always 32 bytes.
    pub fn new(expected_token: impl AsRef<str>) -> Self {
        let hash: [u8; 32] = Sha256::digest(expected_token.as_ref().as_bytes()).into();
        Self {
            expected_token_hash: hash,
        }
    }

    /// Creates an authenticator reading from FROSTFIRE_TENANT_TOKEN environment variable,
    /// defaulting to DEFAULT_DEV_TENANT_TOKEN if unset or empty.
    pub fn from_env_or_default() -> Self {
        let token = std::env::var("FROSTFIRE_TENANT_TOKEN")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_DEV_TENANT_TOKEN.to_string());
        Self::new(token)
    }

    /// Validates a candidate token string against the expected token in constant time.
    ///
    /// Pre-hashes the candidate with SHA-256 into a 32-byte digest before comparing
    /// via subtle::ConstantTimeEq. This ensures the byte-by-byte comparison is
    /// constant time and avoids leaking the expected token's length through timing.
    pub fn validate_token(&self, candidate: &str) -> bool {
        if candidate.is_empty() {
            return false;
        }
        let candidate_hash: [u8; 32] = Sha256::digest(candidate.as_bytes()).into();
        let ct_result = self.expected_token_hash.ct_eq(&candidate_hash);
        ct_result.into()
    }

    /// Authenticates an incoming gRPC request's metadata map.
    ///
    /// Checks:
    /// 1. `authorization: Bearer <token>` or `authorization: <token>`
    /// 2. `x-sand-window-owner: <token>`
    ///
    /// If either header provides a matching token, returns `Ok(())`.
    /// Otherwise returns `tonic::Status::unauthenticated("invalid or missing tenant token")`.
    #[allow(clippy::result_large_err)]
    pub fn authenticate_metadata(&self, metadata: &MetadataMap) -> Result<(), Status> {
        // 1. Check authorization header
        if let Some(auth_val) = metadata.get(AUTH_HEADER_BEARER) {
            if let Ok(auth_str) = auth_val.to_str() {
                let token = extract_bearer_token(auth_str);
                if self.validate_token(token) {
                    return Ok(());
                }
            }
        }

        // 2. Check x-sand-window-owner header
        if let Some(owner_val) = metadata.get(AUTH_HEADER_WINDOW_OWNER) {
            if let Ok(owner_str) = owner_val.to_str() {
                let token = owner_str.trim();
                if self.validate_token(token) {
                    return Ok(());
                }
            }
        }

        Err(Status::unauthenticated(UNAUTHENTICATED_MSG))
    }
}

impl Default for TenantAuthenticator {
    fn default() -> Self {
        Self::new(DEFAULT_DEV_TENANT_TOKEN)
    }
}

/// Extracts the token portion from an Authorization header value.
/// Handles Bearer <token>, bearer <token>, BEARER <token>, or a raw token.
pub fn extract_bearer_token(auth_header: &str) -> &str {
    let trimmed_leading = auth_header.trim_start();
    if let Some(prefix) = trimmed_leading.get(..7) {
        if prefix.eq_ignore_ascii_case("bearer ") {
            return trimmed_leading[7..].trim();
        }
    }
    auth_header.trim()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tonic::metadata::MetadataValue;

    #[test]
    fn test_constant_time_token_validation_matches() {
        let auth = TenantAuthenticator::new("secret-tenant-token-12345");
        assert!(auth.validate_token("secret-tenant-token-12345"));
        assert!(!auth.validate_token("secret-tenant-token-12346"));
        assert!(!auth.validate_token("wrong-token"));
        assert!(!auth.validate_token(""));
    }

    #[test]
    fn test_timing_safety_different_lengths() {
        let auth = TenantAuthenticator::new("short");
        assert!(auth.validate_token("short"));
        assert!(!auth.validate_token("very-long-token-that-is-much-longer-than-short"));
        assert!(!auth.validate_token("s"));
    }

    #[test]
    fn test_extract_bearer_token_variants() {
        assert_eq!(extract_bearer_token("Bearer my-token"), "my-token");
        assert_eq!(extract_bearer_token("bearer my-token"), "my-token");
        assert_eq!(extract_bearer_token("BEARER my-token"), "my-token");
        assert_eq!(extract_bearer_token("  Bearer   spaced-token  "), "spaced-token");
        assert_eq!(extract_bearer_token("raw-token-without-bearer"), "raw-token-without-bearer");
    }

    #[test]
    fn test_extract_bearer_token_utf8_char_boundaries() {
        assert_eq!(extract_bearer_token("123456\u{00E9}"), "123456\u{00E9}");
        assert_eq!(extract_bearer_token("abcdef\u{00E9}"), "abcdef\u{00E9}");
        assert_eq!(extract_bearer_token("1234\u{1F600}"), "1234\u{1F600}");
        assert_eq!(extract_bearer_token("12345\u{4E2D}"), "12345\u{4E2D}");
        assert_eq!(extract_bearer_token(" \u{1F600}abc"), "\u{1F600}abc");
        assert_eq!(extract_bearer_token("b\u{1F600}xyz"), "b\u{1F600}xyz");
        assert_eq!(
            extract_bearer_token("\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{00E9}"),
            "\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{00E9}"
        );
    }

    #[test]
    fn test_extract_bearer_token_edge_cases() {
        assert_eq!(extract_bearer_token("Bearer "), "");
        assert_eq!(extract_bearer_token("Bearer"), "Bearer");
        assert_eq!(extract_bearer_token("bearer  token"), "token");
        assert_eq!(extract_bearer_token("Bearer \u{1F600}"), "\u{1F600}");
        assert_eq!(extract_bearer_token("bearer \u{00E9}"), "\u{00E9}");
        assert_eq!(extract_bearer_token("   Bearer   "), "");
        assert_eq!(extract_bearer_token(""), "");
        assert_eq!(extract_bearer_token("   "), "");
    }

    #[test]
    fn test_authenticate_metadata_bearer() {
        let auth = TenantAuthenticator::new("test-token-xyz");
        let mut map = MetadataMap::new();
        map.insert(
            AUTH_HEADER_BEARER,
            MetadataValue::from_static("Bearer test-token-xyz"),
        );

        assert!(auth.authenticate_metadata(&map).is_ok());
    }

    #[test]
    fn test_authenticate_metadata_window_owner() {
        let auth = TenantAuthenticator::new("test-token-xyz");
        let mut map = MetadataMap::new();
        map.insert(
            AUTH_HEADER_WINDOW_OWNER,
            MetadataValue::from_static("test-token-xyz"),
        );

        assert!(auth.authenticate_metadata(&map).is_ok());
    }

    #[test]
    fn test_authenticate_metadata_rejects_invalid() {
        let auth = TenantAuthenticator::new("test-token-xyz");
        let mut map = MetadataMap::new();
        map.insert(
            AUTH_HEADER_BEARER,
            MetadataValue::from_static("Bearer wrong-token"),
        );

        let err = auth.authenticate_metadata(&map).unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
        assert_eq!(err.message(), UNAUTHENTICATED_MSG);
    }

    #[test]
    fn test_authenticate_metadata_rejects_missing() {
        let auth = TenantAuthenticator::new("test-token-xyz");
        let map = MetadataMap::new();

        let err = auth.authenticate_metadata(&map).unwrap_err();
        assert_eq!(err.code(), tonic::Code::Unauthenticated);
        assert_eq!(err.message(), UNAUTHENTICATED_MSG);
    }
}
