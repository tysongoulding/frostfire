# Investigation Report: scripts/setup-cluster.sh Integer Validation Defect (Defect 2 & Gateway Port)

**Agent**: `explorer_m3_fix_2` (Teamwork Explorer)  
**Date**: 2026-09-08T22:02:00Z  
**Target File**: `scripts/setup-cluster.sh`  
**Referenced Findings**: `challenger_m3_1` Defect 2, `reviewer_m3_2` Finding 2  

---

## 1. Executive Summary

An investigation into Defect 2 identified by `challenger_m3_1` and Finding 2 by `reviewer_m3_2` was conducted. The investigation confirmed:

1. **Defect 2 in `VM_COUNT`**: `scripts/setup-cluster.sh` line 69 uses `[ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]` without prior integer or regex validation. Non-integer inputs such as `"abc"` or `"3.5"` cause Bash's `[` built-in operator to emit `integer expression expected` to stderr and return exit status 2 (false). Because neither `-lt` nor `-gt` evaluates to 0 (true), the entire conditional expression fails, bypassing parameter validation. In `--dry-run` mode, the script exits with status 0 ("Preflight parameters valid"). In live mode, arithmetic loops `for ((i=0; i<VM_COUNT; i++))` evaluate `"abc"` as 0, creating 0 TAP interfaces and 0 microVM services while reporting success with invalid subnet strings (`172.16.-1.2`).
2. **Missing Validation in `--gateway-port`**: Currently, `GATEWAY_PORT` has **zero validation** in `scripts/setup-cluster.sh`. Non-integer tokens (`"abc"`, `"3.5"`), negative values (`"-1"`), port zero (`"0"`), and out-of-range ports (`"70000"`, `"9999999999999999999999999"`) are passed directly through to `--dry-run` (exiting 0) and live execution. In live execution, the invalid port is templated into `/etc/systemd/system/frostfire-gateway.service`, causing `frostfire-gateway` to panic/fail when attempting to parse the invalid `SocketAddr`.
3. **Critical Edge-Case Discoveries**:
   - **64-bit Integer Overflow Bypass**: If an unconstrained regex `^[0-9]+$` is used without length bounds, huge digit strings (such as `9999999999999999999999999`) overflow `intmax_t` inside `test`/`[`. As a result, `[ ... -gt 16 ]` throws `integer expression expected` and evaluates to false, **bypassing validation completely**.
   - **Bash Octal Evaluation Trap**: In Bash arithmetic expansion `(( ... ))`, numbers with leading zeros (e.g. `08`, `09`) are treated as octal literals. Because `8` and `9` are invalid octal digits, `for ((i=0; i<VM_COUNT; i++))` aborts with `value too great for base (error token is "08")`.
4. **Resolution Strategy**: Three validation strategies were formulated and empirically benchmarked across 28 test cases. Both Strategy 2 (Length Guard + Base-10 Normalization) and Strategy 3 (Bounded Non-Zero Leading Regex) eliminate 100% of defect vectors, overflow bypasses, and octal traps.

---

## 2. Root Cause Analysis

### 2.1 Defect 2: `VM_COUNT` Validation Bypass (`scripts/setup-cluster.sh` lines 69–72)

In `scripts/setup-cluster.sh`:
```bash
58: # 1. Validation of Parameters (Boundary Tests Compliance)
59: if [ -z "${CLUSTER_NAME// }" ]; then
60:   echo "[-] Error: Cluster name cannot be empty." >&2
61:   exit 1
62: fi
63: 
64: if ! [[ "${CLUSTER_NAME}" =~ ^[a-zA-Z0-9-]+$ ]]; then
65:   echo "[-] Error: Cluster name '${CLUSTER_NAME}' contains invalid characters (only alphanumeric and hyphens allowed)." >&2
66:   exit 1
67: fi
68: 
69: if [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
70:   echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
71:   exit 1
72: fi
```

#### The Evaluation Failure
In POSIX `test` and Bash `[`, `-lt` and `-gt` perform binary integer comparisons. The implementation calls `strtoimax()` on the operand string.
- If the string is `"abc"`, `strtoimax()` fails. `[` writes `[: abc: integer expression expected` to stderr and returns exit status 2.
- The condition `[ "${VM_COUNT}" -lt 1 ]` evaluates to status 2 (falsy in an `if` construct).
- The logical OR (`||`) causes Bash to evaluate the right-hand operand: `[ "${VM_COUNT}" -gt 16 ]`.
- This also fails with status 2.
- Because neither operand was true (exit code 0), the `if` body (lines 70–71) does not execute.

