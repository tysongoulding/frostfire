# Investigation Report: Defect 1 — PowerShell Tier 4 Resolution Scalar Truncation

**Investigator**: `explorer_m3_fix_1` (Teamwork Explorer)  
**Date**: 2026-09-08T22:01:00Z  
**Target Milestone**: Milestone 3 (AWS Production Infrastructure & Network Isolation)  
**Reference Defect**: Defect 1 identified by `challenger_m3_1` (`.agents/challenger_m3_1/handoff.md`)  

---

## 1. Executive Summary

During Milestone 3 validation, `challenger_m3_1` discovered a critical defect in the PowerShell cloud management scripts (`scripts/cloud-start.ps1`, `scripts/cloud-status.ps1`, and `scripts/cloud-stop.ps1`). When resolving an EC2 hypervisor via Tier 4 tag filtering (`aws ec2 describe-instances --filters "Name=tag:Name,Values=$NameTag"`), PowerShell's pipeline unwrapping behavior turns a single matching instance ID into a scalar `System.String`. Subsequent indexing with `$ids[0]` invokes the string character indexer rather than array element indexing, truncating the instance ID to the single character `'i'`.

In dry-run executions, the scripts output `[DRY-RUN] Would start instance 'i' in region 'us-west-2'`. In live AWS executions, commands such as `aws ec2 start-instances --instance-ids i` fail immediately with `InvalidInstanceID.Malformed`.

This report provides the complete root cause breakdown, empirical behavioral analysis across 0, 1, and N matching IDs, comparison of remediation strategies, and the exact code patch required for `worker_m3_1`.

---

## 2. Affected Scripts and Exact Locations

All three scripts share identical Tier 4 resolution logic:

| Script | Line Range | Current Line Content |
|---|---|---|
| `scripts/cloud-start.ps1` | Lines 33–39 | Line 36: `$ids = $ec2 -split "\s+" \| Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }` |
| `scripts/cloud-status.ps1` | Lines 33–39 | Line 36: `$ids = $ec2 -split "\s+" \| Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }` |
| `scripts/cloud-stop.ps1` | Lines 34–40 | Line 37: `$ids = $ec2 -split "\s+" \| Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }` |

### Context in Code (`scripts/cloud-start.ps1`, Lines 33–39):
```powershell
33: if (-not $InstanceId -and $NameTag) {
34:     $ec2 = (aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$NameTag" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[].Instances[].InstanceId" --output text 2>$null)
35:     if ($ec2 -and $ec2 -ne "None" -and -not $ec2.StartsWith("An error occurred")) {
36:         $ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
37:         if ($ids.Count -ge 1) { $InstanceId = $ids[0] }
38:     }
39: }
```

---

## 3. Root Cause Analysis

PowerShell pipelines feature automatic collection unrolling:
1. **Pipeline Unwrapping**: When a pipeline expression is assigned to a variable (`$ids = ... | Where-Object ...`), PowerShell automatically unwraps single-element collections into a scalar object. If the pipeline yields one item, `$ids` is typed as `System.String`, not `System.Object[]`.
2. **Synthetic `.Count` Property**: In PowerShell 3.0 and later, scalar objects are given a synthetic `.Count` property that returns `1`. Thus, `if ($ids.Count -ge 1)` evaluates to `True`, concealing the scalar type from the conditional check.
3. **String Character Indexer**: In .NET / PowerShell, indexing a `System.String` (`$string[0]`) invokes the character indexer `System.String.Chars[int index]`, returning `[System.Char]'i'`.
4. **String Coercion**: Because `$InstanceId` is a string variable (`[string]$InstanceId`), `[char]'i'` is coerced to string `"i"`.
5. **AWS API Failure**: Downstream AWS CLI operations receive `--instance-ids i`. AWS rejects any instance ID that does not conform to the EC2 ID regex (`^i-[0-9a-f]{8,17}$`), terminating execution with `InvalidInstanceID.Malformed`.

---

## 4. Empirical Behavior Across ID Cardinalities (0, 1, and N)

Empirical testing was conducted using PowerShell 7.5.0 across all three cardinalities.

### 4.1 Cardinality N = 1 (Single Instance Match — THE DEFECT CASE)
- **Input**: EC2 query returns `"i-0123456789abcdef4"`.
- **Unwrapped (`$ids = ...`)**:
  - `$ids.GetType().FullName`: `System.String`
  - `$ids.Count`: `1` (synthetic property)
  - `$ids[0].GetType().FullName`: `System.Char`
  - `$ids[0]`: `'i'`
  - `$InstanceId`: `"i"`
  - **Result**: **BROKEN** (`[DRY-RUN] Would start instance 'i' in region 'us-west-2'`).
