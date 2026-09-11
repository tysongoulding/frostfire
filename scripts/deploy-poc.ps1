param (
    [string]$Region = "us-west-2",
    [string]$StackName = "frostfire-user-vm-poc",
    [string]$KeyName = "my-ec2-key",
    [string]$InstanceType = "c6i.xlarge",
    [string]$AllowedCidr = ""
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ">>> Deploying Frostfire User-Hosted VM POC to AWS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# 1. Detect public IP if AllowedCidr is not provided
if ([string]::IsNullOrWhiteSpace($AllowedCidr)) {
    try {
        $myIp = (Invoke-RestMethod -Uri "https://checkip.amazonaws.com").Trim()
        $AllowedCidr = "$myIp/32"
        Write-Host "[+] Automatically detected client public IP: $AllowedCidr" -ForegroundColor Green
    } catch {
        $AllowedCidr = "0.0.0.0/0"
        Write-Host "[-] Could not determine public IP, defaulting to 0.0.0.0/0" -ForegroundColor Yellow
    }
}

$templatePath = Join-Path $PSScriptRoot "..\deploy\aws\poc-host.yaml"
$templatePath = (Resolve-Path $templatePath).Path

Write-Host ">>> Validating CloudFormation template ($templatePath)..."
aws cloudformation validate-template --template-body "file://$templatePath" --region $Region | Out-Null
Write-Host "[+] CloudFormation template is valid." -ForegroundColor Green

Write-Host ">>> Deploying CloudFormation stack '$StackName' in $Region..."
aws cloudformation deploy `
    --template-file $templatePath `
    --stack-name $StackName `
    --parameter-overrides `
        InstanceType=$InstanceType `
        KeyName=$KeyName `
        AllowedCidr=$AllowedCidr `
    --region $Region

Write-Host "[+] Stack deployment finished successfully!" -ForegroundColor Green

Write-Host ">>> Fetching stack outputs..."
$outputs = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json

foreach ($out in $outputs) {
    Write-Host "$($out.OutputKey): $($out.OutputValue)" -ForegroundColor Yellow
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ">>> Frostfire Host VM is Ready!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
