# Handoff Report: Defect 2 Investigation & Integer Validation Strategy in `scripts/setup-cluster.sh`

**Author**: `explorer_m3_fix_2` (Teamwork Explorer)  
**Recipient**: `parent` (`a683d2a2-4cae-4a3a-a587-8741f091dc4b`)  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m3_fix_2`  
**Handoff Type**: Hard  
**Deliverables**: `report.md`, `handoff.md`, `test_matrix.sh`  
**Date**: 2026-09-08T22:02:30Z  

---

## 1. Observation

Direct empirical observations, file paths, line numbers, and verbatim outputs gathered during investigation:

### 1.1 Defect 2 Reproduction in `scripts/setup-cluster.sh`
- **File**: `scripts/setup-cluster.sh`, lines 69–72:
  ```bash
  if [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
    echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
    exit 1
  fi
  ```
- **Observed Behavior on Non-Integer Inputs**:
  Executed command:
  ```bash
  bash scripts/setup-cluster.sh --vms abc --dry-run
  ```
  Verbatim output:
  ```
  === Frostfire MicroVM Cluster Setup: frostfire-prod ===
  scripts/setup-cluster.sh: line 69: [: abc: integer expression expected
  scripts/setup-cluster.sh: line 69: [: abc: integer expression expected
  [DRY-RUN] Preflight parameters valid:
    - Cluster Name:   frostfire-prod
    - MicroVM Count:  abc
    - Gateway Port:   50051
    - Base Directory: /var/lib/frostfire
    - Kernel Path:    /var/lib/frostfire/vmlinux-6.12
    - Mode:           DRY RUN (No changes applied)
  ```
  Process exit status: `0`.
- **Observed Behavior on Floating-Point Input**:
  Executed command:
  ```bash
  bash scripts/setup-cluster.sh --vms 3.5 --dry-run
  ```
  Verbatim output:
  ```
  scripts/setup-cluster.sh: line 69: [: 3.5: integer expression expected
  scripts/setup-cluster.sh: line 69: [: 3.5: integer expression expected
  [DRY-RUN] Preflight parameters valid:
  ...
  ```
  Process exit status: `0`.

### 1.2 Inspection of `--gateway-port`
- **File**: `scripts/setup-cluster.sh`, lines 15, 45, 78, 219:
  ```bash
  15: GATEWAY_PORT=50051
  ...
  45: --gateway-port) GATEWAY_PORT="$2"; shift 2 ;;
  ...
  78: echo "  - Gateway Port:   ${GATEWAY_PORT}"
  ...
  219: ExecStart=${GATEWAY_BIN} --bind 0.0.0.0:${GATEWAY_PORT} --tenant-token ${TENANT_TOKEN}
  ```
- **Observed Behavior on Invalid Gateway Ports**:
  Executed commands:
  ```bash
  bash scripts/setup-cluster.sh --gateway-port abc --dry-run
  bash scripts/setup-cluster.sh --gateway-port 70000 --dry-run
  bash scripts/setup-cluster.sh --gateway-port 0 --dry-run
  bash scripts/setup-cluster.sh --gateway-port "" --dry-run
  ```
  All commands exited with status `0` without any error message or warning.
- **Downstream Impact**: In live execution, line 219 templates the unvalidated port into `/etc/systemd/system/frostfire-gateway.service`. When starting the service, Rust's `frostfire-gateway` fails to parse `"0.0.0.0:<port>"` as a valid socket address and crashes immediately on startup.

### 1.3 Critical Edge Cases Discovered
- **64-bit Integer Overflow Bypass in `[`**:
  When testing `if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then` on a 25-digit input (`VM_COUNT="9999999999999999999999999"`):
  The regex matches. Then `[ "${VM_COUNT}" -lt 1 ]` and `[ "${VM_COUNT}" -gt 16 ]` overflow 64-bit `intmax_t`, write `[: integer expression expected` to stderr, and return status 2 (false). The conditional expression evaluates to false, **bypassing the validation check completely**.
- **Bash Octal Trap on Leading Zeros**:
  When `VM_COUNT="08"` is passed, `[ "08" -gt 16 ]` is false, passing validation. But in line 126 (`for ((i=0; i<VM_COUNT; i++))`), Bash interprets numbers with leading zero as octal. Because `8` is not a valid octal digit, Bash aborts with `((: 08: value too great for base (error token is "08")`.

---

## 2. Logic Chain

1. **Failure Mechanism in `test` / `[`**:
   - Observation 1.1 shows that when `[ "${VM_COUNT}" -lt 1 ]` is evaluated against a non-integer token, `test` cannot parse it as an integer, prints an error message to stderr, and returns exit status 2 (failure).
   - In `[ ... -lt 1 ] || [ ... -gt 16 ]`, both branches return 2. Since neither branch succeeds (returns 0), the `if` body is skipped and execution proceeds.
2. **Impact on Dry-Run & Live Execution**:
   - In dry-run mode, the script reaches line 74 and prints `[DRY-RUN] Preflight parameters valid` and exits 0, misinforming callers that invalid input was accepted.
   - In live mode, arithmetic loop `for ((i=0; i<VM_COUNT; i++))` treats unset identifier `abc` as 0, failing to launch any VMs and reporting success with invalid subnet bounds `172.16.-1.2`.
3. **Absence of Port Validation**:
   - Observation 1.2 demonstrates that `GATEWAY_PORT` is completely unvalidated in Section 1 of `scripts/setup-cluster.sh`.
   - Ports must be 16-bit unsigned integers between 1 and 65535 (RFC 793). Supplying tokens outside this range produces broken systemd unit configurations that crash `frostfire-gateway`.
4. **Vulnerability of Unbounded Regex**:
   - Observation 1.3 proves that a naive regex check `! [[ "${VAR}" =~ ^[0-9]+$ ]]` is insufficient because values exceeding 64 bits cause `[` to error and return false, bypassing validation.
   - Furthermore, inputs with leading zeros like `08` crash arithmetic loops downstream unless normalized or rejected.
5. **Conclusion Derivation**:
   - Both `VM_COUNT` and `GATEWAY_PORT` must be guarded by bash regex checks combined with digit length bounds (or bounded regex) and numeric range comparisons, followed by base-10 normalization.

---

## 3. Caveats

- **Scope Boundary**: As an Explorer agent, this task was strictly read-only investigation and formulation. Source files (`scripts/setup-cluster.sh`) were NOT modified directly. The concrete patch is provided for `worker_m3_1` to apply.
- **Port Privileges**: Valid TCP port range is 1 to 65535. While ports 1–1023 are privileged, `scripts/setup-cluster.sh` runs as root / under `sudo`, and the systemd unit runs under `User=root`, so ports in the entire 1–65535 range are allowable from a kernel capability perspective.

---

## 4. Conclusion

The recommended fix strategy adds strict regex, length bounds, and range validation for both `VM_COUNT` (1–16) and `GATEWAY_PORT` (1–65535), followed by base-10 normalization.

### Actionable Code Replacement for `worker_m3_1`

**Target File**: `scripts/setup-cluster.sh` (lines 69–72)

```bash
# Replace:
if [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
  echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
  exit 1
fi

# With:
if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${#VM_COUNT}" -gt 2 ] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
  echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
  exit 1
fi
VM_COUNT=$((10#${VM_COUNT}))

if ! [[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || [ "${#GATEWAY_PORT}" -gt 5 ] || [ "${GATEWAY_PORT}" -lt 1 ] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
  echo "[-] Error: Gateway port must be between 1 and 65535 (got ${GATEWAY_PORT})." >&2
  exit 1
fi
GATEWAY_PORT=$((10#${GATEWAY_PORT}))
```

*(Note: Alternatively, the bounded non-zero leading regex `! [[ "${VM_COUNT}" =~ ^[1-9][0-9]?$ ]] || [ "${VM_COUNT}" -gt 16 ]` and `! [[ "${GATEWAY_PORT}" =~ ^[1-9][0-9]{0,4}$ ]] || [ "${GATEWAY_PORT}" -gt 65535 ]` provides equivalent protection in a single line per parameter without needing `10#` normalization).*

---

## 5. Verification Method

To independently verify the fix:

1. **Verify Rejection of Non-Integers and Out-of-Bounds `VM_COUNT`** (must exit 1 with error):
   ```bash
   bash scripts/setup-cluster.sh --vms abc --dry-run
   bash scripts/setup-cluster.sh --vms 3.5 --dry-run
   bash scripts/setup-cluster.sh --vms 0 --dry-run
   bash scripts/setup-cluster.sh --vms 17 --dry-run
   bash scripts/setup-cluster.sh --vms 9999999999999999999999999 --dry-run
   ```
2. **Verify Rejection of Invalid `GATEWAY_PORT`** (must exit 1 with error):
   ```bash
   bash scripts/setup-cluster.sh --gateway-port abc --dry-run
   bash scripts/setup-cluster.sh --gateway-port 0 --dry-run
   bash scripts/setup-cluster.sh --gateway-port 65536 --dry-run
   bash scripts/setup-cluster.sh --gateway-port 70000 --dry-run
   bash scripts/setup-cluster.sh --gateway-port 9999999999999999999999999 --dry-run
   ```
3. **Verify Valid Preflight Dry-Run** (must exit 0):
   ```bash
   bash scripts/setup-cluster.sh --cluster-name frostfire-prod --vms 3 --gateway-port 50051 --dry-run
   ```
4. **Shell Syntax and E2E Workspace Verification**:
   ```bash
   bash -n scripts/setup-cluster.sh
   cargo test -p frostfire-e2e
   cargo clippy --workspace -- -D warnings
   ```
