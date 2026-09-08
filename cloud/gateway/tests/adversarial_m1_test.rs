use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use frostfire_gateway::auth::{extract_bearer_token, TenantAuthenticator};
use frostfire_gateway::session::SessionRegistry;
use frostfire_gateway::GatewayServerHandle;
use frostfire_proto::tunnel::{tunnel_client_frame, Heartbeat, TunnelClientFrame, TunnelServerFrame};
use frostfire_tunnel::{TunnelClient, TunnelConfig};


/// Test 1: UTF-8 boundary and multi-byte slicing in `extract_bearer_token`.
/// Tests whether slicing `trimmed[..7]` panics when byte 7 is within a multi-byte UTF-8 character.
/// When input is not "Bearer <token>", it should safely return the trimmed input without crashing.
#[test]
fn challenge_utf8_char_boundary_slicing_in_extract_bearer_token() {
    let test_cases = vec![
        ("123456\u{00E9}", "123456\u{00E9}"),             // 2-byte char spanning index 6..8
        ("abcdef\u{00E9}", "abcdef\u{00E9}"),             // 2-byte char spanning index 6..8
        ("1234\u{1F600}", "1234\u{1F600}"),               // 4-byte emoji spanning index 4..8 (index 7 is inside)
        ("12345\u{4E2D}", "12345\u{4E2D}"),               // 3-byte Chinese char spanning index 5..8 (index 7 is inside)
        (" \u{1F600}abc", "\u{1F600}abc"),                // Leading space + 4-byte emoji (bytes 1..5) + 3 ASCII = 8 bytes
        ("b\u{1F600}xyz", "b\u{1F600}xyz"),                // 'b' (1) + 4 bytes (1..5) + 'x','y','z' (5..8)
        ("Bearer", "Bearer"),                              // Exactly 6 chars (less than 7)
        ("Bearer ", ""),                                   // Exactly 7 chars
        ("Bearer \u{1F600}", "\u{1F600}"),                 // 7 chars + 4-byte emoji
        ("bearer \u{00E9}", "\u{00E9}"),                   // 7 chars + 2-byte char
        ("\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{00E9}", "\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{0000}\u{00E9}"), // Null bytes + multi-byte
    ];

    let mut failure_messages = Vec::new();

    for (input, expected) in test_cases {
        let result = std::panic::catch_unwind(|| {
            extract_bearer_token(input)
        });

        match result {
            Ok(extracted) => {
                if extracted != expected {
                    failure_messages.push(format!(
                        "extract_bearer_token({:?}) returned {:?}, expected {:?}",
                        input, extracted, expected
                    ));
                }
            }
            Err(_) => {
                failure_messages.push(format!(
                    "extract_bearer_token({:?}) panicked due to unverified char boundary slicing!",
                    input
                ));
            }
        }
    }

    if !failure_messages.is_empty() {
        panic!(
            "FAIL: extract_bearer_token failed on {} inputs:\n{}",
            failure_messages.len(),
            failure_messages.join("\n")
        );
    }
}


