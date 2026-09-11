# Frostfire Momentum Queues

## 1. `now` (Active Execution Focus)
- [x] Install new main system prompt into `SYSTEM.md` across `frostfire`, `frostfire-cloud`, and VM `44.242.94.86`.
- [x] Configure high-speed Bedrock cascade in Tauri client (`us.meta.llama3-3-70b-instruct-v1:0` primary [350ms], `us.deepseek.r1-v1:0` fallback).
- [ ] Verify live desktop app execution with new prompt and multi-turn persona memory.

## 2. `next` (Immediate Actionable Backlog)
- [ ] Wire specialized task execution harnesses (coding, browser research, terminal dev) on Display `:1`.
- [ ] Connect SQLite WAL task queue persistence in Tauri backend (`commands.rs`).
- [ ] Add automated screenshot verification hook after every UI action turn.

## 3. `blocked` (Waiting on External Dependencies)
- *None currently.* (Anthropic Bedrock access form unsubmitted; bypassed via Llama 3.3 70B and DeepSeek R1).

## 4. `improve` (Continuous Self-Improvement & Evals)
- [ ] Construct automated eval runner testing prompt adherence on 20 benchmark computer tasks.
- [ ] Cache LLM system prompt prefix across multi-turn sessions to reduce token cost.

## 5. `recurring` (Continuous Monitors & Loops)
- [ ] EC2 Spot Auto-idle inactivity daemon (`/usr/local/bin/check-idle-shutdown.sh` checking ports 22/6080 every 5 mins).
- [ ] VM health heartbeat (`GET http://44.242.94.86:1339/health`).