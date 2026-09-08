# Stop Frostfire Cloud Host to eliminate compute and IPv4 hourly billing
param(
    [string]$InstanceId,
    [string]$Region,
    [string]$StackName = "frostfire-aws",
    [string]$NameTag = "*frostfire*hypervisor*",
    [switch]$Wait,
    [switch]$DryRun
)

# 1. Resolve Region
if (-not $Region) {
    if ($env:AWS_REGION) { $Region = $env:AWS_REGION }
    elseif ($env:AWS_DEFAULT_REGION) { $Region = $env:AWS_DEFAULT_REGION }
    else {
        $cfg = (aws configure get region 2>$null)
        $Region = if ($cfg) { $cfg.Trim() } else { "us-west-2" }
    }
}

# 2. Resolve InstanceId
if (-not $InstanceId) {
    if ($env:FROSTFIRE_INSTANCE_ID) { $InstanceId = $env:FROSTFIRE_INSTANCE_ID }
    elseif ($env:AWS_INSTANCE_ID) { $InstanceId = $env:AWS_INSTANCE_ID }
}

if (-not $InstanceId -and $StackName) {
    $cfn = (aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs[?OutputKey=='HypervisorInstanceId'].OutputValue" --output text 2>$null)
    if ($cfn -and $cfn -ne "None" -and -not $cfn.StartsWith("An error occurred")) {
        $InstanceId = $cfn.Trim()
    }
}

if (-not $InstanceId -and $NameTag) {
    $ec2 = (aws ec2 describe-instances --region $Region --filters "Name=tag:Name,Values=$NameTag" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query "Reservations[].Instances[].InstanceId" --output text 2>$null)
    if ($ec2 -and $ec2 -ne "None" -and -not $ec2.StartsWith("An error occurred")) {
        $ids = @($ec2 -split "\s+" | Where-Object { $_ -match '^i-[0-9a-f]{8,17}$' })
        if ($ids.Count -ge 1) { $InstanceId = $ids[0] }
    }
}

if (-not $InstanceId) {
    Write-Error "[-] Frostfire InstanceId could not be resolved. Pass -InstanceId, set `$env:FROSTFIRE_INSTANCE_ID, or configure CloudFormation stack '$StackName'."
    exit 1
}

if ($DryRun) {
    Write-Host "[DRY-RUN] Would stop instance '$InstanceId' in region '$Region'." -ForegroundColor Cyan
    exit 0
}

Write-Host "[+] Stopping Frostfire Cloud Host ($InstanceId in $Region)..." -ForegroundColor Cyan
aws ec2 stop-instances --instance-ids $InstanceId --region $Region

if ($Wait) {
    Write-Host "[+] Waiting for instance-stopped state..." -ForegroundColor Yellow
    aws ec2 wait instance-stopped --instance-ids $InstanceId --region $Region
}

Write-Host "[✓] Host is stopping. Compute & public IPv4 costs drop to `$0.00/hr." -ForegroundColor Green
Write-Host "[✓] Disk storage, browser logins, and microVM states are preserved." -ForegroundColor Green
