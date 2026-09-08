#!/usr/bin/env bash
# ==============================================================================
# Deploy Frostfire Agent MicroVM on AWS Lambda with Firecracker Isolation
# ==============================================================================
set -euo pipefail

STACK_NAME="${1:-frostfire-lambda-prod}"
AWS_REGION="${2:-us-east-1}"
ENVIRONMENT_NAME="${3:-frostfire-lambda}"

echo "=== Frostfire Agent MicroVM: AWS Lambda Deployment ==="
echo "Stack Name:       ${STACK_NAME}"
echo "Region:           ${AWS_REGION}"
echo "Environment Name: ${ENVIRONMENT_NAME}"

# Step 1: Validate CloudFormation template
echo "[1/4] Validating CloudFormation template..."
aws cloudformation validate-template \
  --template-body file://deploy/aws/lambda-microvm.yaml \
  --region "${AWS_REGION}" > /dev/null
echo "  ✓ Template validation passed."

# Step 2: Ensure ECR Repository exists
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ENVIRONMENT_NAME}-agent-microvm"

echo "[2/4] Authenticating with Amazon ECR..."
aws ecr get-login-password --region "${AWS_REGION}" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com" || true

# Step 3: Build & Push Container Image
IMAGE_TAG="latest"
echo "[3/4] Building container image with AWS Lambda Web Adapter..."
docker build -t "${ECR_URI}:${IMAGE_TAG}" -f cloud/agent/Dockerfile.lambda .
docker push "${ECR_URI}:${IMAGE_TAG}"

# Step 4: Deploy CloudFormation Stack
echo "[4/4] Deploying AWS Lambda MicroVM stack..."
aws cloudformation deploy \
  --template-file deploy/aws/lambda-microvm.yaml \
  --stack-name "${STACK_NAME}" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "${AWS_REGION}" \
  --parameter-overrides \
    EnvironmentName="${ENVIRONMENT_NAME}" \
    ContainerImageUri="${ECR_URI}:${IMAGE_TAG}"

FUNCTION_URL=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${AWS_REGION}" \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" \
  --output text)

echo "=== Deployment Complete ==="
echo "Lambda Agent MicroVM Function URL: ${FUNCTION_URL}"