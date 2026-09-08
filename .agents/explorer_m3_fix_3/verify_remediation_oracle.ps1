# ==============================================================================
# Frostfire Cloud Milestone 3 Iteration 2 — Verification Oracle
# Automated verification harness for remediation worker
# ==============================================================================
param(
    [switch]$SkipCargo
)

$ErrorActionPreference = "Stop"
$repoRoot = (Get-Item -Path $PSScriptRoot\..\..).FullName
Set-Location $repoRoot

$oraclePassed = $true
$totalChecks = 0
$passedChecks = 0
$failedChecks = 0

function Assert-Oracle {
    param(
        [string]$Description,
        [scriptblock]$Predicate
    )
    $script:totalChecks++
    try {
        $result = & $Predicate
        if ($result -eq $true) {
            $script:passedChecks++
            Write-Host "  [PASS] $Description" -ForegroundColor Green
        } else {
            $script:failedChecks++
            $script:oraclePassed = $false
            Write-Host "  [FAIL] $Description (Predicate returned false)" -ForegroundColor Red
        }
    } catch {
        $script:failedChecks++
        $script:oraclePassed = $false
        Write-Host "  [FAIL] $Description (Exception: $_)" -ForegroundColor Red
    }
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Frostfire Cloud M3 Iteration 2 Verification Oracle" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ------------------------------------------------------------------------------
# Check 1: PowerShell AST Syntax Validation
# ------------------------------------------------------------------------------
Write-Host "`n--- Oracle Check 1: PowerShell Script AST Syntax ---" -ForegroundColor Yellow
$psScripts = Get-ChildItem "scripts" -Filter "*.ps1"
foreach ($psScript in $psScripts) {
    Assert-Oracle "AST parse of $($psScript.Name) has 0 errors" {
        $errors = $null
        $tokens = $null
        [System.Management.Automation.Language.Parser]::ParseFile($psScript.FullName, [ref]$tokens, [ref]$errors)
        return ($errors.Count -eq 0)
    }
}

# ------------------------------------------------------------------------------
# Check 2: PowerShell Tag Resolution Oracle (0, 1, and N matches)
# ------------------------------------------------------------------------------
Write-Host "`n--- Oracle Check 2: PowerShell Tag Resolution & String Preservation ---" -ForegroundColor Yellow
$scriptsToTest = @("scripts/cloud-start.ps1", "scripts/cloud-status.ps1", "scripts/cloud-stop.ps1")

foreach ($scr in $scriptsToTest) {
    $scriptName = Split-Path $scr -Leaf

    # 0 Matches
    Assert-Oracle "[$scriptName] 0 matches -> Exits 1 with resolution error" {
        $cmd = @"
function aws { return 'None' }
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$out = (& '$scr' -Region us-west-2 -DryRun *>&1) -join "`n"
    if (`$LASTEXITCODE -ne 0) { exit 0 } else { exit 1 }
} catch { exit 0 }
"@
        $res = pwsh -NoProfile -Command $cmd
        return ($LASTEXITCODE -eq 0)
    }

    # 1 Match (Full ID Preservation)
    Assert-Oracle "[$scriptName] 1 match ('i-0123456789abcdef4') -> Full string preserved, NOT char 'i'" {
        $cmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return 'i-0123456789abcdef4'
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$out = (& '$scr' -Region us-west-2 -DryRun *>&1) -join "`n"
    if (`$out -match "'i-0123456789abcdef4'" -and `$out -notmatch "'i'") { exit 0 } else { exit 1 }
} catch { exit 1 }
"@
        $res = pwsh -NoProfile -Command $cmd
        return ($LASTEXITCODE -eq 0)
    }

    # N Matches (First Full ID)
    Assert-Oracle "[$scriptName] N matches -> Resolves to first full string ID" {
        $cmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return 'i-01111111111111111`ti-02222222222222222'
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$out = (& '$scr' -Region us-west-2 -DryRun *>&1) -join "`n"
    if (`$out -match "'i-01111111111111111'") { exit 0 } else { exit 1 }
} catch { exit 1 }
"@
        $res = pwsh -NoProfile -Command $cmd
        return ($LASTEXITCODE -eq 0)
    }
}

# ------------------------------------------------------------------------------
# Check 3: Bash Cluster Setup Syntax & Line Endings
# ------------------------------------------------------------------------------
Write-Host "`n--- Oracle Check 3: Bash Cluster Setup Syntax & LF Discipline ---" -ForegroundColor Yellow
Assert-Oracle "bash -n scripts/setup-cluster.sh passes with 0 syntax errors" {
    $out = bash -n scripts/setup-cluster.sh 2>&1
    return ($LASTEXITCODE -eq 0)
}

Assert-Oracle "scripts/setup-cluster.sh contains 0 CRLF line endings (100% LF)" {
    $bytes = [System.IO.File]::ReadAllBytes("$repoRoot/scripts/setup-cluster.sh")
    $crCount = ($bytes | Where-Object { $_ -eq 0x0D }).Count
    return ($crCount -eq 0)
}

# ------------------------------------------------------------------------------
# Check 4: Bash Boundary Validation for setup-cluster.sh
# ------------------------------------------------------------------------------
Write-Host "`n--- Oracle Check 4: Bash Boundary Validation ---" -ForegroundColor Yellow

$badVmCounts = @("abc", "3.5", "", "   ", "!@#", "*", "1a", "0x10", "0", "-1", "17", "100", "9999999999999999999999999")
foreach ($badVm in $badVmCounts) {
    Assert-Oracle "VM_COUNT '$badVm' rejected with exit code 1" {
        $out = bash scripts/setup-cluster.sh --vms "$badVm" --dry-run 2>&1
        $ec = $LASTEXITCODE
        $noLeak = -not ($out -match "integer expression expected|syntax error")
        return ($ec -ne 0 -and $noLeak)
    }
}

$goodVmCounts = @("1", "3", "8", "16")
foreach ($goodVm in $goodVmCounts) {
    Assert-Oracle "VM_COUNT '$goodVm' accepted with exit code 0" {
        $out = bash scripts/setup-cluster.sh --vms "$goodVm" --dry-run 2>&1
        return ($LASTEXITCODE -eq 0)
    }
}

$badPorts = @("abc", "50051.5", "", "0", "-1", "65536", "70000", "9999999999999999999999999")
foreach ($badPort in $badPorts) {
    Assert-Oracle "GATEWAY_PORT '$badPort' rejected with exit code 1" {
        $out = bash scripts/setup-cluster.sh --gateway-port "$badPort" --dry-run 2>&1
        $ec = $LASTEXITCODE
        $noLeak = -not ($out -match "integer expression expected|syntax error")
        return ($ec -ne 0 -and $noLeak)
    }
}

$goodPorts = @("1", "50051", "65535")
foreach ($goodPort in $goodPorts) {
    Assert-Oracle "GATEWAY_PORT '$goodPort' accepted with exit code 0" {
        $out = bash scripts/setup-cluster.sh --gateway-port "$goodPort" --dry-run 2>&1
        return ($LASTEXITCODE -eq 0)
    }
}

# ------------------------------------------------------------------------------
# Check 5: Network Isolation Invariants
# ------------------------------------------------------------------------------
Write-Host "`n--- Oracle Check 5: Network Isolation Invariants ---" -ForegroundColor Yellow
Assert-Oracle "Zero NAT MASQUERADE rules across shell and YAML files" {
    $files = @("cloud/microvm/host-setup.sh", "deploy/aws/firecracker-hypervisor.yaml", "scripts/setup-cluster.sh")
    foreach ($f in $files) {
        $text = Get-Content "$repoRoot/$f" -Raw
        if ($text -match '(?m)^[^#\n]*(-A|-I|--append|--insert)[^\n]*-j\s+MASQUERADE') {
            return $false
        }
    }
    return $true
}

Assert-Oracle "Explicit POSTROUTING -s 172.16.0.0/16 -j RETURN rules present" {
    $files = @("cloud/microvm/host-setup.sh", "deploy/aws/firecracker-hypervisor.yaml", "scripts/setup-cluster.sh")
    foreach ($f in $files) {
        $text = Get-Content "$repoRoot/$f" -Raw
        if (-not ($text -match 'POSTROUTING -s 172\.16\.0\.0/16 -j RETURN')) {
            return $false
        }
    }
    return $true
}

# ------------------------------------------------------------------------------
# Check 6: Cargo Test & Clippy Gates
# ------------------------------------------------------------------------------
if (-not $SkipCargo) {
    Write-Host "`n--- Oracle Check 6: Cargo Test & Workspace Lint Gates ---" -ForegroundColor Yellow
    Assert-Oracle "cargo test -p frostfire-e2e passes (all tests passing)" {
        $out = cargo test -p frostfire-e2e 2>&1
        return ($LASTEXITCODE -eq 0)
    }

    Assert-Oracle "cargo clippy --workspace -- -D warnings passes (0 warnings)" {
        $out = cargo clippy --workspace -- -D warnings 2>&1
        return ($LASTEXITCODE -eq 0)
    }
}

# ------------------------------------------------------------------------------
# Oracle Summary
# ------------------------------------------------------------------------------
Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "Oracle Summary: Total: $totalChecks | Passed: $passedChecks | Failed: $failedChecks" -ForegroundColor $(if ($failedChecks -eq 0) { "Green" } else { "Red" })
Write-Host "VERDICT: $(if ($oraclePassed) { 'APPROVE (ALL ORACLE CHECKS PASSED)' } else { 'FAIL (ORACLE DETECTED FAILURES)' })" -ForegroundColor $(if ($oraclePassed) { "Green" } else { "Red" })
Write-Host "==========================================================" -ForegroundColor Cyan

if (-not $oraclePassed) { exit 1 } else { exit 0 }
