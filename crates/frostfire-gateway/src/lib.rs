pub mod auth;
pub mod broker;
pub mod db;
pub mod error;
pub mod metering;
pub mod router;
pub mod server;
pub mod stripe;

pub use auth::{LicenseAuthority, LicenseClaims};
pub use broker::{verify_tenant_window_token, IngressTunnelBroker};
pub use db::{AccountDatabase, StripeEventRecord, UserAccount};
pub use error::GatewayError;
pub use metering::{CreditStorage, InMemoryCreditStore, TenantCreditRecord, UnbilledUsage};
pub use router::{LlmRouter, ModelRequest, ModelTier, ProviderFailover, ProviderTarget};
pub use server::{GatewayHealthResponse, GatewayServer, GatewayTunnelService, VerifyLicenseRequest};
pub use stripe::{
    get_default_spend_cap_micro_cents, get_included_credits_micro_cents, MockStripeClient,
    StripeBillingFlusher, StripeMeterClient, StripeWebhookHandler, WebhookResult,
    DEFAULT_BASE_PRICE_CENTS, DEFAULT_INCLUDED_CREDITS_MICRO_CENTS, DEFAULT_SPEND_CAP_MICRO_CENTS,
};
