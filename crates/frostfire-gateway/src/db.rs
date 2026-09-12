use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::error::GatewayError;

/// Durable user account stored in the relational database.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UserAccount {
    pub user_uuid: String,
    pub email: String,
    pub stripe_customer_id: String,
    pub stripe_subscription_id: Option<String>,
    pub tier: String,
    pub status: String,
    pub spend_cap_micro_cents: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Durable audit record of a received Stripe webhook.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StripeEventRecord {
    pub event_id: String,
    pub event_type: String,
    pub payload: String,
    pub processed_at: i64,
}

/// Relational database managing durable user accounts and Stripe event audit logs.
#[derive(Clone)]
pub struct AccountDatabase {
    conn: Arc<Mutex<Connection>>,
}

impl AccountDatabase {
    /// Opens an in-memory database for hermetic testing.
    pub fn open_in_memory() -> Result<Self, GatewayError> {
        let conn = Connection::open_in_memory()
            .map_err(|e| GatewayError::DatabaseError(format!("Open in-memory db: {e}")))?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    /// Opens a disk-backed SQLite database at the specified path.
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, GatewayError> {
        let conn = Connection::open(path)
            .map_err(|e| GatewayError::DatabaseError(format!("Open sqlite db: {e}")))?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), GatewayError> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS accounts (
                user_uuid TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                stripe_customer_id TEXT UNIQUE NOT NULL,
                stripe_subscription_id TEXT,
                tier TEXT NOT NULL,
                status TEXT NOT NULL,
                spend_cap_micro_cents INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS stripe_events (
                event_id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                processed_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS license_audit (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_uuid TEXT NOT NULL,
                token_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_uuid) REFERENCES accounts(user_uuid)
            );

            CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
            CREATE INDEX IF NOT EXISTS idx_accounts_customer ON accounts(stripe_customer_id);
            CREATE INDEX IF NOT EXISTS idx_events_type ON stripe_events(event_type);
            ",
        )
        .map_err(|e| GatewayError::DatabaseError(format!("Init schema error: {e}")))?;

        Ok(())
    }

    /// Upserts a user account.
    pub fn upsert_account(&self, account: &UserAccount) -> Result<(), GatewayError> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "
            INSERT INTO accounts (
                user_uuid, email, stripe_customer_id, stripe_subscription_id,
                tier, status, spend_cap_micro_cents, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(user_uuid) DO UPDATE SET
                email = excluded.email,
                stripe_customer_id = excluded.stripe_customer_id,
                stripe_subscription_id = excluded.stripe_subscription_id,
                tier = excluded.tier,
                status = excluded.status,
                spend_cap_micro_cents = excluded.spend_cap_micro_cents,
                updated_at = excluded.updated_at
            ",
            params![
                account.user_uuid,
                account.email,
                account.stripe_customer_id,
                account.stripe_subscription_id,
                account.tier,
                account.status,
                account.spend_cap_micro_cents,
                account.created_at,
                account.updated_at,
            ],
        )
        .map_err(|e| GatewayError::DatabaseError(format!("Upsert account error: {e}")))?;

