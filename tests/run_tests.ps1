# Frostfire Cloud E2E Test Suite PowerShell Runner
param (
    [string]$Tier = "all",
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$workspaceRoot = Split-Path -Parent $scriptDir
$runnerScript = Join-Path $scriptDir "run_all_tests.py"

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command python3 -ErrorAction SilentlyContinue
}

if (-not $pythonCmd) {
    Write-Error "[-] Python is required to execute the test suite but was not found on PATH."
    exit 1
}

$argsList = @($runnerScript, "--tier", $Tier)
if ($Verbose) {
    $argsList += "-v"
}

& $pythonCmd.Source @argsList
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
exit 0