- **Array-Wrapped (`$ids = @(...)`)**:
  - `$ids.GetType().FullName`: `System.Object[]`
  - `$ids.Count`: `1` (array length)
  - `$ids[0].GetType().FullName`: `System.String`
  - `$ids[0]`: `"i-0123456789abcdef4"`
  - `$InstanceId`: `"i-0123456789abcdef4"`
  - **Result**: **PASS** (`[DRY-RUN] Would start instance 'i-0123456789abcdef4' in region 'us-west-2'`).

### 4.2 Cardinality N = 0 (No Matching Instances)
- **Input**: EC2 query returns `"None"` or empty string `""`.
- **Unwrapped (`$ids = ...`)**:
  - `$ids`: `$null`
  - `$ids.Count`: `0`
  - Indexing `$ids[0]`: Throws `InvalidOperation: Cannot index into a null array` in PowerShell Core if evaluated directly. In current code, `if ($ids.Count -ge 1)` evaluates to `False`, so line 37 is skipped.
  - Line 41: `if (-not $InstanceId)` triggers `Write-Error` and `exit 1`.
  - **Result**: Fails resolution cleanly with exit code 1.
- **Array-Wrapped (`$ids = @(...)`)**:
  - `$ids.GetType().FullName`: `System.Object[]`
  - `$ids.Count`: `0` (zero-element array)
  - Indexing `$ids[0]`: Safely evaluates to `$null` without throwing null-reference exceptions.
  - `if ($ids.Count -ge 1)`: Evaluates to `False` (`0 -ge 1` is false).
  - Line 41: `if (-not $InstanceId)` triggers `Write-Error` and `exit 1`.
  - **Result**: **PASS** (Fails resolution cleanly with exit code 1 and consistent empty array type).

### 4.3 Cardinality N >= 2 (Multiple Matching Instances)
- **Input**: EC2 query returns `"i-0123456789abcdef4 i-0987654321fedcba0"`.
- **Unwrapped (`$ids = ...`)**:
  - Pipeline naturally produces 2 items, so PowerShell leaves it as `System.Object[]`.
  - `$ids.Count`: `2`
  - `$ids[0]`: `"i-0123456789abcdef4"`
  - **Result**: Resolves to first instance ID `"i-0123456789abcdef4"`.
- **Array-Wrapped (`$ids = @(...)`)**:
  - `$ids.GetType().FullName`: `System.Object[]`
  - `$ids.Count`: `2`
  - `$ids[0]`: `"i-0123456789abcdef4"`
  - **Result**: **PASS** (Resolves to first instance ID `"i-0123456789abcdef4"`).

### 4.4 Summary Matrix

| Cardinality | Unwrapped Type | Unwrapped `$ids[0]` | Unwrapped Outcome | Wrapped Type | Wrapped `$ids[0]` | Wrapped Outcome |
|---|---|---|---|---|---|---|
| **0 Matching IDs** | `$null` | Throws if accessed | Clean exit 1 (guarded) | `Object[0]` | `$null` | **Clean exit 1** |
| **1 Matching ID** | `String` | `'i'` (Char) | **DEFECT (Malformed ID)** | `Object[1]` | `"i-01234..."` (String) | **PASS (Full ID)** |
| **N >= 2 Matching IDs** | `Object[N]` | `"i-01234..."` (String) | Resolves to first ID | `Object[N]` | `"i-01234..."` (String) | **PASS (Full ID)** |

---

## 5. Evaluation of Fix Strategies

| Strategy | Syntax | Pros | Cons | Verdict |
|---|---|---|---|---|
| **Strategy 1: Array Subexpression `@(...)`** | `$ids = @($ec2 -split "\s+" \| Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' })` | • Canonical PowerShell idiom<br>• Guaranteed `Object[]` across 0, 1, and N<br>• Minimal diff (+2 chars: `@(` and `)`)<br>• 100% backward & forward compatible (PS 5.1 & PS 7+) | None | **RECOMMENDED** |
| **Strategy 2: Typed Array Declaration** | `[string[]]$ids = $ec2 -split ...` | Explicit typing | When pipeline is empty, `[string[]]$ids = $null` sets `$ids` to `$null` (does NOT instantiate empty array) | REJECTED |
| **Strategy 3: Pipeline `Select-Object -First 1`** | `$InstanceId = $ec2 -split ... \| Select-Object -First 1` | Inline assignment | Removes `$ids.Count` verification check; changes script structure | SUBOPTIMAL |

