use frostfire_gateway::{
    AccountDatabase, CreditStorage, InMemoryCreditStore, LicenseAuthority, LicenseClaims,
    StripeWebhookHandler, WebhookResult, DEFAULT_INCLUDED_CREDITS_MICRO_CENTS,
    DEFAULT_SPEND_CAP_MICRO_CENTS,
};
use std::sync::Arc;

#[tokio::test]
async fn test_license_jwt_mint_and_verify_roundtrip() {
    let authority = LicenseAuthority::generate().unwrap();
    let now = chrono::Utc::now().timestamp();

    let claims = LicenseClaims {
        sub: "usr_550e8400-e29b-41d4-a716-446655440000".to_string(),
        email: "engineer@company.com".to_string(),
        stripe_customer_id: "cus_pro_123".to_string(),
        tier: "pro".to_string(),
        iat: now,
        exp: now + 30 * 86400,
    };

    let token = authority.mint_license_jwt(&claims).unwrap();
    let verified = authority.verify_own_jwt(&token).unwrap();

    assert_eq!(verified.sub, claims.sub);
    assert_eq!(verified.email, claims.email);
    assert_eq!(verified.stripe_customer_id, claims.stripe_customer_id);
    assert_eq!(verified.tier, claims.tier);
}

#[tokio::test]
async fn test_stripe_checkout_completion_provisions_account_and_redis_credits() {
    let storage = Arc::new(InMemoryCreditStore::new());
    let db = AccountDatabase::open_in_memory().unwrap();
    let authority = LicenseAuthority::generate().unwrap();
    let handler = StripeWebhookHandler::new(storage.clone(), db.clone(), authority.clone());

    let payload = r#"{
        "id": "evt_checkout_success_001",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": "cus_stripe_abc123",
                "customer_details": { "email": "tyson@frostfire.cloud" },
                "subscription": "sub_stripe_sub456",
                "metadata": {
                    "user_uuid": "usr_9988-aabb-ccdd"
                }
            }
        }
    }"#;

    let res = handler.handle_webhook_payload(payload).await.unwrap();

    match res {
        WebhookResult::AccountProvisioned {
            user_uuid,
            license_jwt,
        } => {
            assert_eq!(user_uuid, "usr_9988-aabb-ccdd");

            // 1. Verify DB record
            let account = db.get_account_by_uuid(&user_uuid).unwrap().unwrap();
            assert_eq!(account.email, "tyson@frostfire.cloud");
            assert_eq!(account.stripe_customer_id, "cus_stripe_abc123");
            assert_eq!(account.status, "active");
            assert_eq!(account.tier, "pro");
            assert_eq!(account.spend_cap_micro_cents, DEFAULT_SPEND_CAP_MICRO_CENTS);

            // 2. Verify Redis credit balance initialized with $10.00
            let bal = storage.get_balance(&user_uuid).await.unwrap();
            assert_eq!(bal, DEFAULT_INCLUDED_CREDITS_MICRO_CENTS);

            // 3. Verify JWT authenticity
            let claims = authority.verify_own_jwt(&license_jwt).unwrap();
            assert_eq!(claims.sub, user_uuid);
            assert_eq!(claims.email, "tyson@frostfire.cloud");
            assert_eq!(claims.stripe_customer_id, "cus_stripe_abc123");
        }
        other => panic!("Expected AccountProvisioned, got {:?}", other),
    }

    // 4. Duplicate webhook must be ignored idempotently
    let dup_res = handler.handle_webhook_payload(payload).await.unwrap();
    assert!(matches!(dup_res, WebhookResult::IgnoredDuplicate));
}