#### Dry-Run Manifestation
Execution immediately falls through to lines 74–83:
```bash
if [ "${DRY_RUN}" = true ]; then
  echo "[DRY-RUN] Preflight parameters valid:"
  echo "  - Cluster Name:   ${CLUSTER_NAME}"
  echo "  - MicroVM Count:  ${VM_COUNT}"
  echo "  - Gateway Port:   ${GATEWAY_PORT}"
  ...
  exit 0
fi
```
The script emits `[DRY-RUN] Preflight parameters valid: - MicroVM Count: abc` and exits with code 0.

#### Live Mode Manifestation
In live execution, lines 126, 147, 164, and 254 execute arithmetic `for` loops:
```bash
for ((i=0; i<VM_COUNT; i++)); do
```
In Bash arithmetic expressions `(( ... ))`, unquoted identifiers are evaluated as variable names. Because the variable `abc` is unset, Bash evaluates it as `0`.
- The loop terminates before the first iteration (`i=0; i<0; i++` is false).
- 0 TAP interfaces are created (`tap0`, `tap1`, etc. are not created).
- 0 iptables rules are applied.
- 0 systemd units are started.
- The script reaches lines 259–265:
  ```bash
  echo "🎉 Frostfire MicroVM Cluster '${CLUSTER_NAME}' Deployed!"
  echo "  - MicroVMs:      ${VM_COUNT} active instances (172.16.0.2 .. 172.16.$((VM_COUNT-1)).2)"
  ```
  Bash evaluates `$((abc - 1))` as `-1`, printing `172.16.-1.2` as the subnet range and exiting 0.

---

### 2.2 Inspection of `--gateway-port`

#### Current Status
`GATEWAY_PORT` is declared at line 15:
```bash
15: GATEWAY_PORT=50051
```
And parsed at lines 45:
```bash
45:     --gateway-port) GATEWAY_PORT="$2"; shift 2 ;;
```
However, in Section 1 (lines 58–73), **no validation check exists** for `GATEWAY_PORT`.

#### Downstream Failure Modes
1. **Dry-Run Bypass**:
   Passing `--gateway-port abc`, `--gateway-port -1`, `--gateway-port 0`, `--gateway-port 70000`, or `--gateway-port ""` is accepted by `--dry-run` and outputs `[DRY-RUN] Preflight parameters valid: - Gateway Port: <val>` with exit code 0.
2. **Live Service Crash**:
   In live deployment (line 210–226), the script writes `/etc/systemd/system/frostfire-gateway.service`:
   ```ini
   [Service]
   ExecStart=/usr/local/bin/frostfire-gateway --bind 0.0.0.0:${GATEWAY_PORT} --tenant-token ${TENANT_TOKEN}
   ```
   When systemd starts the service, the Rust binary `frostfire-gateway` attempts to parse `"0.0.0.0:<port>"` as a `std::net::SocketAddr`:
   - If port is `"abc"` or `""`: `AddrParseError(InvalidSocketAddress)` -> Gateway exits immediately.
   - If port is `"70000"` (> 65535, exceeding `u16`): `AddrParseError(InvalidPort)` -> Gateway exits immediately.
   - If port is `"0"`: Port 0 cannot be used as an active server bind address.

#### Valid Range Specification
Per RFC 793 and standard TCP/IP networking, port numbers are 16-bit unsigned integers:
- Minimum valid listening port: `1`
- Maximum valid listening port: `65535`
- Recommended default: `50051` (gRPC standard)

---

## 3. Empirical Evidence & Critical Edge Cases

### 3.1 Empirical Reproduction of Defect 2

Command:
```bash
bash scripts/setup-cluster.sh --vms abc --dry-run
```
Output:
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
Exit Code: `0` (Expected: `1`)

Command:
```bash
bash scripts/setup-cluster.sh --vms 3.5 --dry-run
```
Output:
```
=== Frostfire MicroVM Cluster Setup: frostfire-prod ===
scripts/setup-cluster.sh: line 69: [: 3.5: integer expression expected
scripts/setup-cluster.sh: line 69: [: 3.5: integer expression expected
[DRY-RUN] Preflight parameters valid:
  - Cluster Name:   frostfire-prod
  - MicroVM Count:  3.5
  ...
```
Exit Code: `0` (Expected: `1`)

### 3.2 Critical Edge Case 1: 64-Bit Integer Overflow Bypass in `[`

When testing the naive regex fix suggested in reviewer/challenger handoffs:
```bash
if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
```
We tested an adversarial input composed purely of digits exceeding 64 bits:
`VM_COUNT="9999999999999999999999999"` (25 digits).

