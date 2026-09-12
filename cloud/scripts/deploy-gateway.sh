#!/usr/bin/env bash
set -euo pipefail

REGION="${1:-us-west-2}"
STACK_NAME="${2:-frostfire-gateway-test}"
KEY_NAME="${3:-frostfire-gateway-key}"
INSTANCE_TYPE="${4:-t3.small}"
ALLOWED_CIDR="${5:-}"

echo "============================================================"
echo ">>> Deploying Frostfire Central Cloud Gateway (Area 2) to AWS"
echo "============================================================"

# Detect public IP if ALLOWED_CIDR is not provided
if [ -z "$ALLOWED_CIDR" ]; then
    DETECTED_IP=""
    for endpoint in "https://checkip.amazonaws.com" "https://api.ipify.org" "https://ifconfig.me"; do
        if IP=$(curl -s --max-time 4 "$endpoint" | tr -d '[:space:]'); then
            if [[ "$IP" =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
                DETECTED_IP="$IP"
                break
            fi
        fi
    done

    if [ -n "$DETECTED_IP" ]; then
        ALLOWED_CIDR="$DETECTED_IP/32"
        echo "[+] Automatically detected client public IP: $ALLOWED_CIDR"
    else
        ALLOWED_CIDR="0.0.0.0/0"
        echo "[-] Could not determine public IP, defaulting to 0.0.0.0/0"
    fi
fi

# Check or create EC2 KeyPair
echo ">>> Checking EC2 KeyPair '$KEY_NAME' in $REGION..."
if ! aws ec2 describe-key-pairs --key-names "$KEY_NAME" --region "$REGION" >/dev/null 2>&1; then
    echo "[*] Creating new KeyPair '$KEY_NAME'..."
    aws ec2 create-key-pair --key-name "$KEY_NAME" --query "KeyMaterial" --output text --region "$REGION" > "${KEY_NAME}.pem"
    chmod 400 "${KEY_NAME}.pem"
    echo "[+] Saved private key to ${KEY_NAME}.pem"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_PATH="${SCRIPT_DIR}/../deploy/aws/gateway.yaml"

echo ">>> Deploying CloudFormation stack '$STACK_NAME'..."
aws cloudformation deploy \
    --template-file "$TEMPLATE_PATH" \
    --stack-name "$STACK_NAME" \
    --parameter-overrides \
        InstanceType="$INSTANCE_TYPE" \
        KeyName="$KEY_NAME" \
        AllowedCidr="$ALLOWED_CIDR" \
    --capabilities CAPABILITY_IAM \
    --region "$REGION"

echo "============================================================"
echo ">>> Central Gateway Deployment Outputs"
echo "============================================================"
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs" \
    --output table \
    --region "$REGION"
