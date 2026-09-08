# Frostfire E2E Test Suite PowerShell Runner
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Executing Frostfire E2E Test Runner..." -ForegroundColor Cyan
python "$ScriptDir/run_tests.py" @args
exit $LASTEXITCODE
