# Frostfire Cloud (Private Control Plane & MicroVM Infrastructure)

Private cloud services, edge ingress gateway, swarm orchestrator, and autonomous microVM virtualization infrastructure for Frostfire.

## Architecture Layout

- `cloud/`:
  - `gateway/`: Outbound reverse-tunnel edge gateway terminating client gRPC streams.
  - `agent/`: In-VM agent execution runtime (`hitl`, `browser`, `teach`, and computer-use models).
  - `microvm/`: MicroVM rootfs build scripts, X11/VNC display multiplexers, and Chrome session linkers.
- `services/`:
  - `swarm-orchestrator/`: 4-tier swarm state machine, Blackboard event store, DAG vector canvas renderer, and Gemini turn engine.
- `deploy/`:
  - `aws/`: CloudFormation templates (`cloudformation.yaml`, `firecracker-hypervisor.yaml`, `poc-3user.yaml`).
  - `gcp/`: Cloud Run & Deployment Manager configurations.
  - `docker/`: Monolithic cloud container definitions & `docker-compose.yml`.
  - `proxmox/`: Proxmox LXC cluster deployment scripts.
- `scripts/`:
  - `cloud-start.ps1`, `cloud-stop.ps1`, `cloud-status.ps1`: AWS host lifecycle management.
  - `setup-cluster.sh`: Turnkey 1-command microVM multi-user cluster installer.
  - `gcp-setup-wizard.sh`: GCP provisioner with nested KVM virtualization.
- `docs/`:
  - `MICROVM_ARCHITECTURE.md`: Complete reverse-engineered cloud microVM architecture specification.
  - `AGENT_TEAMS_SPEC.md`: Dynamic agent-teams orchestration specification.
- `crates/`:
  - `frostfire-proto`: Protobuf gRPC contracts (`AgentTunnelService.OpenTunnel`).

## Local Development

```bash
# Verify all cloud workspace crates
cargo test --workspace
```
