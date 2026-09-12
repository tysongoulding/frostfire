# Frostfire Momentum Queues

## 1. `now` (Active Execution Focus)
- [x] Implement comprehensive End-to-End System Evaluation & Benchmark Suite (`e2e_system_eval.rs`).
- [x] Run full workspace test suite (150 passed, 0 warnings, clippy clean, frontend build clean).
- [x] Store all architectural decisions and options in `questions.md`.
- [x] Production billing, identity, token metering, and Ed25519 license authority.

## 2. `next` (Immediate Actionable Backlog)
- [ ] Connect live Stripe Webhook endpoint in staging/production environment.
- [ ] Integrate automated screen capture assertions with test fixtures.
- [ ] Wire SQLite WAL task queue persistence in Tauri backend (`commands.rs`).

## 3. `blocked` (Waiting on External Dependencies)
- *None currently.*

## 4. `improve` (Continuous Self-Improvement & Evals)
- [x] Construct automated eval runner testing 7 distributed architecture pillars and latency SLAs.
- [ ] Benchmark Redis cluster vs single instance throughput under 10k concurrent agent connections.

## 5. `recurring` (Continuous Monitors & Loops)
- [x] 60-Second batched Stripe meter event flush loop.
- [ ] EC2 Spot Auto-idle inactivity daemon (`/usr/local/bin/check-idle-shutdown.sh` checking ports 22/6080 every 5 mins).
- [ ] VM health heartbeat (`GET http://44.242.94.86:1339/health`).