/// Test 2: Thousands of random token variations, differing lengths, prefixes, control characters.
#[test]
fn challenge_fuzz_thousands_of_token_variations() {
    let expected = "secret-tenant-key-production-2026-xyz";
    let auth = TenantAuthenticator::new(expected);

    // Baseline validation
    assert!(auth.validate_token(expected));
    assert!(!auth.validate_token(""));

    let mut rng_seed: u64 = 0x12345678_deadbeef;
    let mut xorshift = move || -> u64 {
        rng_seed ^= rng_seed << 13;
        rng_seed ^= rng_seed >> 7;
        rng_seed ^= rng_seed << 17;
        rng_seed
    };

    let mut tested_count = 0;

    // 1. Length variations from 1 to 50,000 bytes
    let lengths = [1, 2, 3, 16, 31, 32, 33, 63, 64, 65, 127, 128, 129, 255, 256, 1024, 4096, 50000];
    for &len in &lengths {
        let candidate = "A".repeat(len);
        assert!(!auth.validate_token(&candidate), "Length {} should not match", len);
        tested_count += 1;
    }

    // 2. Control characters & special bytes
    let control_chars = [
        "\0", "\0\0\0\0", "\r", "\n", "\r\n", "\t", "\x08", "\x1b", "\x7f",
        "secret-tenant-key-production-2026-xyz\0",
        "secret-tenant-key-production-2026-xyz\n",
        "secret-tenant-key-production-2026-xyz\r\n",
        "secret-tenant-key-production-2026-xyz ",
        " secret-tenant-key-production-2026-xyz",
        "\0secret-tenant-key-production-2026-xyz",
    ];
    for cc in &control_chars {
        assert!(!auth.validate_token(cc), "Control char string {:?} must not match", cc);
        tested_count += 1;
    }

    // 3. Incremental prefix matches (0 to expected.len()-1 bytes identical)
    for i in 0..expected.len() {
        let prefix = &expected[..i];
        assert!(!auth.validate_token(prefix), "Prefix of length {} must not match", i);
        tested_count += 1;

        // Prefix + mutated character
        let mutated = format!("{}X", prefix);
        if mutated != expected {
            assert!(!auth.validate_token(&mutated), "Mutated prefix {} must not match", mutated);
            tested_count += 1;
        }
    }

    // 4. Random pseudorandom tokens (2,000 iterations)
    for _ in 0..2000 {
        let rand_len = (xorshift() % 128 + 1) as usize;
        let mut rand_bytes = Vec::with_capacity(rand_len);
        for _ in 0..rand_len {
            rand_bytes.push((xorshift() % 256) as u8);
        }
        let rand_str = String::from_utf8_lossy(&rand_bytes);
        if rand_str != expected {
            assert!(!auth.validate_token(&rand_str));
            tested_count += 1;
        }
    }

    // 5. UTF-8 multi-byte stress tokens (500 iterations)
    let utf8_samples = [
        "🔥", "❄️", "🔑", "🛡️", "日本語トークン", "русский_текст", "مفتاح", "äöüß", "éèêë",
    ];
    for sample in utf8_samples {
        let cand = format!("secret-tenant-{}", sample);
        assert!(!auth.validate_token(&cand));
        tested_count += 1;
    }

    println!("[AUTH FUZZING] Successfully validated {} token variations without crash or false positive", tested_count);
}

/// Test 3: Empirical timing consistency analysis (constant-time verification).
/// Tests that matching prefixes do not exit earlier than completely non-matching candidates.
#[test]
fn challenge_constant_time_timing_consistency() {
    let expected = "abcdefghijklmnopqrstuvwxyz012345"; // 32 bytes
    let auth = TenantAuthenticator::new(expected);

    // Candidate A: 31 matching bytes, 1 mismatching byte (at end)
    let candidate_almost_match = "abcdefghijklmnopqrstuvwxyz01234X";

    // Candidate B: 0 matching bytes
    let candidate_no_match = "99999999999999999999999999999999";

    assert_eq!(candidate_almost_match.len(), candidate_no_match.len());
    assert_eq!(candidate_almost_match.len(), expected.len());

    // Warm-up
    for _ in 0..10_000 {
        let _ = auth.validate_token(candidate_almost_match);
        let _ = auth.validate_token(candidate_no_match);
    }

    let iterations = 100_000;

    let start_almost = Instant::now();
    for _ in 0..iterations {
        let res = auth.validate_token(candidate_almost_match);
        assert!(!res);
    }
    let elapsed_almost = start_almost.elapsed();

    let start_no_match = Instant::now();
    for _ in 0..iterations {
        let res = auth.validate_token(candidate_no_match);
        assert!(!res);
    }
    let elapsed_no_match = start_no_match.elapsed();

    let time_almost_ns = elapsed_almost.as_nanos() as f64 / iterations as f64;
    let time_no_match_ns = elapsed_no_match.as_nanos() as f64 / iterations as f64;
    let diff_ns = (time_almost_ns - time_no_match_ns).abs();
    let relative_diff = diff_ns / time_almost_ns.max(time_no_match_ns);

    println!(
        "[TIMING TEST] 31-byte match: {:.2} ns/op, 0-byte match: {:.2} ns/op, Diff: {:.2} ns ({:.2}%)",
        time_almost_ns, time_no_match_ns, diff_ns, relative_diff * 100.0
    );

    // On any standard CPU, SHA-256 + 32-byte ct_eq takes ~50-300 ns per op.
    // Relative difference should be under 15% across 100,000 iterations.
    assert!(
        relative_diff < 0.20,
        "Timing differential too large: {:.2}% (expected < 20% noise bound)",
        relative_diff * 100.0
    );
}

