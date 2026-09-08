# Handoff Report: Adversarial Empirical Review of Milestone 3

**Author**: `challenger_m3_1` (Critic / Specialist / Empirical Challenger)  
**Recipient**: `parent` (`a683d2a2-4cae-4a3a-a587-8741f091dc4b`)  
**Working Directory**: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\challenger_m3_1`  
**Handoff Type**: Hard  
**Verdict**: **FAIL** (2 Confirmed Defects Identified; Remediations Documented)  
**Date**: 2026-09-08T22:00:00Z  

---

## 1. Observation

Direct empirical observations, commands executed, and verbatim outputs:

### 1.1 Network Isolation Invariants (F13)
Ran invariant harness inspecting `cloud/microvm/host-setup.sh`, `deploy/aws/firecracker-hypervisor.yaml`, and `scripts/setup-cluster.sh`:
- **Active MASQUERADE Rule Check**:
  ```powershell
  [regex]::Matches($content, '(?m)^[^#\n]*(-A|-I|--append|--insert)[^\n]*-j\s+MASQUERADE')
  ```
  Result: 0 matches found across all files.
- **Explicit POSTROUTING RETURN Rule**:
  - `cloud/microvm/host-setup.sh` line 67: `sudo iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -j RETURN`
  - `deploy/aws/firecracker-hypervisor.yaml` line 288: `iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -j RETURN 2>/dev/null || true`
  - `scripts/setup-cluster.sh` line 143: `sudo iptables -t nat -A POSTROUTING -s 172.16.0.0/16 -j RETURN`
- **IMDS (`169.254.169.254`) DROP Rules**:
  - `cloud/microvm/host-setup.sh` lines 89–99: Both `FORWARD -d 169.254.169.254/32 -j DROP` and `INPUT -i "${TAP}" -d 169.254.169.254/32 -j DROP` present.
  - `deploy/aws/firecracker-hypervisor.yaml` lines 298–299: Both `FORWARD -s 172.16.0.0/16 -d 169.254.169.254 -j DROP` and `INPUT -i tap+ -d 169.254.169.254 -j DROP` present.
  - `scripts/setup-cluster.sh` lines 161–168: Both `FORWARD -d 169.254.169.254/32 -j DROP` and `INPUT -i "${TAP}" -d 169.254.169.254/32 -j DROP` present.
- **WAN & Cross-Tenant Forwarding DROP Rules**:
  - Present in all three files: `FORWARD -i tap+ -o ${PRIMARY_IFACE} -j DROP`, `FORWARD -i ${PRIMARY_IFACE} -o tap+ -j DROP`, and `FORWARD -i tap+ -o tap+ -j DROP`.

### 1.2 PowerShell Script Verification & Resolution Hierarchy (F14)
- **AST Parsing**:
  - `[System.Management.Automation.Language.Parser]::ParseFile` executed on `cloud-start.ps1`, `cloud-status.ps1`, `cloud-stop.ps1`. All 3 parsed cleanly with 0 syntax errors.
- **-DryRun Flag & Precedence (Tiers 1, 2a, 2b, 3)**:
  - `-InstanceId` (Tier 1) properly takes precedence over env vars and queries.
  - `$env:FROSTFIRE_INSTANCE_ID` (Tier 2a) properly overrides `$env:AWS_INSTANCE_ID` (Tier 2b).
  - Unresolved state exits with non-zero code (`LASTEXITCODE=1`) across all three scripts.
  - CloudFormation output `HypervisorInstanceId` (Tier 3) properly resolves.
- **[DEFECT 1 — CRITICAL] Tier 4 Tag Filter String Truncation**:
  In `scripts/cloud-start.ps1` (lines 36–37), `scripts/cloud-status.ps1` (lines 36–37), and `scripts/cloud-stop.ps1` (lines 37–38):
  ```powershell
  $ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
  if ($ids.Count -ge 1) { $InstanceId = $ids[0] }
  ```
  When the EC2 describe query returns a single instance ID (e.g. `i-0123456789abcdef4`), `Where-Object` emits a scalar `System.String` rather than an array.
  Evaluating `$ids[0]` on a `System.String` returns `[char]'i'` (the first character of the string), which stringifies to `"i"`.
  Empirical run:
  ```powershell
  pwsh -Command {
      $ec2 = "i-0123456789abcdef4"
      $ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
      Write-Host "ids[0]: $($ids[0])"
  }
  # Output: ids[0]: i
  ```
  Consequently, in dry-run and live executions, the script attempts to operate on instance `"i"`:
  `[DRY-RUN] Would start instance 'i' in region 'us-west-2'.`
  Live commands (`aws ec2 start-instances --instance-ids i ...`) fail with `InvalidInstanceID.Malformed`.

### 1.3 Cluster Script Verification (F14)
- `bash -n scripts/setup-cluster.sh`: Exited 0 with no syntax errors.
- Line endings: Verified byte-for-byte in PowerShell: Total bytes: 10432, CR (`0x0D`): 0, LF (`0x0A`): 265. 100% LF Unix newlines.
- Cluster name validation: Rejects empty strings, spaces, underscores, and special characters (enforcing `^[a-zA-Z0-9-]+$`).
- VM count boundary: Rejects `0`, `-1`, and `17` with exit code 1.
- **[DEFECT 2 — MEDIUM] Non-Integer VM Count Validation Bypass**:
  In `scripts/setup-cluster.sh` lines 69–72:
  ```bash
  if [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
    echo "[-] Error: VM count must be between 1 and 16 (got ${VM_COUNT})." >&2
    exit 1
  fi
  ```
  When passing `--vms abc` or `--vms 3.5`, bash integer comparison operator `-lt` encounters non-integer tokens and emits:
  `scripts/setup-cluster.sh: line 69: [: abc: integer expression expected`
  Both `-lt` and `-gt` return status 2 (false). Because neither condition evaluates to true, execution falls through the `if` block and proceeds to dry-run / setup:
  ```
  === Frostfire MicroVM Cluster Setup: frostfire-prod ===
  scripts/setup-cluster.sh: line 69: [: abc: integer expression expected
  scripts/setup-cluster.sh: line 69: [: abc: integer expression expected
  [DRY-RUN] Preflight parameters valid:
    - Cluster Name:   frostfire-prod
    - MicroVM Count:  abc
  ...
  ExitCode: 0
  ```
  In live execution, arithmetic evaluation `for ((i=0; i<VM_COUNT; i++))` treats undeclared `abc` as 0, provisioning zero VMs without raising an error.

### 1.4 Test Suites & CloudFormation Validation
- `cargo test -p frostfire-e2e`: 175 passed; 0 failed; 0 ignored (duration ~0.6s).
- `cargo test --workspace`: 100% passed across all workspace crates.
- `cargo clippy --workspace -- -D warnings`: 0 warnings.
- CloudFormation validation: `aws cloudformation validate-template` passed with 0 errors on `cloudformation.yaml`, `firecracker-hypervisor.yaml`, and `poc-3user.yaml`.

---

## 2. Logic Chain

1. **Security Invariant Compliance (F13)**:
   - Observations 1.1 confirm that no NAT MASQUERADE rules exist in the repository, explicit `-j RETURN` safeguards are established, and IMDS and WAN forward drops are active. This fully satisfies the network isolation invariant in `AGENTS.md` and `PROJECT.md`.
2. **Defect 1 Cause and Impact**:
   - Observations 1.2 demonstrate that indexing a pipeline-filtered scalar string `$ids[0]` evaluates to the character `'i'`.
   - When users rely on EC2 tag resolution (Tier 4) to start, stop, or check status on hypervisors, the scripts fail because AWS rejects instance ID `'i'`.
   - This breaks Feature F14 acceptance criteria for turnkey deployment scripts.
3. **Defect 2 Cause and Impact**:
   - Observations 1.3 show that bash test `[ "${VM_COUNT}" -lt 1 ]` fails to validate that the variable is an integer before arithmetic comparison.
   - Malformed inputs like `--vms abc` exit with code 0 instead of code 1, violating input boundary contracts.
4. **Conclusion Derivation**:
   - While F13 and CloudFormation templates are cleanly implemented, the two verified defects in F14 deployment scripts require a verdict of **FAIL** until fixed.

---

## 3. Caveats

- **Bare-metal execution**: Live creation of AWS bare-metal instances ($4.08+/hr) and hardware KVM acceleration was simulated using mocked AWS API boundaries and dry-run execution paths to avoid unnecessary cloud billing.
- **Other tiers**: Tiers 1, 2a, 2b, and 3 of the PowerShell resolution hierarchy functioned as expected; only Tier 4 exhibited the scalar truncation bug.

---

## 4. Conclusion

**VERDICT**: **FAIL**

Milestone 3 cannot be approved until the following two fixes are applied by `worker_m3_1`:

### Actionable Remediation 1: Fix Tier 4 Scalar Truncation in PowerShell Scripts
In `scripts/cloud-start.ps1` (line 36), `scripts/cloud-status.ps1` (line 36), and `scripts/cloud-stop.ps1` (line 37), wrap the pipeline filter in array subexpression `@(...)`:
```powershell
# Change:
$ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
# To:
$ids = @($ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' })
```

### Actionable Remediation 2: Enforce Integer Validation in `scripts/setup-cluster.sh`
In `scripts/setup-cluster.sh` line 69, validate that `${VM_COUNT}` is composed purely of digits before numerical range checks:
```bash
# Change:
if [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
# To:
if ! [[ "${VM_COUNT}" =~ ^[0-9]+$ ]] || [ "${VM_COUNT}" -lt 1 ] || [ "${VM_COUNT}" -gt 16 ]; then
```

---

## 5. Verification Method

To reproduce both defects and independently verify the fixes:

1. **Reproduce Defect 1 (PowerShell Scalar Truncation)**:
   ```powershell
   pwsh -Command {
       $ec2 = "i-0123456789abcdef4"
       $ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
       Write-Host "Unwrapped: $($ids[0])"
       $idsArr = @($ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' })
       Write-Host "Array wrapped: $($idsArr[0])"
   }
   ```
2. **Reproduce Defect 2 (Cluster Script Non-Integer Bypass)**:
   ```bash
   bash scripts/setup-cluster.sh --vms abc --dry-run
   # Expected: Exit code 1 with "VM count must be between 1 and 16"
   # Current Actual: Exit code 0 with integer expression error and "[DRY-RUN] Preflight parameters valid"
   ```
3. **Verify Network Isolation & E2E Suites**:
   ```powershell
   cargo test -p frostfire-e2e
   cargo test --workspace
   cargo clippy --workspace -- -D warnings
   ```
