#!/usr/bin/env bash
set -euo pipefail

# Turnkey deployment script for Frostfire User-Hosted VM on AWS EC2 Spot

REGION="${1:-us-west-2}"
STACK_NAME="${2:-frostfire-user-vm-poc}"
KEY_NAME="${3:-my-ec2-key}"
INSTANCE_TYPE="${4:-c6i.xlarge}"
ALLOWED_CIDR="${5:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_FILE="${SCRIPT_DIR}/../deploy/aws/poc-host.yaml"

echo "============================================================"
echo ">>> Deploying Frostfire User-Hosted VM POC (${STACK_NAME})"
echo "============================================================"

# 1. Detect caller's public IP for locked security group if not provided
if [ -z "${ALLOWED_CIDR}" ]; then
  for ENDPOINT in "https://checkip.amazonaws.com" "https://api.ipify.org" "https://ifconfig.me"; do
    IP="$(curl -sS --max-time 4 "${ENDPOINT}" 2>/dev/null | tr -d '[:space:]' || true)"
    if [[ "${IP}" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
      ALLOWED_CIDR="${IP}/32"
      break
    fi
  done

  if [ -z "${ALLOWED_CIDR}" ]; then
    ALLOWED_CIDR="0.0.0.0/0"
    echo "[-] Could not determine public IP, defaulting to 0.0.0.0/0"
  else
    echo "[+] Automatically detected client public IP: ${ALLOWED_CIDR}"
  fi
else
  echo "[+] Using provided AllowedCidr: ${ALLOWED_CIDR}"
fi

# 2. Check/Create EC2 KeyPair in target region
echo ">>> Checking EC2 KeyPair '${KEY_NAME}' in ${REGION}..."
if ! aws ec2 describe-key-pairs --key-names "${KEY_NAME}" --region "${REGION}" >/dev/null 2>&1; then
  echo "[*] KeyPair '${KEY_NAME}' not found in ${REGION}. Creating new EC2 KeyPair..."
  KEY_PEM="${KEY_NAME}.pem"
  aws ec2 create-key-pair \
    --key-name "${KEY_NAME}" \
    --query "KeyMaterial" \
    --output text \
    --region "${REGION}" > "${KEY_PEM}"
  chmod 400 "${KEY_PEM}" 2>/dev/null || true
  echo "[+] Created EC2 KeyPair '${KEY_NAME}' and saved private key to '${KEY_PEM}'."
else
  echo "[+] EC2 KeyPair '${KEY_NAME}' exists in ${REGION}."
fi

echo ">>> Validating CloudFormation template (${TEMPLATE_FILE})..."
aws cloudformation validate-template \
  --template-body "file://${TEMPLATE_FILE}" \
  --region "${REGION}" > /dev/null
echo "[+] CloudFormation template is valid."

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