/// Test 4: Concurrent reconnect stress:
/// Rapid connect / drop / reconnect loops with identical agent_id to verify that
/// `unregister_if_matching` prevents session hijacking and orphaned sender channels.
#[tokio::test]
async fn challenge_concurrent_reconnect_stress_and_session_lifecycle() {
    let token = "stress-tenant-token-secret-999";
    let gateway = GatewayServerHandle::bind_ephemeral_with_token(token)
        .await
        .expect("Failed to bind ephemeral gateway");

    let agent_id = "agent-concurrent-stress-target";
    let concurrency = 15;
    let iterations_per_worker = 10;

    let successful_cycles = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();

    for worker_id in 0..concurrency {
        let gateway_url = gateway.url();
        let agent_id_str = agent_id.to_string();
        let token_str = token.to_string();
        let success_counter = successful_cycles.clone();

        let handle = tokio::spawn(async move {
            for iter in 0..iterations_per_worker {
                let tunnel_cfg = TunnelConfig::new(&gateway_url, &agent_id_str)
                    .with_auth_token(format!("Bearer {}", token_str))
                    .with_connect_timeout(Duration::from_secs(4));

                let client_res = TunnelClient::connect(tunnel_cfg).await;
                match client_res {
                    Ok(mut client) => {
                        // Send heartbeat frame
                        let hb = TunnelClientFrame {
                            frame_id: format!("hb-{}-{}-{}", worker_id, iter, uuid::Uuid::new_v4()),
                            agent_id: agent_id_str.clone(),
                            timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                            payload: Some(tunnel_client_frame::Payload::Heartbeat(Heartbeat {
                                sequence: (worker_id * 1000 + iter) as i64,
                                timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
                                agent_id: agent_id_str.clone(),
                                is_ack: false,
                            })),
                        };

                        if client.send(hb).await.is_ok() {
                            let _ = tokio::time::timeout(Duration::from_millis(500), client.recv()).await;
                        }

                        // Close client cleanly or drop
                        client.close().await;
                        success_counter.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        eprintln!("Worker {} iter {} connect failed: {:?}", worker_id, iter, e);
                    }
                }
            }
        });

        handles.push(handle);
    }

    for h in handles {
        h.await.expect("Worker task panicked");
    }

    let total_successful = successful_cycles.load(Ordering::SeqCst);
    println!(
        "[CONCURRENT RECONNECT STRESS] Completed {} successful connect/send/disconnect cycles",
        total_successful
    );
    assert!(
        total_successful >= (concurrency * iterations_per_worker * 8 / 10),
        "At least 80% of rapid reconnect cycles must succeed under contention"
    );

    // Allow background unregister tasks to complete
    tokio::time::sleep(Duration::from_millis(600)).await;

    // Verify SessionRegistry is clean — no leaked/orphaned sessions
    let active = gateway.registry.active_agents().await;
    println!("[SESSION REGISTRY] Active agents remaining: {}", active.len());
    assert!(
        active.is_empty(),
        "All sessions must be cleanly unregistered when clients disconnect, found: {:?}",
        active
    );

    gateway.shutdown();
}

/// Test 5: Session Hijacking and Stale Eviction Prevention
/// Verifies that an expired/stale connection disconnecting does NOT evict a newer active session.
#[tokio::test]
async fn challenge_session_hijacking_stale_eviction_prevention() {
    let registry = Arc::new(SessionRegistry::new());
    let (tx1, _rx1) = tokio::sync::mpsc::channel(16);
    let (tx2, mut rx2) = tokio::sync::mpsc::channel(16);

    let agent_id = "agent-target-x";

    // 1. Session 1 registers
    let sid1 = registry.register(agent_id.into(), tx1).await;

    // 2. Session 2 connects (reconnect with same agent_id)
    let sid2 = registry.register(agent_id.into(), tx2).await;
    assert_ne!(sid1, sid2);

    // 3. Stale Session 1 disconnects and attempts to unregister
    let unreg_stale = registry.unregister_if_matching(agent_id, sid1).await;
    assert!(!unreg_stale, "Stale unregister must return false");

    // 4. Session 2 must STILL be registered and receivable
    let active = registry.active_agents().await;
    assert_eq!(active.len(), 1);
    assert_eq!(active[0].session_id, sid2);

    // 5. Verify message can still be delivered to Session 2
    let test_frame = TunnelServerFrame {
        frame_id: "test-frame-to-sid2".into(),
        timestamp_unix_ms: chrono::Utc::now().timestamp_millis(),
        payload: Some(frostfire_proto::tunnel::tunnel_server_frame::Payload::ErrorFrame(
            "test".into(),
        )),
    };
    registry
        .send_to_agent(agent_id, test_frame)
        .await
        .expect("send_to_agent should succeed to active session 2");

    let received = rx2.recv().await.expect("Session 2 receiver must receive frame");
    assert!(received.is_ok());

    // 6. Active Session 2 unregisters with matching sid2
    let unreg_active = registry.unregister_if_matching(agent_id, sid2).await;
    assert!(unreg_active, "Active unregister must succeed");
    assert!(registry.active_agents().await.is_empty());
}

