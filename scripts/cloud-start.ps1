# Start Frostfire Cloud Host and display active public IP
param(
    [string]$InstanceId = "i-00970c561f6cdf7b0",
    [string]$Region = "us-west-2"
)

Write-Host "[+] Starting Frostfire Cloud Host ($InstanceId in $Region)..." -ForegroundColor Cyan
aws ec2 start-instances --instance-ids $InstanceId --region $Region
Write-Host "[+] Waiting for running state..." -ForegroundColor Yellow
aws ec2 wait instance-running --instance-ids $InstanceId --region $Region

$ip = (aws ec2 describe-instances --instance-ids $InstanceId --region $Region --query "Reservations[0].Instances[0].PublicIpAddress" --output text)
Write-Host "[✓] Frostfire Cloud Host is active at: http://${ip}:6081/" -ForegroundColor Green
