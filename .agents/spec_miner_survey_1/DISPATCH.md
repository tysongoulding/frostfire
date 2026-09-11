# Dispatch: Spec Miner Survey 1 (AWS Infrastructure & Hypervisor Daemon Specs)

**Identity**: Spec Miner (Survey 1)
**Working Directory**: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1
**Request**: Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md
**Mission**:
Investigate R1 (AWS Infrastructure & UserData) and R4 (Rust Firecracker Hypervisor & box-doctor):
1. Investigate CloudFormation automation (`deploy/aws/poc-host.yaml`), deployment script (`scripts/deploy-poc.ps1`), UserData bootstrap, ports (22, 1339, 6080), auto-idle script (`check-idle-shutdown.sh`), host setup (`setup-host.sh`).
2. Investigate `frostfire-hypervisor` crate requirements: Tokio, Hyper, UDS, TAP interface `tap0` (`172.30.0.1/24`), guest IP (`172.30.0.2`), Firecracker API socket (`/tmp/firecracker.socket`), boot-source, root drive, AF_VSOCK bridge (`/tmp/vsock.sock`, guest CID 3), instance start, serial logs, shutdown signal handling.
3. Investigate `box-doctor` verification checks (10 diagnostic checks: machine-id, chrome, chrome-fds, egress, clock, dbus, xvfb, x11vnc, novnc, compositor).
4. Report detailed requirements, contracts, and interfaces to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\survey_report.md`.

## 2026-09-11T03:17:48Z
Received dispatch request:
Investigate R1 (AWS Infrastructure & UserData) and R4 (Rust Firecracker Hypervisor & box-doctor):
1. Investigate CloudFormation automation (deploy/aws/poc-host.yaml), deployment script (scripts/deploy-poc.ps1), UserData bootstrap, ports (22, 1339, 6080), auto-idle script (check-idle-shutdown.sh), host setup (setup-host.sh).
2. Investigate frostfire-hypervisor crate requirements: Tokio, Hyper, UDS, TAP interface tap0 (172.30.0.1/24), guest IP (172.30.0.2), Firecracker API socket (/tmp/firecracker.socket), boot-source, root drive, AF_VSOCK bridge (/tmp/vsock.sock, guest CID 3), instance start, serial logs, shutdown signal handling.
3. Investigate box-doctor verification checks (10 diagnostic checks: machine-id, chrome, chrome-fds, egress, clock, dbus, xvfb, x11vnc, novnc, compositor).
4. Report detailed requirements, contracts, and interfaces to: c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\spec_miner_survey_1\survey_report.md. Also write handoff.md and notify parent orchestrator via send_message.

