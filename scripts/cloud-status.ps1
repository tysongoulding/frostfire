# Check current Frostfire Cloud Host state and cost status
param(
    [string]$InstanceId = "i-00970c561f6cdf7b0",
    [string]$Region = "us-west-2"
)

$raw = (aws ec2 describe-instances --instance-ids $InstanceId --region $Region --query "Reservations[0].Instances[0].{State:State.Name, Type:InstanceType, PublicIp:PublicIpAddress}" | ConvertFrom-Json)
Write-Host "--- Frostfire Cloud Host Status ---" -ForegroundColor Cyan
Write-Host "Instance:   $InstanceId ($Region)"
Write-Host "Type:       $($raw.Type)"
if ($raw.State -eq 'running') {
    Write-Host "State:      running" -ForegroundColor Green
    Write-Host "Public IP:  $($raw.PublicIp)"
    Write-Host 'Hourly Cost: ~$0.171/hr (~$4.11/day)' -ForegroundColor Yellow
} else {
    Write-Host "State:      $($raw.State)" -ForegroundColor Yellow
    Write-Host "Public IP:  None (Offline)"
    Write-Host 'Hourly Cost: $0.00/hr (Only ~$0.13/day for 50GB gp3 disk storage)' -ForegroundColor Green
}
