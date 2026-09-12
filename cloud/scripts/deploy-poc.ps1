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
    $detectedIp = $null
    $endpoints = @("https://checkip.amazonaws.com", "https://api.ipify.org", "https://ifconfig.me")
    foreach ($uri in $endpoints) {
        try {
            $resp = (Invoke-RestMethod -Uri $uri -TimeoutSec 4).Trim()
            if ($resp -match '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$') {
                $detectedIp = $resp
                break
            }
        } catch {
            # try next endpoint
        }
    }

    if ($detectedIp) {
        $AllowedCidr = "$detectedIp/32"
        Write-Host "[+] Automatically detected client public IP: $AllowedCidr" -ForegroundColor Green
    } else {
        $AllowedCidr = "0.0.0.0/0"
        Write-Host "[-] Could not determine public IP, defaulting to 0.0.0.0/0" -ForegroundColor Yellow
    }
} else {
    Write-Host "[+] Using provided AllowedCidr: $AllowedCidr" -ForegroundColor Green
}

# 2. Check or create EC2 KeyPair in target region
Write-Host ">>> Checking EC2 KeyPair '$KeyName' in $Region..."
$describeOutput = aws ec2 describe-key-pairs --key-names $KeyName --region $Region 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[*] EC2 KeyPair '$KeyName' not found in $Region. Creating new KeyPair..." -ForegroundColor Yellow
    $keyPemFile = Join-Path (Get-Location) "$KeyName.pem"
    $keyMaterial = aws ec2 create-key-pair --key-name $KeyName --query "KeyMaterial" --output text --region $Region
    if ($LASTEXITCODE -eq 0 -and [string]::IsNullOrWhiteSpace($keyMaterial) -eq $false) {
        [System.IO.File]::WriteAllText($keyPemFile, $keyMaterial)
        Write-Host "[+] Created EC2 KeyPair '$KeyName' and saved private key to '$keyPemFile'." -ForegroundColor Green
    } else {
        throw "Failed to create EC2 KeyPair '$KeyName' in $Region."
    }
} else {
    Write-Host "[+] EC2 KeyPair '$KeyName' found in $Region." -ForegroundColor Green
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

if ($LASTEXITCODE -ne 0) {
    throw "CloudFormation deployment failed with exit code $LASTEXITCODE."
}

Write-Host "[+] Stack deployment finished successfully!" -ForegroundColor Green

Write-Host ">>> Fetching stack outputs..."
$outputs = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output json | ConvertFrom-Json

foreach ($out in $outputs) {
    Write-Host "$($out.OutputKey): $($out.OutputValue)" -ForegroundColor Yellow
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ">>> Frostfire Host VM is Ready!" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Cyan
