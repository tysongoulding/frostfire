use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::error::GatewayError;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TenantCreditRecord {
    pub balance: i64,
    pub reserved: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct UnbilledUsage {
    pub input: i64,
    pub output: i64,
    pub total_micro_cents: i64,
}

#[async_trait]
pub trait CreditStorage: Send + Sync {
    async fn register_tenant(&self, tenant_id: &str, initial_balance_micro_cents: i64) -> Result<(), GatewayError>;
    async fn get_balance(&self, tenant_id: &str) -> Result<i64, GatewayError>;
    async fn add_credits(&self, tenant_id: &str, amount_micro_cents: i64) -> Result<i64, GatewayError>;
    
    /// Executes the atomic token deduction logic corresponding to the Redis Lua script.
    ///
    /// Return semantics:
    /// - Ok(new_balance) when deduction succeeds
    /// - Err(GatewayError::TenantNotFound) if tenant is missing (-1 in Lua)
    /// - Err(GatewayError::InsufficientCredits) if balance < cost (-2 in Lua)
    async fn deduct_tokens(
        &self,
        tenant_id: &str,
        cost_micro_cents: i64,
        input_tokens: i64,
        output_tokens: i64,
    ) -> Result<i64, GatewayError>;

    async fn get_unbilled(&self, tenant_id: &str) -> Result<UnbilledUsage, GatewayError>;
    async fn rotate_dirty_tenants(&self) -> Result<Vec<String>, GatewayError>;
    async fn record_flushed_usage(&self, tenant_id: &str, flushed: &UnbilledUsage) -> Result<(), GatewayError>;
    async fn refund_usage(&self, tenant_id: &str, refund_micro_cents: i64) -> Result<(), GatewayError>;
}

/// In-memory implementation of the Redis credit & token deduction state machine.
#[derive(Debug, Default, Clone)]
pub struct InMemoryCreditStore {
    inner: Arc<RwLock<InMemoryCreditStoreInner>>,
}

#[derive(Debug, Default)]
struct InMemoryCreditStoreInner {
    credits: HashMap<String, TenantCreditRecord>,
    unbilled: HashMap<String, UnbilledUsage>,
    dirty_tenants: HashSet<String>,
    flushing_tenants: HashSet<String>,
}

impl InMemoryCreditStore {
    pub fn new() -> Self {
        Self::default()
    }
}

#[async_trait]
impl CreditStorage for InMemoryCreditStore {
    async fn register_tenant(&self, tenant_id: &str, initial_balance_micro_cents: i64) -> Result<(), GatewayError> {
        let mut guard = self.inner.write().await;
        guard.credits.insert(
            tenant_id.to_string(),
            TenantCreditRecord {
                balance: initial_balance_micro_cents,
                reserved: 0,
                updated_at: chrono::Utc::now().timestamp(),
            },
        );
        guard.unbilled.entry(tenant_id.to_string()).or_default();
        Ok(())
    }

    async fn get_balance(&self, tenant_id: &str) -> Result<i64, GatewayError> {
        let guard = self.inner.read().await;
        guard
            .credits
            .get(tenant_id)
            .map(|r| r.balance)
            .ok_or_else(|| GatewayError::TenantNotFound(tenant_id.to_string()))
    }

    async fn add_credits(&self, tenant_id: &str, amount_micro_cents: i64) -> Result<i64, GatewayError> {
        let mut guard = self.inner.write().await;
        let record = guard
            .credits
            .get_mut(tenant_id)
            .ok_or_else(|| GatewayError::TenantNotFound(tenant_id.to_string()))?;
        record.balance += amount_micro_cents;
        record.updated_at = chrono::Utc::now().timestamp();
        Ok(record.balance)
    }

    async fn deduct_tokens(
        &self,
        tenant_id: &str,
        cost_micro_cents: i64,
        input_tokens: i64,
        output_tokens: i64,
    ) -> Result<i64, GatewayError> {
        let mut guard = self.inner.write().await;
        let record = guard
            .credits
            .get_mut(tenant_id)
            .ok_or_else(|| GatewayError::TenantNotFound(tenant_id.to_string()))?;

        if record.balance < cost_micro_cents {
            return Err(GatewayError::InsufficientCredits(
                tenant_id.to_string(),
                cost_micro_cents,
                record.balance,
            ));
        }

        // Deduct cost from active balance
        record.balance -= cost_micro_cents;
        record.updated_at = chrono::Utc::now().timestamp();
        let new_bal = record.balance;

        // Accumulate unbilled tokens
        let unbilled = guard.unbilled.entry(tenant_id.to_string()).or_default();
        unbilled.input += input_tokens;
        unbilled.output += output_tokens;
        unbilled.total_micro_cents += cost_micro_cents;

        // Register in dirty set
        guard.dirty_tenants.insert(tenant_id.to_string());

        Ok(new_bal)
    }

    async fn get_unbilled(&self, tenant_id: &str) -> Result<UnbilledUsage, GatewayError> {
        let guard = self.inner.read().await;
        Ok(guard.unbilled.get(tenant_id).cloned().unwrap_or_default())
    }

    async fn rotate_dirty_tenants(&self) -> Result<Vec<String>, GatewayError> {
        let mut guard = self.inner.write().await;
        let rotated: Vec<String> = guard.dirty_tenants.drain().collect();
        for t in &rotated {
            guard.flushing_tenants.insert(t.clone());
        }
        Ok(rotated)
    }

    async fn record_flushed_usage(&self, tenant_id: &str, flushed: &UnbilledUsage) -> Result<(), GatewayError> {
        let mut guard = self.inner.write().await;
        if let Some(unbilled) = guard.unbilled.get_mut(tenant_id) {
            unbilled.input = (unbilled.input - flushed.input).max(0);
            unbilled.output = (unbilled.output - flushed.output).max(0);
            unbilled.total_micro_cents = (unbilled.total_micro_cents - flushed.total_micro_cents).max(0);
        }
        guard.flushing_tenants.remove(tenant_id);
        Ok(())
    }

    async fn refund_usage(&self, tenant_id: &str, refund_micro_cents: i64) -> Result<(), GatewayError> {
        let mut guard = self.inner.write().await;
        if let Some(record) = guard.credits.get_mut(tenant_id) {
            record.balance += refund_micro_cents;
            record.updated_at = chrono::Utc::now().timestamp();
        }
        if let Some(unbilled) = guard.unbilled.get_mut(tenant_id) {
            unbilled.total_micro_cents = (unbilled.total_micro_cents - refund_micro_cents).max(0);
        }
        Ok(())
    }
}
