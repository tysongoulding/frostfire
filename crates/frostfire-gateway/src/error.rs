use thiserror::Error;

#[derive(Debug, Error)]
pub enum GatewayError {
    #[error("Tenant '{0}' not found")]
    TenantNotFound(String),

    #[error("Insufficient credits for tenant '{0}': required {1} micro-cents, current balance {2}")]
    InsufficientCredits(String, i64, i64),

    #[error("Unauthorized window owner token for tenant '{0}'")]
    Unauthorized(String),

    #[error("Model routing error: {0}")]
    RoutingError(String),

    #[error("Provider failed after failover sequence: {0}")]
    ProviderFailed(String),

    #[error("Stripe flush error: {0}")]
    StripeError(String),

    #[error("Tunnel error: {0}")]
    TunnelError(String),

    #[error("Internal error: {0}")]
    Internal(String),
}