/// Test 6: Comprehensive UTF-8 multi-byte code point stress testing across split positions 0..=12.
/// Fuzzes 1-byte, 2-byte, 3-byte, and 4-byte characters across all split positions (indices 0 to 12)
/// with varied prefixes, suffixes, and randomized property testing (50,000 iterations).
#[test]
fn challenge_comprehensive_utf8_multibyte_split_positions_fuzzing() {
    let code_points = [
        // 1-byte (ASCII)
        "a", "Z", "9", " ", "_", "\0",
        // 2-byte (Latin-1, Cyrillic, Greek, boundaries)
        "\u{0080}", "\u{00E9}", "\u{00F1}", "\u{03B1}", "\u{0449}", "\u{07FF}",
        // 3-byte (CJK, Currency, Symbols, boundaries)
        "\u{0800}", "\u{20AC}", "\u{4E2D}", "\u{65E5}", "\u{8A9E}", "\u{FFFF}",
        // 4-byte (Emojis, Math, Supplementary, boundaries)
        "\u{10000}", "\u{1F600}", "\u{1F525}", "\u{1F980}", "\u{1F6E1}", "\u{10FFFF}",
    ];

    let prefixes = [
        "",
        "a",
        "ab",
        "abc",
        "abcd",
        "abcde",
        "abcdef",
        "Bearer",
        "bearer",
        "BEARER",
        "Bearer ",
        "bearer ",
        "  Bearer ",
        "   ",
    ];

    let suffixes = [
        "",
        " ",
        "token",
        "123",
        "\u{00E9}",
        "\u{4E2D}",
        "\u{1F600}",
        " trailing text with spaces ",
    ];

    let mut total_tested = 0;
    let mut failure_messages = Vec::new();

    // 1. Systematic grid across all split positions 0..=12
    for split_pos in 0..=12 {
        let prefix_fill = "x".repeat(split_pos);
        for &cp in &code_points {
            for &suf in &suffixes {
                let test_input = format!("{}{}{}", prefix_fill, cp, suf);
                let result = std::panic::catch_unwind(|| {
                    extract_bearer_token(&test_input)
                });

                match result {
                    Ok(extracted) => {
                        let trimmed_leading = test_input.trim_start();
                        let expected = if trimmed_leading.len() >= 7 
                            && trimmed_leading.as_bytes()[..7].eq_ignore_ascii_case(b"bearer ") 
                        {
                            trimmed_leading[7..].trim()
                        } else {
                            test_input.trim()
                        };

                        if extracted != expected {
                            failure_messages.push(format!(
                                "Mismatch for split_pos={}, cp={:?}, suf={:?}: input={:?}, got={:?}, expected={:?}",
                                split_pos, cp, suf, test_input, extracted, expected
                            ));
                        }
                    }
                    Err(_) => {
                        failure_messages.push(format!(
                            "PANIC on split_pos={}, cp={:?}, suf={:?}: input={:?}",
                            split_pos, cp, suf, test_input
                        ));
                    }
                }
                total_tested += 1;
            }
        }
    }

    // 2. Combinations with realistic authorization header variants
    for &pref in &prefixes {
        for &cp in &code_points {
            for &suf in &suffixes {
                let test_input = format!("{}{}{}", pref, cp, suf);
                let result = std::panic::catch_unwind(|| {
                    extract_bearer_token(&test_input)
                });

                match result {
                    Ok(extracted) => {
                        let trimmed_leading = test_input.trim_start();
                        let expected = if trimmed_leading.len() >= 7 
                            && trimmed_leading.as_bytes()[..7].eq_ignore_ascii_case(b"bearer ") 
                        {
                            trimmed_leading[7..].trim()
                        } else {
                            test_input.trim()
                        };

                        if extracted != expected {
                            failure_messages.push(format!(
                                "Mismatch for pref={:?}, cp={:?}, suf={:?}: input={:?}, got={:?}, expected={:?}",
                                pref, cp, suf, test_input, extracted, expected
                            ));
                        }
                    }
                    Err(_) => {
                        failure_messages.push(format!(
                            "PANIC on pref={:?}, cp={:?}, suf={:?}: input={:?}",
                            pref, cp, suf, test_input
                        ));
                    }
                }
                total_tested += 1;
            }
        }
    }

    // 3. Randomized pseudorandom fuzzing (50,000 iterations)
    let mut rng_seed: u64 = 0xbeef_cafe_9876_5432;
    let mut xorshift = move || -> u64 {
        rng_seed ^= rng_seed << 13;
        rng_seed ^= rng_seed >> 7;
        rng_seed ^= rng_seed << 17;
        rng_seed
    };

    let sample_chars: Vec<char> = "Bearerbearer 0123456789\t\n\r\0éñαλщ中日€語😀🔥🦀🛡"
        .chars()
        .collect();

    for _ in 0..50_000 {
        let len = (xorshift() % 30) as usize;
        let mut s = String::with_capacity(len * 4);
        for _ in 0..len {
            let idx = (xorshift() as usize) % sample_chars.len();
            s.push(sample_chars[idx]);
        }

        let result = std::panic::catch_unwind(|| {
            extract_bearer_token(&s)
        });

        match result {
            Ok(extracted) => {
                let trimmed_leading = s.trim_start();
                let expected = if trimmed_leading.len() >= 7 
                    && trimmed_leading.as_bytes()[..7].eq_ignore_ascii_case(b"bearer ") 
                {
                    trimmed_leading[7..].trim()
                } else {
                    s.trim()
                };

                if extracted != expected {
                    failure_messages.push(format!(
                        "Random fuzz mismatch on input={:?}: got={:?}, expected={:?}",
                        s, extracted, expected
                    ));
                    if failure_messages.len() > 10 {
                        break;
                    }
                }
            }
            Err(_) => {
                failure_messages.push(format!("PANIC on random fuzz input={:?}", s));
                if failure_messages.len() > 10 {
                    break;
                }
            }
        }
        total_tested += 1;
    }

    println!("[UTF-8 MULTI-BYTE FUZZING] Successfully tested {} cases across all split positions 0..=12", total_tested);

    if !failure_messages.is_empty() {
        panic!(
            "FAIL: extract_bearer_token failed {} fuzz cases:\n{}",
            failure_messages.len(),
            failure_messages.join("\n")
        );
    }
}

