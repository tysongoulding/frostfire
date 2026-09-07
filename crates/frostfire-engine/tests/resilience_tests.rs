use std::time::Duration;
use frostfire_engine::resilience::{CircuitBreaker, CircuitBreakerConfig, CircuitState};

#[tokio::test]
async fn test_circuit_breaker_transitions() {
    let config = CircuitBreakerConfig {
        failure_threshold: 3,
        cooldown_period: Duration::from_millis(100),
        canary_probes_required: 1,
    };
    let cb = CircuitBreaker::new(config);

    // Initial state: Closed
    assert_eq!(cb.state().await, CircuitState::Closed);
    assert!(cb.can_execute().await.is_ok());

    // 1st failure
    cb.record_failure().await;
    assert_eq!(cb.state().await, CircuitState::Closed);

    // 2nd failure
    cb.record_failure().await;
    assert_eq!(cb.state().await, CircuitState::Closed);

    // 3rd failure -> trips to Open
    cb.record_failure().await;
    assert_eq!(cb.state().await, CircuitState::Open);
    assert!(cb.can_execute().await.is_err(), "Open state must reject execution");

    // Wait for cooldown period to elapse
    tokio::time::sleep(Duration::from_millis(120)).await;

    // After cooldown, should allow a canary probe in HalfOpen
    assert_eq!(cb.state().await, CircuitState::HalfOpen);
    assert!(cb.can_execute().await.is_ok(), "HalfOpen should allow canary execution");

    // Canary probe succeeds -> transitions back to Closed
    cb.record_success().await;
    assert_eq!(cb.state().await, CircuitState::Closed);
    assert!(cb.can_execute().await.is_ok());
}

#[test]
fn test_backoff_jitter_bounds() {
    let cb = CircuitBreaker::default();
    for attempt in 0..4 {
        let delay = cb.compute_backoff_delay(attempt);
        let base_secs = 1u64 << attempt; // 1s, 2s, 4s, 8s
        let min_expected = Duration::from_secs(base_secs);
        let max_expected = Duration::from_millis(base_secs * 1000 + 1000); // base + up to 1000ms jitter
        assert!(delay >= min_expected, "Delay {:?} should be >= {:?}", delay, min_expected);
        assert!(delay <= max_expected, "Delay {:?} should be <= {:?}", delay, max_expected);
    }
}