        Ok(())
    }

    /// Retrieves an account by `user_uuid`.
    pub fn get_account_by_uuid(&self, user_uuid: &str) -> Result<Option<UserAccount>, GatewayError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT user_uuid, email, stripe_customer_id, stripe_subscription_id,
                        tier, status, spend_cap_micro_cents, created_at, updated_at
                 FROM accounts WHERE user_uuid = ?1",
            )
            .map_err(|e| GatewayError::DatabaseError(format!("Prepare query: {e}")))?;

        let account = stmt
            .query_row(params![user_uuid], |row| {
                Ok(UserAccount {
                    user_uuid: row.get(0)?,
                    email: row.get(1)?,
                    stripe_customer_id: row.get(2)?,
                    stripe_subscription_id: row.get(3)?,
                    tier: row.get(4)?,
                    status: row.get(5)?,
                    spend_cap_micro_cents: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .optional()
            .map_err(|e| GatewayError::DatabaseError(format!("Query account by uuid: {e}")))?;

        Ok(account)
    }

    /// Retrieves an account by email address.
    pub fn get_account_by_email(&self, email: &str) -> Result<Option<UserAccount>, GatewayError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT user_uuid, email, stripe_customer_id, stripe_subscription_id,
                        tier, status, spend_cap_micro_cents, created_at, updated_at
                 FROM accounts WHERE email = ?1",
            )
            .map_err(|e| GatewayError::DatabaseError(format!("Prepare query: {e}")))?;

        let account = stmt
            .query_row(params![email], |row| {
                Ok(UserAccount {
                    user_uuid: row.get(0)?,
                    email: row.get(1)?,
                    stripe_customer_id: row.get(2)?,
                    stripe_subscription_id: row.get(3)?,
                    tier: row.get(4)?,
                    status: row.get(5)?,
                    spend_cap_micro_cents: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .optional()
            .map_err(|e| GatewayError::DatabaseError(format!("Query account by email: {e}")))?;

        Ok(account)
    }

    /// Retrieves an account by Stripe Customer ID (`cus_...`).
    pub fn get_account_by_stripe_customer(
        &self,
        customer_id: &str,
    ) -> Result<Option<UserAccount>, GatewayError> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT user_uuid, email, stripe_customer_id, stripe_subscription_id,
                        tier, status, spend_cap_micro_cents, created_at, updated_at
                 FROM accounts WHERE stripe_customer_id = ?1",
            )
            .map_err(|e| GatewayError::DatabaseError(format!("Prepare query: {e}")))?;

        let account = stmt
            .query_row(params![customer_id], |row| {
                Ok(UserAccount {
                    user_uuid: row.get(0)?,
                    email: row.get(1)?,
                    stripe_customer_id: row.get(2)?,
                    stripe_subscription_id: row.get(3)?,
                    tier: row.get(4)?,
                    status: row.get(5)?,
                    spend_cap_micro_cents: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            })
            .optional()
            .map_err(|e| GatewayError::DatabaseError(format!("Query account by stripe customer: {e}")))?;

        Ok(account)
    }

    /// Updates subscription status and tier.
    pub fn update_subscription(
        &self,
        user_uuid: &str,
        subscription_id: &str,
        status: &str,
        tier: &str,
    ) -> Result<(), GatewayError> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE accounts SET stripe_subscription_id = ?1, status = ?2, tier = ?3, updated_at = ?4
             WHERE user_uuid = ?5",
            params![subscription_id, status, tier, now, user_uuid],
        )
        .map_err(|e| GatewayError::DatabaseError(format!("Update subscription: {e}")))?;

        Ok(())
    }

    /// Updates the monthly spend cap in micro-cents.
    pub fn update_spend_cap(&self, user_uuid: &str, cap_micro_cents: i64) -> Result<(), GatewayError> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "UPDATE accounts SET spend_cap_micro_cents = ?1, updated_at = ?2 WHERE user_uuid = ?3",
            params![cap_micro_cents, now, user_uuid],
        )
        .map_err(|e| GatewayError::DatabaseError(format!("Update spend cap: {e}")))?;

        Ok(())
    }

    /// Records a Stripe webhook event idempotently. Returns `true` if newly recorded, `false` if duplicate.
    pub fn record_stripe_event(
        &self,
        event_id: &str,
        event_type: &str,
        payload_json: &str,
    ) -> Result<bool, GatewayError> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();

        let rows_affected = conn
            .execute(
                "INSERT OR IGNORE INTO stripe_events (event_id, event_type, payload, processed_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![event_id, event_type, payload_json, now],
            )
            .map_err(|e| GatewayError::DatabaseError(format!("Insert stripe event: {e}")))?;

        Ok(rows_affected > 0)
    }

    /// Logs license generation for audit trails.
    pub fn record_license_audit(
        &self,
        user_uuid: &str,
        token_hash: &str,
        expires_at: i64,
    ) -> Result<(), GatewayError> {
        let conn = self.conn.lock().unwrap();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO license_audit (user_uuid, token_hash, expires_at, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![user_uuid, token_hash, expires_at, now],
        )
        .map_err(|e| GatewayError::DatabaseError(format!("Insert license audit: {e}")))?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_crud_lifecycle() {
        let db = AccountDatabase::open_in_memory().unwrap();
        let now = chrono::Utc::now().timestamp();

        let account = UserAccount {
            user_uuid: "usr_1234-abcd".to_string(),
            email: "dev@frostfire.cloud".to_string(),
            stripe_customer_id: "cus_xyz987".to_string(),
            stripe_subscription_id: Some("sub_111".to_string()),
            tier: "pro".to_string(),
            status: "active".to_string(),
            spend_cap_micro_cents: 5_000_000_000, // $50
            created_at: now,
            updated_at: now,
        };

        db.upsert_account(&account).unwrap();

        // Query by UUID
        let fetched = db.get_account_by_uuid("usr_1234-abcd").unwrap().unwrap();
        assert_eq!(fetched, account);

        // Query by email
        let fetched_email = db.get_account_by_email("dev@frostfire.cloud").unwrap().unwrap();
        assert_eq!(fetched_email, account);

        // Query by customer
        let fetched_cus = db.get_account_by_stripe_customer("cus_xyz987").unwrap().unwrap();
        assert_eq!(fetched_cus, account);

        // Update spend cap to $100
        db.update_spend_cap("usr_1234-abcd", 10_000_000_000).unwrap();
        let updated = db.get_account_by_uuid("usr_1234-abcd").unwrap().unwrap();
        assert_eq!(updated.spend_cap_micro_cents, 10_000_000_000);
    }

    #[test]
    fn test_stripe_event_idempotency() {
        let db = AccountDatabase::open_in_memory().unwrap();

        let first = db
            .record_stripe_event("evt_001", "checkout.session.completed", "{\"data\": 1}")
            .unwrap();
        assert!(first, "First event insert should succeed");

        let second = db
            .record_stripe_event("evt_001", "checkout.session.completed", "{\"data\": 1}")
            .unwrap();
        assert!(!second, "Duplicate event insert should be ignored");
    }
}
