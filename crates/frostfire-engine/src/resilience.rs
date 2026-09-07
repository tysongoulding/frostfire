use rand::Rng;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::sync::RwLock;

#[derive(Error, Debug, PartialEq, Eq)]
pub enum CircuitBreakerError {
    #[error("Circuit breaker is OPEN. Fast failing request without calling upstream provider.")]
    CircuitOpen,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub cooldown_period: Duration,
    pub canary_probes_required: u32,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 3,
            cooldown_period: Duration::from_secs(30),
            canary_probes_required: 1,
        }
    }
}

struct CircuitInternalState {
    state: CircuitState,
    opened_at: Option<Instant>,
    consecutive_successes: u32,
}

pub struct CircuitBreaker {
    config: CircuitBreakerConfig,
    failure_count: AtomicU32,
    internal: Arc<RwLock<CircuitInternalState>>,
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new(CircuitBreakerConfig::default())
    }
}

impl CircuitBreaker {
    pub fn new(config: CircuitBreakerConfig) -> Self {
        Self {
            config,
            failure_count: AtomicU32::new(0),
            internal: Arc::new(RwLock::new(CircuitInternalState {
                state: CircuitState::Closed,
                opened_at: None,
                consecutive_successes: 0,
            })),
        }
    }

    pub async fn state(&self) -> CircuitState {
        let mut lock = self.internal.write().await;
        if lock.state == CircuitState::Open {
            if let Some(opened_at) = lock.opened_at {
                if opened_at.elapsed() >= self.config.cooldown_period {
                    lock.state = CircuitState::HalfOpen;
                    lock.consecutive_successes = 0;
                }
            }
        }
        lock.state
    }

    pub async fn can_execute(&self) -> Result<(), CircuitBreakerError> {
        let s = self.state().await;
        match s {
            CircuitState::Closed | CircuitState::HalfOpen => Ok(()),
            CircuitState::Open => Err(CircuitBreakerError::CircuitOpen),
        }
    }

    pub async fn record_success(&self) {
        let mut lock = self.internal.write().await;
        match lock.state {
            CircuitState::HalfOpen => {
                lock.consecutive_successes += 1;
                if lock.consecutive_successes >= self.config.canary_probes_required {
                    lock.state = CircuitState::Closed;
                    lock.opened_at = None;
                    lock.consecutive_successes = 0;
                    self.failure_count.store(0, Ordering::SeqCst);
                }
            }
            CircuitState::Closed => {
                self.failure_count.store(0, Ordering::SeqCst);
            }
            CircuitState::Open => {}
        }
    }

    pub async fn record_failure(&self) {
        let mut lock = self.internal.write().await;
        match lock.state {
            CircuitState::Closed => {
                let current_failures = self.failure_count.fetch_add(1, Ordering::SeqCst) + 1;
                if current_failures >= self.config.failure_threshold {
                    lock.state = CircuitState::Open;
                    lock.opened_at = Some(Instant::now());
                }
            }
            CircuitState::HalfOpen => {
                // Any failure in HalfOpen immediately trips back to Open
                lock.state = CircuitState::Open;
                lock.opened_at = Some(Instant::now());
                lock.consecutive_successes = 0;
            }
            CircuitState::Open => {}
        }
    }

    /// Compute exponential backoff with randomized jitter on HTTP 429/503:
    /// attempt 0: 1s + jitter [0, 1000ms]
    /// attempt 1: 2s + jitter [0, 1000ms]
    /// attempt 2: 4s + jitter [0, 1000ms]
    /// attempt 3: 8s + jitter [0, 1000ms]
    pub fn compute_backoff_delay(&self, attempt: u32) -> Duration {
        let capped_attempt = attempt.min(5);
        let base_millis = (1u64 << capped_attempt) * 1000;
        let mut rng = rand::thread_rng();
        let jitter_millis: u64 = rng.gen_range(0..=1000);
        Duration::from_millis(base_millis + jitter_millis)
    }
}