---

## 6. Proposed Fix Specification

### 6.1 `scripts/cloud-start.ps1`
**Target**: Line 36  
```diff
--- a/scripts/cloud-start.ps1
+++ b/scripts/cloud-start.ps1
@@ -33,7 +33,7 @@
 if (-not $InstanceId -and $NameTag) {
     $ec2 = (aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$NameTag" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[].Instances[].InstanceId" --output text 2>$null)
     if ($ec2 -and $ec2 -ne "None" -and -not $ec2.StartsWith("An error occurred")) {
-        $ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
+        $ids = @($ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' })
         if ($ids.Count -ge 1) { $InstanceId = $ids[0] }
     }
 }
```

### 6.2 `scripts/cloud-status.ps1`
**Target**: Line 36  
```diff
--- a/scripts/cloud-status.ps1
+++ b/scripts/cloud-status.ps1
@@ -33,7 +33,7 @@
 if (-not $InstanceId -and $NameTag) {
     $ec2 = (aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$NameTag" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[].Instances[].InstanceId" --output text 2>$null)
     if ($ec2 -and $ec2 -ne "None" -and -not $ec2.StartsWith("An error occurred")) {
-        $ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
+        $ids = @($ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' })
         if ($ids.Count -ge 1) { $InstanceId = $ids[0] }
     }
 }
```

### 6.3 `scripts/cloud-stop.ps1`
**Target**: Line 37  
```diff
--- a/scripts/cloud-stop.ps1
+++ b/scripts/cloud-stop.ps1
@@ -34,7 +34,7 @@
 if (-not $InstanceId -and $NameTag) {
     $ec2 = (aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$NameTag" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[].Instances[].InstanceId" --output text 2>$null)
     if ($ec2 -and $ec2 -ne "None" -and -not $ec2.StartsWith("An error occurred")) {
-        $ids = $ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' }
+        $ids = @($ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' })
         if ($ids.Count -ge 1) { $InstanceId = $ids[0] }
     }
 }
```

---

## 7. Verification Results

### 7.1 Empirical Test Harness Run
An automated mock-isolated test was executed across all three scripts with the proposed patch applied:

```
==========================================
Evaluating scripts/cloud-start.ps1
==========================================
N=1: [DRY-RUN] Would start instance 'i-0123456789abcdef4' in region 'us-west-2'.
N=2: [DRY-RUN] Would start instance 'i-0123456789abcdef4' in region 'us-west-2'.
N=0: Write-Error: [-] Frostfire InstanceId could not be resolved. Pass -InstanceId, set $env:FROSTFIRE_INSTANCE_ID, or configure CloudFormation stack 'frostfire-aws'.
==========================================
Evaluating scripts/cloud-status.ps1
==========================================
N=1: [DRY-RUN] Would query status for instance 'i-0123456789abcdef4' in region 'us-west-2'.
N=2: [DRY-RUN] Would query status for instance 'i-0123456789abcdef4' in region 'us-west-2'.
N=0: Write-Error: [-] Frostfire InstanceId could not be resolved. Pass -InstanceId, set $env:FROSTFIRE_INSTANCE_ID, or configure CloudFormation stack 'frostfire-aws'.
==========================================
Evaluating scripts/cloud-stop.ps1
==========================================
N=1: [DRY-RUN] Would stop instance 'i-0123456789abcdef4' in region 'us-west-2'.
N=2: [DRY-RUN] Would stop instance 'i-0123456789abcdef4' in region 'us-west-2'.
N=0: Write-Error: [-] Frostfire InstanceId could not be resolved. Pass -InstanceId, set $env:FROSTFIRE_INSTANCE_ID, or configure CloudFormation stack 'frostfire-aws'.
```

### 7.2 AST Parser Validation
`[System.Management.Automation.Language.Parser]::ParseInput` was executed on all three modified scripts. Parse error count was **0** across all files.

---

## 8. Conclusion and Next Steps

The proposed 1-line wrap `@(...)` in `scripts/cloud-start.ps1`, `scripts/cloud-status.ps1`, and `scripts/cloud-stop.ps1` completely eliminates Defect 1 without introducing side effects or regressions across 0, 1, or N matching IDs.

The patch is ready for immediate application by the implementation worker (`worker_m3_1`).
