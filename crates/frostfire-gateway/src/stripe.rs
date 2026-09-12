use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use sha2::Digest;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::GatewayError;
use crate::metering::CreditStorage;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StripeMeterEvent {
    pub event_name: String,
    pub customer_id: String,
    pub value: i64,
    pub identifier: String,
    pub created_at: i64,
}

#[async_trait]
pub trait StripeMeterClient: Send + Sync {
    async fn report_meter_event(
        &self,
        customer_id: &str,
        value: i64,
        identifier: &str,
    ) -> Result<(), String>;
}

/// In-memory mock Stripe Meter client for hermetic unit testing.
#[derive(Debug, Default, Clone)]
pub struct MockStripeClient {
    pub events: Arc<Mutex<Vec<StripeMeterEvent>>>,
    pub should_fail: Arc<Mutex<bool>>,
}

impl MockStripeClient {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn set_fail(&self, fail: bool) {
        let mut guard = self.should_fail.lock().await;
        *guard = fail;
    }

    pub async fn get_events(&self) -> Vec<StripeMeterEvent> {
        let guard = self.events.lock().await;
        guard.clone()
    }
}

#[async_trait]
impl StripeMeterClient for MockStripeClient {
    async fn report_meter_event(
        &self,
        customer_id: &str,
        value: i64,
        identifier: &str,
    ) -> Result<(), String> {
        let fail = *self.should_fail.lock().await;
        if fail {
            return Err("Mock Stripe API 500 error".to_string());
        }

        let mut guard = self.events.lock().await;
        guard.push(StripeMeterEvent {
            event_name: "frostfire_compute_tokens".to_string(),
            customer_id: customer_id.to_string(),
            value,
            identifier: identifier.to_string(),
            created_at: chrono::Utc::now().timestamp(),
        });

        Ok(())
    }
}

/// 60-Second Stripe Billing Flusher and Saga Refund Coordinator.
pub struct StripeBillingFlusher {
    storage: Arc<dyn CreditStorage>,
    client: Arc<dyn StripeMeterClient>,
    tenant_customers: Arc<Mutex<HashMap<String, String>>>,
}

