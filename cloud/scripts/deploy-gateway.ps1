param (
    [string]$Region = "us-west-2",
    [string]$StackName = "frostfire-gateway-test",
    [string]$KeyName = "frostfire-gateway-key",
    [string]$InstanceType = "t3.small",
    [string]$AllowedCidr = ""
)

$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ">>> Deploying Frostfire Central Cloud Gateway (Area 2) to AWS" -ForegroundColor Cyan
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

# 3. Resolve CloudFormation template path
$templatePath = Join-Path $PSScriptRoot "..\deploy\aws\gateway.yaml"
$templatePath = (Resolve-Path $templatePath).Path
Write-Host "[+] Using CloudFormation template: $templatePath" -ForegroundColor Green

# 4. Deploy CloudFormation Stack
Write-Host ">>> Deploying CloudFormation Stack '$StackName' to $Region..."
aws cloudformation deploy `
    --template-file "$templatePath" `
    --stack-name "$StackName" `
    --parameter-overrides `
        InstanceType="$InstanceType" `
        KeyName="$KeyName" `
        AllowedCidr="$AllowedCidr" `
    --capabilities CAPABILITY_IAM `
    --region "$Region"

if ($LASTEXITCODE -ne 0) {
    throw "CloudFormation deployment failed for stack '$StackName'."
}

Write-Host "[+] Stack '$StackName' deployed successfully!" -ForegroundColor Green

# 5. Display Stack Outputs
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ">>> Central Gateway Deployment Outputs" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$outputs = aws cloudformation describe-stacks `
    --stack-name "$StackName" `
    --query "Stacks[0].Outputs" `
    --output json `
    --region "$Region" | ConvertFrom-Json

foreach ($out in $outputs) {
    Write-Host "$($out.OutputKey): " -NoNewline -ForegroundColor Yellow
    Write-Host "$($out.OutputValue)" -ForegroundColor White
}
Write-Host "============================================================" -ForegroundColor Cyan
