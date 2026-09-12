use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
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