impl StripeBillingFlusher {
    pub fn new(storage: Arc<dyn CreditStorage>, client: Arc<dyn StripeMeterClient>) -> Self {
        Self {
            storage,
            client,
            tenant_customers: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn register_tenant_customer(&self, tenant_id: &str, stripe_customer_id: &str) {
        let mut guard = self.tenant_customers.lock().await;
        guard.insert(tenant_id.to_string(), stripe_customer_id.to_string());
    }

    /// Executes one cycle of the billing flusher.
    pub async fn flush_once(&self) -> Result<usize, GatewayError> {
        let dirty_tenants = self.storage.rotate_dirty_tenants().await?;
        let mut successful_flushes = 0;

        for tenant_id in dirty_tenants {
            let unbilled = self.storage.get_unbilled(&tenant_id).await?;
            if unbilled.total_micro_cents <= 0 {
                continue;
            }

            let customer_id = {
                let guard = self.tenant_customers.lock().await;
                guard.get(&tenant_id).cloned().unwrap_or_else(|| format!("cus_{tenant_id}"))
            };

            let event_id = format!("evt_{}", Uuid::new_v4().simple());
            match self
                .client
                .report_meter_event(&customer_id, unbilled.total_micro_cents, &event_id)
                .await
            {
                Ok(()) => {
                    self.storage.record_flushed_usage(&tenant_id, &unbilled).await?;
                    successful_flushes += 1;
                }
                Err(err) => {
                    tracing::error!(%tenant_id, %err, "Failed to flush Stripe meter event; will retry");
                }
            }
        }

        Ok(successful_flushes)
    }

    /// Saga compensation: refund unbilled tokens and restore balance if upstream turn fails.
    pub async fn refund_failed_turn(&self, tenant_id: &str, cost_micro_cents: i64) -> Result<(), GatewayError> {
        self.storage.refund_usage(tenant_id, cost_micro_cents).await
    }
}

// Pricing defaults in micro-cents ($1.00 = 100_000_000 micro-cents)
pub const DEFAULT_BASE_PRICE_CENTS: i64 = 2000; // $20.00
pub const DEFAULT_INCLUDED_CREDITS_MICRO_CENTS: i64 = 1_000_000_000; // $10.00
pub const DEFAULT_SPEND_CAP_MICRO_CENTS: i64 = 5_000_000_000; // $50.00

pub fn get_included_credits_micro_cents() -> i64 {
    std::env::var("GATEWAY_INCLUDED_CREDITS_CENTS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .map(|cents| cents * 100_000_000 / 100)
        .unwrap_or(DEFAULT_INCLUDED_CREDITS_MICRO_CENTS)
}

pub fn get_default_spend_cap_micro_cents() -> i64 {
    std::env::var("GATEWAY_DEFAULT_SPEND_CAP_CENTS")
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
        .map(|cents| cents * 100_000_000 / 100)
        .unwrap_or(DEFAULT_SPEND_CAP_MICRO_CENTS)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WebhookResult {
    AccountProvisioned {
        user_uuid: String,
        license_jwt: String,
    },
    SubscriptionUpdated {
        user_uuid: String,
        status: String,
    },
    SubscriptionCanceled {
        user_uuid: String,
    },
    InvoicePaid {
        user_uuid: String,
        refreshed_credits: i64,
    },
    PaymentFailed {
        user_uuid: String,
    },
    IgnoredDuplicate,
    IgnoredEventType(String),
}

/// Webhook and account lifecycle coordinator for Stripe.
pub struct StripeWebhookHandler {
    storage: Arc<dyn CreditStorage>,
    db: crate::db::AccountDatabase,
    authority: crate::auth::LicenseAuthority,
}

impl StripeWebhookHandler {
    pub fn new(
        storage: Arc<dyn CreditStorage>,
        db: crate::db::AccountDatabase,
        authority: crate::auth::LicenseAuthority,
    ) -> Self {
        Self {
            storage,
            db,
            authority,
        }
    }

    /// Processes an incoming raw Stripe webhook payload idempotently.
    pub async fn handle_webhook_payload(&self, payload_json: &str) -> Result<WebhookResult, GatewayError> {
        let v: serde_json::Value = serde_json::from_str(payload_json)
            .map_err(|e| GatewayError::StripeError(format!("Invalid webhook JSON: {e}")))?;

        let event_id = v
            .get("id")
            .and_then(|x| x.as_str())
            .ok_or_else(|| GatewayError::StripeError("Missing event id".to_string()))?;

        let event_type = v
            .get("type")
            .and_then(|x| x.as_str())
            .ok_or_else(|| GatewayError::StripeError("Missing event type".to_string()))?;

        // Idempotency gate via SQLite ledger
        let is_new = self.db.record_stripe_event(event_id, event_type, payload_json)?;
        if !is_new {
            tracing::info!(%event_id, "Ignoring duplicate Stripe webhook event");
            return Ok(WebhookResult::IgnoredDuplicate);
        }

        let data_object = v
            .get("data")
            .and_then(|d| d.get("object"))
            .ok_or_else(|| GatewayError::StripeError("Missing data.object in webhook".to_string()))?;

        match event_type {
            "checkout.session.completed" => {
                let customer_id = data_object
                    .get("customer")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();

                let customer_email = data_object
                    .get("customer_details")
                    .and_then(|cd| cd.get("email"))
                    .and_then(|e| e.as_str())
                    .or_else(|| data_object.get("customer_email").and_then(|e| e.as_str()))
                    .unwrap_or("user@frostfire.cloud")
                    .to_string();

                let subscription_id = data_object
                    .get("subscription")
                    .and_then(|s| s.as_str())
                    .map(|s| s.to_string());

                // Check for metadata user_uuid or mint a fresh canonical v4 UUID
                let user_uuid = data_object
                    .get("metadata")
                    .and_then(|m| m.get("user_uuid"))
                    .and_then(|u| u.as_str())
                    .map(|u| u.to_string())
                    .unwrap_or_else(|| format!("usr_{}", Uuid::new_v4()));

                let now = chrono::Utc::now().timestamp();
                let included_credits = get_included_credits_micro_cents();
                let default_cap = get_default_spend_cap_micro_cents();

                let account = crate::db::UserAccount {
                    user_uuid: user_uuid.clone(),
                    email: customer_email.clone(),
                    stripe_customer_id: customer_id.clone(),
                    stripe_subscription_id: subscription_id,
                    tier: "pro".to_string(),
                    status: "active".to_string(),
                    spend_cap_micro_cents: default_cap,
                    created_at: now,
                    updated_at: now,
                };

                // 1. Store durable account in SQLite
                self.db.upsert_account(&account)?;

                // 2. Initialize Redis credit storage with included token balance
                self.storage.register_tenant(&user_uuid, included_credits).await?;

                // 3. Mint Ed25519-signed License JWT valid for 30 days
                let claims = crate::auth::LicenseClaims {
                    sub: user_uuid.clone(),
                    email: customer_email,
                    stripe_customer_id: customer_id,
                    tier: "pro".to_string(),
                    iat: now,
                    exp: now + 30 * 86400,
                };
                let license_jwt = self.authority.mint_license_jwt(&claims)?;

                // 4. Audit log the issuance
                let token_hash = format!("{:x}", sha2::Sha256::digest(license_jwt.as_bytes()));
                self.db.record_license_audit(&user_uuid, &token_hash, claims.exp)?;

                Ok(WebhookResult::AccountProvisioned {
                    user_uuid,
                    license_jwt,
                })
            }

            "customer.subscription.updated" => {
                let customer_id = data_object
                    .get("customer")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");

                let sub_id = data_object
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("");

                let status = data_object
                    .get("status")
                    .and_then(|s| s.as_str())
                    .unwrap_or("active");

                if let Some(account) = self.db.get_account_by_stripe_customer(customer_id)? {
                    self.db.update_subscription(&account.user_uuid, sub_id, status, &account.tier)?;
                    Ok(WebhookResult::SubscriptionUpdated {
                        user_uuid: account.user_uuid,
                        status: status.to_string(),
                    })
                } else {
                    Err(GatewayError::TenantNotFound(format!("Stripe customer: {customer_id}")))
                }
            }

            "customer.subscription.deleted" => {
                let customer_id = data_object
                    .get("customer")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");

                if let Some(account) = self.db.get_account_by_stripe_customer(customer_id)? {
                    self.db.update_subscription(&account.user_uuid, "", "canceled", &account.tier)?;
                    Ok(WebhookResult::SubscriptionCanceled {
                        user_uuid: account.user_uuid,
                    })
                } else {
                    Err(GatewayError::TenantNotFound(format!("Stripe customer: {customer_id}")))
                }
            }

            "invoice.payment_succeeded" => {
                let customer_id = data_object
                    .get("customer")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");

                let billing_reason = data_object
                    .get("billing_reason")
                    .and_then(|r| r.as_str())
                    .unwrap_or("");

                if let Some(account) = self.db.get_account_by_stripe_customer(customer_id)? {
                    let mut refreshed = 0;
                    if billing_reason == "subscription_cycle" {
                        let included = get_included_credits_micro_cents();
                        self.storage.add_credits(&account.user_uuid, included).await?;
                        refreshed = included;
                    }

                    self.db.update_subscription(
                        &account.user_uuid,
                        account.stripe_subscription_id.as_deref().unwrap_or(""),
                        "active",
                        &account.tier,
                    )?;

                    Ok(WebhookResult::InvoicePaid {
                        user_uuid: account.user_uuid,
                        refreshed_credits: refreshed,
                    })
                } else {
                    Err(GatewayError::TenantNotFound(format!("Stripe customer: {customer_id}")))
                }
            }

            "invoice.payment_failed" => {
                let customer_id = data_object
                    .get("customer")
                    .and_then(|c| c.as_str())
                    .unwrap_or("");

                if let Some(account) = self.db.get_account_by_stripe_customer(customer_id)? {
                    self.db.update_subscription(
                        &account.user_uuid,
                        account.stripe_subscription_id.as_deref().unwrap_or(""),
                        "past_due",
                        &account.tier,
                    )?;

                    Ok(WebhookResult::PaymentFailed {
                        user_uuid: account.user_uuid,
                    })
                } else {
                    Err(GatewayError::TenantNotFound(format!("Stripe customer: {customer_id}")))
                }
            }

            other => Ok(WebhookResult::IgnoredEventType(other.to_string())),
        }
    }
}
