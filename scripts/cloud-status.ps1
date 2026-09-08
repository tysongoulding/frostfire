# Check current Frostfire Cloud Host state and cost status
param(
    [string]$InstanceId,
    [string]$Region,
    [string]$StackName = "frostfire-aws",
    [string]$NameTag = "*frostfire*hypervisor*",
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
    Write-Host "[DRY-RUN] Would query status for instance '$InstanceId' in region '$Region'." -ForegroundColor Cyan
    exit 0
}

$rawJson = (aws ec2 describe-instances --instance-ids $InstanceId --region $Region --query "Reservations[0].Instances[0].{State:State.Name, Type:InstanceType, PublicIp:PublicIpAddress, LaunchTime:LaunchTime}" --output json 2>$null)
if (-not $rawJson) {
    Write-Error "[-] Failed to retrieve details for instance $InstanceId."
    exit 1
}

$raw = ($rawJson | ConvertFrom-Json)
$pricing = @{
    "c6i.metal"  = @{ Hourly = 4.080; Daily = 97.92; Note = "Bare Metal KVM, 128 vCPU, 256 GB RAM" }
    "c5.metal"   = @{ Hourly = 4.080; Daily = 97.92; Note = "Bare Metal KVM, 96 vCPU, 192 GB RAM" }
    "c7i.metal"  = @{ Hourly = 4.624; Daily = 110.98; Note = "Bare Metal KVM, 192 vCPU, 384 GB RAM" }
    "m6i.metal"  = @{ Hourly = 4.512; Daily = 108.29; Note = "Bare Metal KVM, 128 vCPU, 512 GB RAM" }
    "i3en.metal" = @{ Hourly = 10.848; Daily = 260.35; Note = "Bare Metal KVM, 96 vCPU, 768 GB RAM, NVMe" }
    "t3.xlarge"  = @{ Hourly = 0.1664; Daily = 3.99; Note = "4 vCPU, 16 GB RAM (Lean POC)" }
    "t3.large"   = @{ Hourly = 0.0832; Daily = 2.00; Note = "2 vCPU, 8 GB RAM (Lean POC)" }
    "c6i.xlarge" = @{ Hourly = 0.1700; Daily = 4.08; Note = "4 vCPU, 8 GB RAM (Compute POC)" }
}

Write-Host "--- Frostfire Cloud Host Status ---" -ForegroundColor Cyan
Write-Host "Instance:    $InstanceId ($Region)"
Write-Host "Type:        $($raw.Type)"
Write-Host "Launched:    $($raw.LaunchTime)"

if ($raw.State -eq 'running') {
    Write-Host "State:       running" -ForegroundColor Green
    Write-Host "Public IP:   $($raw.PublicIp)"
    if ($pricing.ContainsKey($raw.Type)) {
        $p = $pricing[$raw.Type]
        Write-Host "Hourly Cost: ~$($p.Hourly)/hr (~`$$($p.Daily)/day) [$($p.Note)]" -ForegroundColor Yellow
    } else {
        Write-Host "Hourly Cost: Variable (Refer to AWS on-demand pricing for $($raw.Type))" -ForegroundColor Yellow
    }
} else {
    Write-Host "State:       $($raw.State)" -ForegroundColor Yellow
    Write-Host "Public IP:   None (Offline)"
    Write-Host "Hourly Cost: `$0.00/hr compute (EBS gp3 storage preserved at ~$0.08/GB-mo)" -ForegroundColor Green
}
