# Stop Frostfire Cloud Host to eliminate compute and IPv4 hourly billing
param(
    [string]$InstanceId = "i-00970c561f6cdf7b0",
    [string]$Region = "us-west-2"
)

Write-Host "[+] Stopping Frostfire Cloud Host ($InstanceId in $Region)..." -ForegroundColor Cyan
aws ec2 stop-instances --instance-ids $InstanceId --region $Region
Write-Host "[✓] Host is stopping. Compute & public IPv4 costs drop to `$0.00/hr." -ForegroundColor Green
Write-Host "[✓] Disk storage, browser logins, and microVM states are preserved." -ForegroundColor Green
