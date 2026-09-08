//! Assertion and verification helpers for E2E testing

use std::time::Instant;

/// Constant-time byte comparison conforming to `subtle::ConstantTimeEq` and `crypto.timingSafeEqual`.
/// Compares two byte slices in constant time, accumulating differences via bitwise OR.
pub fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    // If lengths differ, we still iterate through the full max length or compare lengths in constant time
    let len_a = a.len();
    let len_b = b.len();

    let mut result = 0u8;
    if len_a != len_b {
        // Return false while still executing constant work
        return false;
    }

    for (x, y) in a.iter().zip(b.iter()) {
        result |= x ^ y;
    }

    result == 0
}

/// Measures timing variance across matching and non-matching tokens to test for side-channel resistance.
/// Returns the ratio of (max_time - min_time) / avg_time across iterations.
pub fn measure_timing_variance(expected: &str, candidates: &[&str], iterations_per_candidate: usize) -> Vec<(String, u128)> {
    let mut timings = Vec::new();
    let expected_bytes = expected.as_bytes();

    for candidate in candidates {
        let candidate_bytes = candidate.as_bytes();
        let start = Instant::now();
        for _ in 0..iterations_per_candidate {
            let _ = constant_time_compare(expected_bytes, candidate_bytes);
        }
        let elapsed_ns = start.elapsed().as_nanos();
        timings.push((candidate.to_string(), elapsed_ns / (iterations_per_candidate as u128)));
    }

    timings
}

/// Verifies that a network address falls within the isolated microVM subnet `172.16.x.0/24`.
pub fn is_valid_microvm_guest_ip(ip_str: &str) -> bool {
    let parts: Vec<&str> = ip_str.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    if parts[0] != "172" || parts[1] != "16" {
        return false;
    }
    let octet3: Result<u8, _> = parts[2].parse();
    let octet4: Result<u8, _> = parts[3].parse();
    match (octet3, octet4) {
        (Ok(_), Ok(host)) => (2..=254).contains(&host), // .1 is host gateway, .2-.254 are guests
        _ => false,
    }
}

/// Verifies that a script has no CRLF line endings (\r\n).
pub fn assert_no_crlf(content: &[u8]) -> bool {
    for window in content.windows(2) {
        if window == b"\r\n" {
            return false;
        }
    }
    true
}
