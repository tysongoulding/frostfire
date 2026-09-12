# Frostfire Operating Summary

## 1. Default Architecture
- **Control Plane**: Hybrid Tauri v2 Desktop App + local SQLite WAL & REST/WebSocket daemons.
- **Inference Layer**: Multi-model Bedrock cascade (`us.meta.llama3-3-70b-instruct-v1:0` primary [~350ms latency], `us.deepseek.r1-v1:0` reasoning, `amazon.nova-pro-v1:0`, direct Anthropic API when key present).
- **Execution Fabric**: Single-agent baseline with direct execution control over Display `:1` on Ubuntu 24.04 (`44.242.94.86`), port `1339` for execution, `6080` for noVNC web streaming.
- **Task & Memory Substrate**: File-first state (`SYSTEM.md`, `AGENTS.md`, `plan.md`, `tasks.md`, `knowledge.md`, `artifacts/`).

## 2. First Milestone Definition (Closed Loop)
1. Accept goal via UI or API.
2. Decompose into concrete task graph.
3. Route task to Display `:1` worker.
4. Execute non-blocking Linux command via launcher.
5. Verify outcome (`scrot -o /tmp/screen.png`, exit code, process status).
6. Record memory and artifact trace.
7. Surface live status in UI / noVNC.
8. Complete 1 self-improvement or eval capture.

## 3. Key Guardrails & Invariants
- **Outbound-Only Ingress**: Cloud Gateway routes agents via reverse-stream `OpenTunnel`. TLS 1.3 only.
- **Tenant Authorization**: All display routes must pass `x-frostfire-window-owner` token checks with constant-time comparison.
- **Deterministic Action over Narration**: Immediate Linux launcher execution (`chrome-launcher`, `terminal-launcher`, `files-launcher`) rather than textual instructions.
- **Zero Secrets in Git**: Never commit API keys or AWS credentials.

## 4. Current Runtime Constraints
- Display resolution: 1280x800 (`:1`).
- EC2 Spot host: `44.242.94.86` in `us-west-2`.
- Bedrock region: `us-west-2`.