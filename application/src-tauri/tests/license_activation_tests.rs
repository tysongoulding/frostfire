use frostfire_gateway::{LicenseAuthority, LicenseClaims};
use frostfire_os_lib::keystore::SecureKeystore;
use frostfire_os_lib::license::{
    activate_license, deactivate_license, get_active_license, parse_jwt_claims,
};

#[tokio::test]
async fn test_activate_valid_license_jwt() {
    let authority = LicenseAuthority::generate().unwrap();
    let now = chrono::Utc::now().timestamp();
    let keystore = SecureKeystore::new();

    let claims = LicenseClaims {
        sub: "usr_active_developer_uuid".to_string(),
        email: "dev@frostfire.cloud".to_string(),
        stripe_customer_id: "cus_live_9999".to_string(),
        tier: "pro".to_string(),
        iat: now,
        exp: now + 30 * 86400,
    };

    let token = authority.mint_license_jwt(&claims).unwrap();

    // 1. Activate
    let activated = activate_license(&token, &keystore).await.unwrap();
    assert_eq!(activated.user_uuid, "usr_active_developer_uuid");
    assert_eq!(activated.email, "dev@frostfire.cloud");
    assert_eq!(activated.stripe_customer_id, "cus_live_9999");
    assert_eq!(activated.tier, "pro");
    assert!(activated.is_valid);

    // 2. Fetch active license from keystore
    let active = get_active_license(&keystore).await.unwrap().unwrap();
    assert_eq!(active.user_uuid, "usr_active_developer_uuid");
    assert_eq!(active.email, "dev@frostfire.cloud");
    assert_eq!(active.tier, "pro");
    assert!(active.is_valid);
}

#[tokio::test]
async fn test_activate_expired_license_jwt_rejected() {
    let authority = LicenseAuthority::generate().unwrap();
    let past = chrono::Utc::now().timestamp() - 200;
    let keystore = SecureKeystore::new();

    let claims = LicenseClaims {
        sub: "usr_expired".to_string(),
        email: "expired@frostfire.cloud".to_string(),
        stripe_customer_id: "cus_expired".to_string(),
        tier: "pro".to_string(),
        iat: past - 3600,
        exp: past,
    };

    let token = authority.mint_license_jwt(&claims).unwrap();
    let result = activate_license(&token, &keystore).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("expired"));
}

#[tokio::test]
async fn test_deactivate_license() {
    let authority = LicenseAuthority::generate().unwrap();
    let now = chrono::Utc::now().timestamp();
    let keystore = SecureKeystore::new();

    let claims = LicenseClaims {
        sub: "usr_deactivate_test".to_string(),
        email: "leave@frostfire.cloud".to_string(),
        stripe_customer_id: "cus_leave".to_string(),
        tier: "pro".to_string(),
        iat: now,
        exp: now + 86400,
    };

    let token = authority.mint_license_jwt(&claims).unwrap();
    activate_license(&token, &keystore).await.unwrap();

    let active_before = get_active_license(&keystore).await.unwrap();
    assert!(active_before.is_some());

    // Deactivate
    deactivate_license(&keystore).await.unwrap();

    let active_after = get_active_license(&keystore).await.unwrap();
    assert!(active_after.is_none());
}

#[test]
fn test_parse_malformed_token_rejected() {
    let bad_tokens = [
        "not-even-a-jwt",
        "header.only",
        "header.bad_base64_payload.sig",
    ];

    for tok in bad_tokens {
        let res = parse_jwt_claims(tok);
        assert!(res.is_err());
    }
}