**What happens**:
1. `! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]]` is **false** (it matches `^[0-9]+$`).
2. `[ "${VM_COUNT}" -lt 1 ]` calls `strtoimax()`, which overflows 64-bit signed integer limits. Bash emits `[: 99999...: integer expression expected` and returns status 2 (false).
3. `[ "${VM_COUNT}" -gt 16 ]` also overflows, emits `[: 99999...: integer expression expected`, and returns status 2 (false).
4. Entire condition evaluates to **false**, **bypassing validation**!
5. The script continues into dry-run / live setup with a 25-digit VM count!

**Conclusion**: Any integer validation using `test` or `[` on an unconstrained digit regex `^[0-9]+$` is vulnerable to overflow bypass. A digit length constraint (e.g. max 2 digits for VM count, max 5 digits for port) or bounded regex is mandatory.

### 3.3 Critical Edge Case 2: Bash Octal Trap on Leading Zeros

When `VM_COUNT="08"` is provided:
1. `! [[ "08" =~ ^[0-9]+$ ]]` is false.
2. `[ "08" -lt 1 ]` evaluates `"08"` as decimal 8 in coreutils `[`, which is false.
3. `[ "08" -gt 16 ]` is false.
4. Validation passes!
5. But downstream in line 126:
   ```bash
   for ((i=0; i<VM_COUNT; i++)); do
   ```
   Bash arithmetic `(( ... ))` interprets numbers with leading zero as **octal**. In octal, digits 8 and 9 are invalid.
   Bash crashes with:
   `/bin/bash: line 1: ((: 08: value too great for base (error token is "08")`

**Conclusion**: Values must either have leading zeros rejected (via regex `^[1-9]`), or normalized to decimal via base-10 expansion `VM_COUNT=$((10#${VM_COUNT}))`.

---

## 4. Fix Strategy Formulation & Comparison

We evaluated three potential fix strategies against a test suite of 28 adversarial inputs.

### Strategy 1: Literal Extension (Challenger/Reviewer Baseline)
```bash
if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
  echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
  exit 1
fi

if ! [[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || [ "${GATEWAY_PORT}" -lt 1 ] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
  echo "[-] Error: Gateway port must be between 1 and 65535 (got ${GATEWAY_PORT})." >&2
  exit 1
fi
```

### Strategy 2: Length Guard + Base-10 Normalization (Defensive Depth)
```bash
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

### Strategy 3: Bounded Non-Zero Leading Regex (Minimal & Structurally Safe)
```bash
if ! [[ "${VM_COUNT}" =~ ^[1-9][0-9]?$ ]] || [ "${VM_COUNT}" -gt 16 ]; then
  echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
  exit 1
fi

if ! [[ "${GATEWAY_PORT}" =~ ^[1-9][0-9]{0,4}$ ]] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
  echo "[-] Error: Gateway port must be between 1 and 65535 (got ${GATEWAY_PORT})." >&2
  exit 1
fi
```

---

## 5. Empirical Test Matrix

The following empirical results were obtained by executing `.agents/explorer_m3_fix_2/test_matrix.sh` on the actual runtime environment:

### 5.1 `VM_COUNT` Validation Results

| Test Input | Category | Expected | Strategy 1 | Strategy 2 | Strategy 3 | Notes |
|---|---|---|---|---|---|---|
| `'abc'` | Non-numeric string | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Fixed across all strategies |
| `'3.5'` | Floating point | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Fixed across all strategies |
| `''` | Empty string | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Fixed across all strategies |
| `' '` | Whitespace | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Fixed across all strategies |
| `'0'` | Below lower bound | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Correctly rejected |
| `'-1'` | Negative number | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Regex blocks minus sign |
| `'1'` | Minimum bound | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'3'` | Default value | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'8'` | Valid intermediate | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'08'` | Leading zero | Safe handling | PASS (Octal bug downstream) | **PASS (Normalized to 8)** | **FAIL (Strictly rejected)** | Strat 2 normalizes; Strat 3 rejects |
| `'16'` | Maximum bound | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'17'` | Above upper bound | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Correctly rejected |
| `'100'` | 3-digit number | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Correctly rejected |
| `'9999999999999999999999999'` | 25-digit 64-bit overflow | REJECT | **PASS (VULNERABLE BYPASS)** | **FAIL (REJECT)** | **FAIL (REJECT)** | **Strat 1 bypasses!** Strat 2 & 3 catch |

### 5.2 `GATEWAY_PORT` Validation Results

| Test Input | Category | Expected | Strategy 1 | Strategy 2 | Strategy 3 | Notes |
|---|---|---|---|---|---|---|
| `'abc'` | Non-numeric string | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Catches invalid token |
| `'3.5'` | Floating point | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Catches decimal |
| `''` | Empty string | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Catches empty token |
| `'0'` | Reserved port 0 | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Port 0 rejected |
| `'-1'` | Negative number | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Negative rejected |
| `'1'` | Minimum TCP port | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'80'` | HTTP standard port | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'50051'` | Default gRPC port | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'050051'` | 6-digit leading zero | REJECT | PASS (Unclean formatting) | **FAIL (REJECT)** | **FAIL (REJECT)** | Length/regex catches |
| `'65535'` | Maximum TCP port | ACCEPT | **PASS (ACCEPT)** | **PASS (ACCEPT)** | **PASS (ACCEPT)** | Valid |
| `'65536'` | Max + 1 | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Correctly rejected |
| `'70000'` | Out of bounds port | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Correctly rejected |
| `'100000'` | 6-digit port | REJECT | **FAIL (REJECT)** | **FAIL (REJECT)** | **FAIL (REJECT)** | Correctly rejected |
| `'9999999999999999999999999'` | 25-digit 64-bit overflow | REJECT | **PASS (VULNERABLE BYPASS)** | **FAIL (REJECT)** | **FAIL (REJECT)** | **Strat 1 bypasses!** Strat 2 & 3 catch |