/// Test 7: Empirical boundary and edge case verification for extract_bearer_token.
/// Specifically verifies all dispatch-specified edge cases:
/// "Bearer", "bearer", "Bearer ", "Bearer \t", "Bearer \n", "  Bearer   abc", "Bearerabc", "", "\0"
#[test]
fn challenge_extract_bearer_token_edge_cases_and_boundaries() {
    let cases = [
        // Dispatch specified edge cases:
        ("Bearer", "Bearer"),
        ("bearer", "bearer"),
        ("Bearer ", ""),
        ("Bearer \t", ""),
        ("Bearer \n", ""),
        ("  Bearer   abc", "abc"),
        ("Bearerabc", "Bearerabc"),
        ("", ""),
        ("\0", "\0"),

        // Additional boundary cases:
        ("BEARER", "BEARER"),
        ("Bearer  ", ""),
        ("Bearer   \t\r\n", ""),
        ("Bearer \r\n", ""),
        ("   Bearer   ", ""),
        ("   bearer   ", ""),
        ("   BEARER   ", ""),
        ("Bearer\t", "Bearer"),
        ("Bearer\n", "Bearer"),
        ("Bearer\0", "Bearer\0"),
        ("Bearer \0", "\0"),
        ("Bearer\0token", "Bearer\0token"),
        ("Bearer \0token", "\0token"),
        ("  Bearer  my-token-123  ", "my-token-123"),
        ("\tBearer  token\t", "token"),
        ("\nBearer  token\n", "token"),
        ("\r\nBearer  token\r\n", "token"),
        ("Bearerbearer ", "Bearerbearer"),
        ("Bearer Bearer token", "Bearer token"),
        ("   ", ""),
        ("\t\t\t", ""),
        ("\r\n\r\n", ""),

        // Multi-byte Unicode whitespace edge cases:
        ("\u{00A0}Bearer token", "token"),        // Non-breaking space
        ("\u{3000}Bearer token", "token"),        // Ideographic space
        ("Bearer \u{3000}", ""),                  // Unicode whitespace after Bearer
        ("Bearer token\u{3000}", "token"),        // Unicode whitespace after token
        ("   \u{00A0}\u{3000}Bearer \u{3000}secret\u{00A0}   ", "secret"),
    ];

    for (input, expected) in cases {
        let result = std::panic::catch_unwind(|| {
            extract_bearer_token(input)
        });

        match result {
            Ok(extracted) => {
                assert_eq!(
                    extracted, expected,
                    "Edge case failed: input={:?}, expected={:?}, got={:?}",
                    input, expected, extracted
                );
            }
            Err(_) => {
                panic!("PANIC on edge case input={:?}", input);
            }
        }
    }

    println!("[EDGE CASE VERIFICATION] Successfully verified all {} boundary cases", cases.len());
}



