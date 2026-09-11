#!/usr/bin/env bash
set -euo pipefail

# Turnkey deployment script for Frostfire User-Hosted VM on AWS EC2 Spot

REGION="${1:-us-west-2}"
STACK_NAME="${2:-frostfire-user-vm-poc}"
KEY_NAME="${3:-my-ec2-key}"
INSTANCE_TYPE="${4:-c6i.xlarge}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="${SCRIPT_DIR}/../deploy/aws/poc-host.yaml"

echo "============================================================"
echo ">>> Deploying Frostfire User-Hosted VM POC (${STACK_NAME})"
echo "============================================================"

# Detect caller's public IP for locked security group
MY_IP="$(curl -s https://checkip.amazonaws.com || echo "0.0.0.0")"
if [ "${MY_IP}" != "0.0.0.0" ]; then
  ALLOWED_CIDR="${MY_IP}/32"
else
  ALLOWED_CIDR="0.0.0.0/0"
fi
echo "[+] Detected caller public IP: ${ALLOWED_CIDR}"

echo ">>> Validating CloudFormation template..."
aws cloudformation validate-template \
  --template-body "file://${TEMPLATE_FILE}" \
  --region "${REGION}" > /dev/null

echo ">>> Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file "${TEMPLATE_FILE}" \
  --stack-name "${STACK_NAME}" \
  --parameter-overrides \
      InstanceType="${INSTANCE_TYPE}" \
      KeyName="${KEY_NAME}" \
      AllowedCidr="${ALLOWED_CIDR}" \
  --region "${REGION}"

echo "[+] Deployment completed successfully."
echo ">>> Fetching outputs..."
aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query "Stacks[0].Outputs" \
  --output table