#[tokio::test]
async fn test_stripe_subscription_deletion_and_payment_failure() {
    let storage = Arc::new(InMemoryCreditStore::new());
    let db = AccountDatabase::open_in_memory().unwrap();
    let authority = LicenseAuthority::generate().unwrap();
    let handler = StripeWebhookHandler::new(storage.clone(), db.clone(), authority.clone());

    // 1. Provision account
    let setup_payload = r#"{
        "id": "evt_setup_01",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": "cus_churn_test",
                "customer_details": { "email": "churn@example.com" },
                "subscription": "sub_active_1"
            }
        }
    }"#;
    let prov = handler.handle_webhook_payload(setup_payload).await.unwrap();
    let user_uuid = match prov {
        WebhookResult::AccountProvisioned { user_uuid, .. } => user_uuid,
        _ => panic!("Expected AccountProvisioned"),
    };

    // 2. Payment failed webhook
    let fail_payload = r#"{
        "id": "evt_fail_01",
        "type": "invoice.payment_failed",
        "data": {
            "object": {
                "customer": "cus_churn_test"
            }
        }
    }"#;
    let fail_res = handler.handle_webhook_payload(fail_payload).await.unwrap();
    assert!(matches!(fail_res, WebhookResult::PaymentFailed { .. }));
    let acct = db.get_account_by_uuid(&user_uuid).unwrap().unwrap();
    assert_eq!(acct.status, "past_due");

    // 3. Subscription deleted / canceled webhook
    let cancel_payload = r#"{
        "id": "evt_cancel_01",
        "type": "customer.subscription.deleted",
        "data": {
            "object": {
                "customer": "cus_churn_test"
            }
        }
    }"#;
    let cancel_res = handler.handle_webhook_payload(cancel_payload).await.unwrap();
    assert!(matches!(cancel_res, WebhookResult::SubscriptionCanceled { .. }));
    let acct_canceled = db.get_account_by_uuid(&user_uuid).unwrap().unwrap();
    assert_eq!(acct_canceled.status, "canceled");
}

#[tokio::test]
async fn test_monthly_invoice_payment_refreshes_included_credits() {
    let storage = Arc::new(InMemoryCreditStore::new());
    let db = AccountDatabase::open_in_memory().unwrap();
    let authority = LicenseAuthority::generate().unwrap();
    let handler = StripeWebhookHandler::new(storage.clone(), db.clone(), authority.clone());

    // Provision
    let setup_payload = r#"{
        "id": "evt_setup_refresh",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "customer": "cus_refresh_user",
                "customer_details": { "email": "monthly@example.com" },
                "subscription": "sub_cycle_1"
            }
        }
    }"#;
    let prov = handler.handle_webhook_payload(setup_payload).await.unwrap();
    let user_uuid = match prov {
        WebhookResult::AccountProvisioned { user_uuid, .. } => user_uuid,
        _ => panic!("Expected AccountProvisioned"),
    };

    // Simulate usage: deduct $5.00
    storage.deduct_tokens(&user_uuid, 500_000_000, 1000, 1000).await.unwrap();
    let bal_before = storage.get_balance(&user_uuid).await.unwrap();
    assert_eq!(bal_before, 500_000_000);

    // Monthly cycle payment succeeds
    let cycle_payload = r#"{
        "id": "evt_invoice_cycle_paid",
        "type": "invoice.payment_succeeded",
        "data": {
            "object": {
                "customer": "cus_refresh_user",
                "billing_reason": "subscription_cycle"
            }
        }
    }"#;

    let cycle_res = handler.handle_webhook_payload(cycle_payload).await.unwrap();
    match cycle_res {
        WebhookResult::InvoicePaid { refreshed_credits, .. } => {
            assert_eq!(refreshed_credits, DEFAULT_INCLUDED_CREDITS_MICRO_CENTS);
            let bal_after = storage.get_balance(&user_uuid).await.unwrap();
            assert_eq!(bal_after, 500_000_000 + DEFAULT_INCLUDED_CREDITS_MICRO_CENTS);
        }
        _ => panic!("Expected InvoicePaid"),
    }
}

#[tokio::test]
async fn test_spend_cap_enforcement_and_update() {
    let db = AccountDatabase::open_in_memory().unwrap();
    let now = chrono::Utc::now().timestamp();

    let account = frostfire_gateway::UserAccount {
        user_uuid: "usr_cap_test".to_string(),
        email: "cap@example.com".to_string(),
        stripe_customer_id: "cus_cap".to_string(),
        stripe_subscription_id: Some("sub_cap".to_string()),
        tier: "pro".to_string(),
        status: "active".to_string(),
        spend_cap_micro_cents: 5_000_000_000, // $50
        created_at: now,
        updated_at: now,
    };
    db.upsert_account(&account).unwrap();

    // Verify initial cap
    let initial = db.get_account_by_uuid("usr_cap_test").unwrap().unwrap();
    assert_eq!(initial.spend_cap_micro_cents, 5_000_000_000);

    // Update spend cap to $150.00
    db.update_spend_cap("usr_cap_test", 15_000_000_000).unwrap();
    let updated = db.get_account_by_uuid("usr_cap_test").unwrap().unwrap();
    assert_eq!(updated.spend_cap_micro_cents, 15_000_000_000);
}
