# Frostfire Cloud Agent Directives

Private cloud control plane, microVM virtualization infrastructure, and swarm orchestrator.

## Verification Gates

Execute after every modification before declaring work complete:

1. **Unit & Integration Suite**: `cargo test --workspace` (must pass all tests, 0 warnings).
2. **Linter**: `cargo clippy --workspace -- -D warnings`.

## Invariants

- **Outbound-Only Ingress**: Cloud Gateway routes agents via reverse-stream `OpenTunnel`. Daemons connect outbound over TLS 1.3.
- **MicroVM Isolation**: MicroVM instances run on isolated bridge networks (`172.16.x.0/24`). Never bridge unauthenticated guest networks to the public internet.
- **Tenant Authorization**: All display routes must pass `x-sand-window-owner` token checks with constant-time comparison (`timingSafeEqual`).
- **Zero Secrets in Git**: Never commit AWS credentials, private keys, or API tokens.
