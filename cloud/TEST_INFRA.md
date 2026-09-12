# Frostfire Cloud Phase 1 — Test Infrastructure Specification

## Overview
This document specifies the opaque-box integration test infrastructure for Frostfire Cloud Phase 1 (User-Hosted VM on AWS EC2 Spot Nitro with nested KVM, monolithic Linux 6.12 kernel, Debian 13 rootfs appliance, and Rust Firecracker hypervisor daemon).

The test suite provides exhaustive requirement verification across all 32 inventoried features in `PROJECT.md`, organized into a 4-tier testing hierarchy comprising **347 executable tests**.

---

## 4-Tier Test Architecture

```
                                  [ Tier 4 ]
                      Real-World Application Scenarios
                                 (7 Tests)
                   ───────────────────────────────────────
                                  [ Tier 3 ]
                      Cross-Feature Pairwise Interactions
                                 (20 Tests)
                   ───────────────────────────────────────
                                  [ Tier 2 ]
                          Boundary & Corner Cases
                        (160 Tests — 5 per feature)
                   ───────────────────────────────────────
                                  [ Tier 1 ]
                              Feature Coverage
                        (160 Tests — 5 per feature)
```

### Tier 1: Feature Coverage (160 Tests)
- **Scope**: All 32 inventoried features from `PROJECT.md` (Features 1 through 32).
- **Standard**: At least 5 independent, opaque-box tests per feature.
- **Verification Vector**: Validates primary functional behaviors, schema definitions, command structures, file contracts, and observable outputs against `ORIGINAL_REQUEST.md` and `PROJECT.md`.

### Tier 2: Boundary & Corner Cases (160 Tests)
- **Scope**: All 32 features at domain boundaries.
- **Standard**: At least 5 boundary, edge-case, and negative-path tests per feature.
- **Verification Vector**: Tests limits (e.g. volume sizes 30GB vs 200GB, memory sizes 4096 MiB, clock skew <= 60s, FD limit 90%), empty inputs, network disconnects, invalid configurations, and failure recovery.

### Tier 3: Cross-Feature Combinations (20 Tests)
- **Scope**: Subsystem interfaces and pairwise component contracts.
- **Standard**: 20 pairwise tests exercising end-to-end data flow between adjacent layers:
  - Host UserData ↔ Auto-Idle Shutdown Daemon
  - Security Group Ingress ↔ Guest Services & noVNC
  - Kernel Boot Line ↔ Hypervisor TAP Networking
  - VirtIO Core Drivers ↔ Firecracker Device Attachments
  - Cgroup v2 Subsystems ↔ Guest Process Resource Controls
  - Debian 13 Debootstrap ↔ User `box` Profile & Permissions
  - Recombined Binaries ↔ Guest Runtime Daemons
  - Chrome Enterprise Policies ↔ Native Messaging Host Manifests
  - X11 Display Stack ↔ websockify / noVNC Streaming Chain
  - Firecracker Machine Config ↔ Kernel Memory Accounting

### Tier 4: Real-World Application Scenarios (7 Scenarios)
- **Scope**: Full multi-step operational workflows:
  1. **Scenario 1**: CloudFormation Deployment & Host Bootstrap Lifecycle.
  2. **Scenario 2**: Firecracker MicroVM Cold Boot & UDS API Orchestration Flow.
  3. **Scenario 3**: Debian 13 Rootfs Appliance Assembly & Asset Integration Flow.
  4. **Scenario 4**: Remote Desktop Ingress & noVNC RFB Streaming Session.
  5. **Scenario 5**: Complete In-Guest Diagnostic Health Gate (`box-doctor`) Passing All 10 Checks.
  6. **Scenario 6**: Host Auto-Idle Inactivity Power-Down Cycle (<$5/mo spend).
  7. **Scenario 7**: Abrupt Host Interruption (SIGINT) & Graceful Hypervisor Teardown.

---

## Directory & File Layout

```
frostfire-cloud/
├── TEST_INFRA.md                     # Test infrastructure architecture & run manual
├── TEST_READY.md                     # Test readiness verification report & checklist
├── tests/
│   ├── __init__.py                   # Test suite package marker
│   ├── common.py                     # Shared paths, loaders, and assertion helpers
│   ├── test_tier1_features.py        # Tier 1: 160 Feature Coverage tests (F01-F32)
│   ├── test_tier2_boundaries.py      # Tier 2: 160 Boundary & Corner Case tests
│   ├── test_tier3_interactions.py    # Tier 3: 20 Pairwise Cross-Feature tests
│   ├── test_tier4_scenarios.py       # Tier 4: 7 Real-World Application Scenarios
│   ├── run_all_tests.py              # Primary executable Python test runner
│   ├── run_tests.sh                  # Executable Bash test runner wrapper
│   └── run_tests.ps1                 # Executable PowerShell test runner wrapper
```

---

## Test Execution Commands

### 1. Python Primary Runner (Cross-Platform)
```bash
# Run all test tiers (Tiers 1-4)
python tests/run_all_tests.py

# Run with verbose test case reporting
python tests/run_all_tests.py -v

# Run specific tier only
python tests/run_all_tests.py --tier 1
python tests/run_all_tests.py --tier 2
python tests/run_all_tests.py --tier 3
python tests/run_all_tests.py --tier 4
```

### 2. PowerShell Runner (Windows Native)
```powershell
# Run full suite
.\tests\run_tests.ps1

# Run with verbose output
.\tests\run_tests.ps1 -Verbose

# Run specific tier
.\tests\run_tests.ps1 -Tier 1
```

### 3. Bash Runner (Linux / EC2 / WSL)
```bash
# Run full suite
bash tests/run_tests.sh

# Run specific tier with verbose reporting
bash tests/run_tests.sh --tier 1 -v
```

### 4. Pytest & Standard Unittest Discovery
```bash
# Pytest execution
pytest tests -q

# Standard Python unittest discovery
python -m unittest discover tests
```

---

## Test Verification Standards

1. **Zero Facades**: Every test executes real assertions against concrete files, YAML/JSON schemas, shell ASTs, Rust source code, or simulated subsystems.
2. **Deterministic & Isolated**: Tests execute independently without state contamination, shared mutable disk writes, or order dependence.
3. **Environment Agnostic**: The suite executes identically on Windows development environments, Linux CI runners, and EC2 Spot Nitro instances.
4. **Authoritative Alignment**: Expected outputs derive strictly from `ORIGINAL_REQUEST.md` requirements and `PROJECT.md` interface contracts.
