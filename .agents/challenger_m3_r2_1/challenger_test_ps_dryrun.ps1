# Challenger Empirical Test Harness: PowerShell Scripts 0, 1, 2 Matching IDs under -DryRun
param()

$ErrorActionPreference = "Stop"

$scripts = @(
    "scripts/cloud-start.ps1",
    "scripts/cloud-status.ps1",
    "scripts/cloud-stop.ps1"
)

$cases = @(
    @{
        CaseName = "0-Match-Empty"
        MatchCount = 0
        MockOutput = ""
        ExpectedSuccess = $false
        ExpectedId = $null
    },
    @{
        CaseName = "0-Match-None"
        MatchCount = 0
        MockOutput = "None"
        ExpectedSuccess = $false
        ExpectedId = $null
    },
    @{
        CaseName = "0-Match-InvalidTokens"
        MatchCount = 0
        MockOutput = "ami-0123456789abcdef0 vol-0123456789abcdef0"
        ExpectedSuccess = $false
        ExpectedId = $null
    },
    @{
        CaseName = "0-Match-NonHexTokens"
        MatchCount = 0
        MockOutput = "i-0firstinstance1234 i-nothexstring"
        ExpectedSuccess = $false
        ExpectedId = $null
    },
    @{
        CaseName = "1-Match-17Char"
        MatchCount = 1
        MockOutput = "i-0123456789abcdef4"
        ExpectedSuccess = $true
        ExpectedId = "i-0123456789abcdef4"
    },
    @{
        CaseName = "1-Match-8Char"
        MatchCount = 1
        MockOutput = "i-abcdef12"
        ExpectedSuccess = $true
        ExpectedId = "i-abcdef12"
    },
    @{
        CaseName = "2-Match-SpaceSeparated-17Char"
        MatchCount = 2
        MockOutput = "i-0aaaa111122223333 i-0bbbb444455556666"
        ExpectedSuccess = $true
        ExpectedId = "i-0aaaa111122223333"
    },
    @{
        CaseName = "2-Match-TabSeparated-17Char"
        MatchCount = 2
        MockOutput = "i-0123456789abcdef0`ti-0fedcba9876543210"
        ExpectedSuccess = $true
        ExpectedId = "i-0123456789abcdef0"
    },
    @{
        CaseName = "2-Match-NewlineSeparated-8Char"
        MatchCount = 2
        MockOutput = "i-11112222`ni-33334444"
        ExpectedSuccess = $true
        ExpectedId = "i-11112222"
    }
)

$results = @()
$allPass = $true

foreach ($script in $scripts) {
    Write-Host "`n=== Testing $script ===" -ForegroundColor Cyan
    foreach ($tc in $cases) {
        $mockVal = $tc.MockOutput
        $expectedSuccess = $tc.ExpectedSuccess
        $expectedId = $tc.ExpectedId
        $caseName = $tc.CaseName

        # Run in isolated sub-process with mock aws function
        $mockValEscaped = $mockVal -replace "'", "''"
        $scriptPathEscaped = $script -replace "'", "''"

        $cmd = @"
function aws {
    param([Parameter(ValueFromRemainingArguments=`$true)]`$args)
    `$joined = `$args -join ' '
    if (`$joined -like '*describe-instances*Name=tag:Name*') {
        return '$mockValEscaped'
    }
    return 'None'
}
`$env:FROSTFIRE_INSTANCE_ID = ''
`$env:AWS_INSTANCE_ID = ''
`$ErrorActionPreference = 'Continue'
try {
    `$out = (& '$scriptPathEscaped' -Region us-west-2 -DryRun *>&1) | Out-String
    `$ec = `$LASTEXITCODE
    Write-Output "RESULT_START"
    Write-Output "EXIT_CODE:`$ec"
    Write-Output "STDOUT_CAPTURE:"
    Write-Output `$out
    Write-Output "RESULT_END"
} catch {
    Write-Output "RESULT_START"
    Write-Output "EXIT_CODE:1"
    Write-Output "STDOUT_CAPTURE:"
    Write-Output "`$_"
    Write-Output "RESULT_END"
}
"@

        $subOut = pwsh -NoProfile -Command $cmd | Out-String
        
        $exitCode = -1
        if ($subOut -match "EXIT_CODE:(-?\d+)") {
            $exitCode = [int]$Matches[1]
        }

        # Extract resolved instance ID from dry-run message:
        # [DRY-RUN] Would start instance '...' in region '...'
        # [DRY-RUN] Would query status for instance '...' in region '...'
        # [DRY-RUN] Would stop instance '...' in region '...'
        $extractedId = $null
        if ($subOut -match "instance '([^']+)' in region") {
            $extractedId = $Matches[1]
        }

        $passed = $false
        $notes = ""

        if ($expectedSuccess) {
            if ($exitCode -eq 0 -and $extractedId -eq $expectedId) {
                $passed = $true
                $notes = "Resolved exact ID: '$extractedId'"
            } else {
                $allPass = $false
                $notes = "FAIL: Expected ID '$expectedId' (ec 0), got ID '$extractedId' (ec $exitCode)"
            }
        } else {
            if ($exitCode -ne 0 -and [string]::IsNullOrEmpty($extractedId)) {
                $passed = $true
                $notes = "Correctly rejected resolution (exit $exitCode)"
            } else {
                $allPass = $false
                $notes = "FAIL: Expected non-zero exit and no ID, got ID '$extractedId' (ec $exitCode)"
            }
        }

        $statusColor = if ($passed) { "Green" } else { "Red" }
        $statusTag = if ($passed) { "[PASS]" } else { "[FAIL]" }
        Write-Host "$statusTag $script | $($tc.CaseName) (Matches=$($tc.MatchCount)) -> $notes" -ForegroundColor $statusColor

        $results += [PSCustomObject]@{
            Script = $script
            Case = $caseName
            Matches = $tc.MatchCount
            ExpectedSuccess = $expectedSuccess
            ExpectedId = $expectedId
            ResolvedId = $extractedId
            ExitCode = $exitCode
            Passed = $passed
            Notes = $notes
        }
    }
}

Write-Host "`n====================================================" -ForegroundColor Cyan
Write-Host "Challenger Test Results Summary:" -ForegroundColor Cyan
$passedCount = ($results | Where-Object { $_.Passed }).Count
$totalCount = $results.Count
Write-Host "Total: $totalCount | Passed: $passedCount | Failed: $($totalCount - $passedCount)" -ForegroundColor $(if ($allPass) { "Green" } else { "Red" })

if (-not $allPass) {
    Write-Error "Empirical verification failed!"
    exit 1
} else {
    Write-Host "All 0, 1, and 2 matching ID tests PASSED with exact string fidelity." -ForegroundColor Green
    exit 0
}