---

## 6. Recommended Solution & Code Patch

### Selection Rationale
- **Strategy 2** is recommended if the codebase prefers permissive input with automatic decimal normalization (e.g. accepting `08` as 8).
- **Strategy 3** is recommended if the codebase adheres to strict CLI flag discipline (rejecting leading zeros and enforcing the principle of least complexity / shortest working diff per Ponytail guidelines).
- Both Strategy 2 and Strategy 3 completely solve Defect 2, prevent 64-bit overflow bypasses, and prevent downstream octal errors.
- Below is the **Strategy 2 (Defensive Depth)** implementation, which directly extends the `^[0-9]+$` regex requested by `challenger_m3_1` and `reviewer_m3_2` while securing the integer bounds:

### Proposed Replacement in `scripts/setup-cluster.sh`

#### Target File
`c:\Users\tyson\.repo\personal\frostfire-cloud\scripts\setup-cluster.sh`

#### Before (Lines 69–72)
```bash
if [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
  echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
  exit 1
fi
```

#### After (Lines 69–80)
```bash
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

#### Diff Patch Representation
```diff
--- a/scripts/setup-cluster.sh
+++ b/scripts/setup-cluster.sh
@@ -69,4 +69,12 @@
-if [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
+if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${#VM_COUNT}" -gt 2 ] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
   echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
   exit 1
 fi
+VM_COUNT=$((10#${VM_COUNT}))
+
+if ! [[ "${GATEWAY_PORT}" =~ ^[0-9]+$ ]] || [ "${#GATEWAY_PORT}" -gt 5 ] || [ "${GATEWAY_PORT}" -lt 1 ] || [ "${GATEWAY_PORT}" -gt 65535 ]; then
+  echo "[-] Error: Gateway port must be between 1 and 65535 (got ${GATEWAY_PORT})." >&2
+  exit 1
+fi
+GATEWAY_PORT=$((10#${GATEWAY_PORT}))
```

---

## 7. Verification Method

Once implemented by `worker_m3_1`, the fix can be verified using the following commands:

```bash
# 1. Verify invalid VM count rejection (must exit 1 with error message):
bash scripts/setup-cluster.sh --vms abc --dry-run
bash scripts/setup-cluster.sh --vms 3.5 --dry-run
bash scripts/setup-cluster.sh --vms 0 --dry-run
bash scripts/setup-cluster.sh --vms 17 --dry-run
bash scripts/setup-cluster.sh --vms 9999999999999999999999999 --dry-run

# 2. Verify invalid Gateway Port rejection (must exit 1 with error message):
bash scripts/setup-cluster.sh --gateway-port abc --dry-run
bash scripts/setup-cluster.sh --gateway-port 0 --dry-run
bash scripts/setup-cluster.sh --gateway-port 65536 --dry-run
bash scripts/setup-cluster.sh --gateway-port 70000 --dry-run
bash scripts/setup-cluster.sh --gateway-port 9999999999999999999999999 --dry-run

# 3. Verify valid preflight dry-run execution (must exit 0):
bash scripts/setup-cluster.sh --cluster-name frostfire-test --vms 3 --gateway-port 50051 --dry-run

# 4. Verify syntax and absence of regressions:
bash -n scripts/setup-cluster.sh
cargo test -p frostfire-e2e
```
