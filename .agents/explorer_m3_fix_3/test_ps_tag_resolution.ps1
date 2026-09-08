# PowerShell Tag Resolution Test Matrix
param(
    [switch]$VerboseOutput
)

$ErrorActionPreference = "Stop"

$scripts = @(
    "scripts/cloud-start.ps1",
    "scripts/cloud-status.ps1",
    "scripts/cloud-stop.ps1"
)

$testCases = @(
    @{
        Name = "TC-PS-01: Zero matching instances (empty string)"
        MockOutput = ""
        ExpectedSuccess = $false
        ExpectedInstanceId = $null
        Description = "Empty describe-instances output must fail resolution with exit code 1"
    },
    @{
        Name = "TC-PS-02: Zero matching instances (None output)"
        MockOutput = "None"
        ExpectedSuccess = $false
        ExpectedInstanceId = $null
        Description = "'None' describe-instances output must fail resolution with exit code 1"
    },
    @{
        Name = "TC-PS-03: Zero matching instances (non-matching tokens)"
        MockOutput = "ami-0123456789abcdef0 vol-0123456789abcdef0 subnet-12345678"
        ExpectedSuccess = $false
        ExpectedInstanceId = $null
        Description = "Non-instance ID tokens must not match regex ^i-[0-9a-f]{8,17}$"
    },
    @{
        Name = "TC-PS-04: Single 17-char hex instance ID"
        MockOutput = "i-0123456789abcdef4"
        ExpectedSuccess = $true
        ExpectedInstanceId = "i-0123456789abcdef4"
        Description = "Single modern 17-char instance ID must resolve to full string, not char 'i'"
    },
    @{
        Name = "TC-PS-05: Single 8-char legacy hex instance ID"
        MockOutput = "i-12345678"
        ExpectedSuccess = $true
        ExpectedInstanceId = "i-12345678"
        Description = "Single legacy 8-char instance ID must resolve to full string"
    },
    @{
        Name = "TC-PS-06: Single instance ID with surrounding whitespace and newlines"
        MockOutput = "`n`t  i-0abcdef0123456789  `t`n"
        ExpectedSuccess = $true
        ExpectedInstanceId = "i-0abcdef0123456789"
        Description = "Single instance ID with whitespace must trim and match full string"
    },
    @{
        Name = "TC-PS-07: Multiple instances (2 instances, tab-separated)"
        MockOutput = "i-0aaaaaaaaaaaaaaaa`ti-0bbbbbbbbbbbbbbbb"
        ExpectedSuccess = $true
        ExpectedInstanceId = "i-0aaaaaaaaaaaaaaaa"
        Description = "Multiple instances must resolve to the first matching instance ID"
    },
    @{
        Name = "TC-PS-08: Multiple instances (3 instances, space/newline separated)"
        MockOutput = "i-01111111111111111  i-02222222222222222`ni-03333333333333333"
        ExpectedSuccess = $true
        ExpectedInstanceId = "i-01111111111111111"
        Description = "Multiple instances across newlines must resolve to first instance"
    }
)

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "PowerShell Tag Resolution Test Matrix (Pre-Fix Assessment)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$totalTests = 0
$passedTests = 0
$failedTests = 0

foreach ($scriptPath in $scripts) {
    Write-Host "`n--- Testing Script: $scriptPath ---" -ForegroundColor Yellow

    foreach ($tc in $testCases) {
        $totalTests++
        $testName = $tc.Name
        $mockVal = $tc.MockOutput
        $expectSuccess = $tc.ExpectedSuccess
        $expectId = $tc.ExpectedInstanceId

        # Execute in separate pwsh process to avoid environment poisoning
        $pwshCmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return '$mockVal'
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
try {
    `$output = (& '$scriptPath' -Region us-west-2 -DryRun *>&1) -join "`n"
    `$ec = `$LASTEXITCODE
    Write-Host "OUT: `$output"
    Write-Host "EXIT: `$ec"
} catch {
    Write-Host "ERR: `$_"
    Write-Host "EXIT: 1"
}
"@

        $res = pwsh -NoProfile -Command $pwshCmd
        $outText = ($res | Where-Object { $_ -match '^OUT:' }) -replace '^OUT:\s*', ''
        $exitLine = ($res | Where-Object { $_ -match '^EXIT:' }) -replace '^EXIT:\s*', ''
        $exitCode = [int]($exitLine | Select-Object -Last 1)

        $passed = $false
        $failReason = ""

        if ($expectSuccess) {
            if ($exitCode -ne 0) {
                $failReason = "Expected exit code 0 but got $exitCode"
            } elseif ($outText -match "'$expectId'") {
                $passed = $true
            } elseif ($outText -match "'i'") {
                $failReason = "TRUNCATION DETECTED: Script resolved to 'i' instead of '$expectId'"
            } else {
                $failReason = "Output does not contain expected ID '$expectId'. Output: $outText"
            }
        } else {
            if ($exitCode -ne 0) {
                $passed = $true
            } else {
                $failReason = "Expected non-zero exit code for unresolved ID, but exited 0"
            }
        }

        if ($passed) {
            $passedTests++
            Write-Host "  [PASS] $testName" -ForegroundColor Green
        } else {
            $failedTests++
            Write-Host "  [FAIL] $testName" -ForegroundColor Red
            Write-Host "         Reason: $failReason" -ForegroundColor DarkRed
        }
    }
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "Summary: Total: $totalTests | Passed: $passedTests | Failed: $failedTests" -ForegroundColor $(if ($failedTests -eq 0) { "Green" } else { "Red" })
Write-Host "==========================================================" -ForegroundColor Cyan
