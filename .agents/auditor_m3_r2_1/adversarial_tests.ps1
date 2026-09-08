# Forensic Auditor Independent Adversarial Stress Tests
$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Forensic Auditor Adversarial Stress Test Harness" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$passCount = 0
$failCount = 0

function Assert-Test {
    param([string]$Name, [bool]$Condition)
    if ($Condition) {
        $global:passCount++
        Write-Host "  [PASS] $Name" -ForegroundColor Green
    } else {
        $global:failCount++
        Write-Host "  [FAIL] $Name" -ForegroundColor Red
    }
}

# -------------------------------------------------------------
# Section 1: PowerShell Scripts String Truncation & Tag Resolution
# -------------------------------------------------------------
Write-Host "`n--- Section 1: PowerShell Scripts Resolution Stress ---" -ForegroundColor Yellow

$scripts = @("scripts/cloud-start.ps1", "scripts/cloud-status.ps1", "scripts/cloud-stop.ps1")

foreach ($s in $scripts) {
    # Test 1: Single ID with mixed spaces, tabs, and newlines
    $cmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return "`n`t  i-0123456789abcdef4   `t`n"
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$out = (& '$s' -Region us-west-2 -DryRun *>&1) -join "`n"
    if (`$out -match "'i-0123456789abcdef4'") { exit 0 } else { exit 1 }
} catch { exit 1 }
"@
    $res = pwsh -NoProfile -Command $cmd
    Assert-Test "$s - Whitespace padded ID preserves full 17-char string" ($LASTEXITCODE -eq 0)

    # Test 2: Multiple IDs separated by newlines and tabs, verify it selects the first full ID
    $cmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return "i-0aaaaaaaaaaaaaaa1`ni-0bbbbbbbbbbbbbbb2`ti-0ccccccccccccccc3"
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$out = (& '$s' -Region us-west-2 -DryRun *>&1) -join "`n"
    if (`$out -match "'i-0aaaaaaaaaaaaaaa1'") { exit 0 } else { exit 1 }
} catch { exit 1 }
"@
    $res = pwsh -NoProfile -Command $cmd
    Assert-Test "$s - Multiple newline/tab IDs resolves first full ID" ($LASTEXITCODE -eq 0)

    # Test 3: Legacy 8-char hex instance ID
    $cmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return "i-12345678"
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$out = (& '$s' -Region us-west-2 -DryRun *>&1) -join "`n"
    if (`$out -match "'i-12345678'") { exit 0 } else { exit 1 }
} catch { exit 1 }
"@
    $res = pwsh -NoProfile -Command $cmd
    Assert-Test "$s - Legacy 8-char instance ID resolved accurately" ($LASTEXITCODE -eq 0)

    # Test 4: Malformed ID rejection (e.g. non-hex chars like i-xyz12345 or too short i-123)
    $cmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return "i-xyz12345`ti-123456`ti-toolong1234567890123456789"
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$out = (& '$s' -Region us-west-2 -DryRun *>&1) -join "`n"
    if (`$LASTEXITCODE -ne 0) { exit 0 } else { exit 1 }
} catch { exit 0 }
"@
    $res = pwsh -NoProfile -Command $cmd
    Assert-Test "$s - Malformed non-hex / wrong length IDs cleanly rejected" ($LASTEXITCODE -eq 0)
}

# -------------------------------------------------------------
# Section 2: Bash Cluster Setup Boundary & Octal Trap Stress
# -------------------------------------------------------------
Write-Host "`n--- Section 2: Bash setup-cluster.sh Boundary & Octal Tests ---" -ForegroundColor Yellow

# Test 5: Leading zeros in VM_COUNT within 2-digit length bound
$octalVms = @("01", "08", "09", "16")
foreach ($ovm in $octalVms) {
    $out = bash scripts/setup-cluster.sh --vms "$ovm" --dry-run 2>&1
    $ec = $LASTEXITCODE
    $noErr = -not ($out -match "value too great for base|error")
    Assert-Test "VM_COUNT '$ovm' with leading zero handled cleanly (exit $ec)" ($ec -eq 0 -and $noErr)
}

# Test 6: Leading zeros in GATEWAY_PORT within 5-digit length bound (e.g. 080, 08080, 05005)
$octalPorts = @("080", "08080", "05005")
foreach ($opt in $octalPorts) {
    $out = bash scripts/setup-cluster.sh --gateway-port "$opt" --dry-run 2>&1
    $ec = $LASTEXITCODE
    $noErr = -not ($out -match "value too great for base|error")
    Assert-Test "GATEWAY_PORT '$opt' with leading zero within 5-char limit handled cleanly (exit $ec)" ($ec -eq 0 -and $noErr)
}

# Test 7: Rejection of port strings exceeding 5 digits (length violation / overflow defense)
$overflowPorts = @("050051", "100000", "999999")
foreach ($op in $overflowPorts) {
    $out = bash scripts/setup-cluster.sh --gateway-port "$op" --dry-run 2>&1
    $ec = $LASTEXITCODE
    Assert-Test "GATEWAY_PORT '$op' (> 5 chars) rejected with exit 1" ($ec -ne 0)
}

# Test 8: Rejection of invalid leading zero values (00, 000, 017)
$badOctal = @("00", "000", "017")
foreach ($bo in $badOctal) {
    $out = bash scripts/setup-cluster.sh --vms "$bo" --dry-run 2>&1
    $ec = $LASTEXITCODE
    Assert-Test "VM_COUNT invalid '$bo' rejected with exit 1" ($ec -ne 0)
}

# -------------------------------------------------------------
# Section 3: Invariant & Secret Checks
# -------------------------------------------------------------
Write-Host "`n--- Section 3: Invariant & Secret Checks ---" -ForegroundColor Yellow

# Test 9: Git untracked status of fixtures/cert.pem and fixtures/key.pem
$gitFixtures = git ls-files cloud/gateway/tests/fixtures/ 2>&1
Assert-Test "Fixtures directory is strictly uncommitted in git index" ([string]::IsNullOrEmpty($gitFixtures))

# Test 10: Zero occurrences of MASQUERADE append across entire repo
$masqAppends = Select-String -Path "cloud/microvm/*","scripts/*","deploy/aws/*" -Pattern '(-A|-I)\s+POSTROUTING.*-j\s+MASQUERADE'
Assert-Test "Zero append or insert of MASQUERADE in any setup script" ($null -eq $masqAppends)

# Test 11: Verify subtle::ConstantTimeEq is used in TenantAuthenticator
$authRs = Get-Content "cloud/gateway/src/auth.rs" -Raw
$hasCtEq = ($authRs -match 'use subtle::ConstantTimeEq;' -and $authRs -match '\.ct_eq\(')
Assert-Test "TenantAuthenticator uses subtle::ConstantTimeEq" $hasCtEq

# Test 12: Verify sand-window-router.mjs enforces token on display 1 and uses timingSafeEqual
$routerMjs = Get-Content "cloud/microvm/scripts/sand-window-router.mjs" -Raw
$hasDisplay1Token = ($routerMjs -match 'if \(bound === undefined \|\| !tokensMatch\(owner, bound\)\)' -and $routerMjs -match 'timingSafeEqual')
Assert-Test "sand-window-router.mjs enforces token on all displays including 1" $hasDisplay1Token

# -------------------------------------------------------------
# Summary
# -------------------------------------------------------------
Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "Adversarial Stress Test Summary: Total: $($passCount + $failCount) | Passed: $passCount | Failed: $failCount" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Red" })
Write-Host "==========================================================" -ForegroundColor Cyan

if ($failCount -gt 0) { exit 1 } else { exit 0 }
