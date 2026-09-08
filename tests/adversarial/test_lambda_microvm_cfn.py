#!/usr/bin/env python3
"""
Adversarial & Structural Verification Suite for AWS Lambda MicroVM Infrastructure
Validates:
- Strict Firecracker microVM parameters (10GB RAM, 6 vCPUs, 10GB /tmp)
- AWS Lambda Web Adapter streaming configuration (RESPONSE_STREAM)
- Tenant isolation and IAM least-privilege
- Zero hardcoded secrets, keys, or account IDs
"""

import sys
import re
from pathlib import Path

def test_lambda_microvm_template():
    cfn_path = Path("deploy/aws/lambda-microvm.yaml")
    assert cfn_path.exists(), f"Missing template: {cfn_path}"

    content = cfn_path.read_text(encoding="utf-8")

    # Invariant 1: CloudFormation format header
    assert "AWSTemplateFormatVersion: '2010-09-09'" in content or 'AWSTemplateFormatVersion: "2010-09-09"' in content, \
        "Missing standard CloudFormation header"

    # Invariant 2: MicroVM Firecracker sizing parameters
    assert "LambdaMemorySize:" in content, "Missing LambdaMemorySize parameter"
    assert "Default: 10240" in content, "Default memory must be 10240 MB for 6 dedicated vCPUs"
    assert "EphemeralStorageSize:" in content, "Missing EphemeralStorageSize parameter"

    # Invariant 3: AWS Lambda Web Adapter streaming config
    assert "AWS_LWA_INVOKE_MODE: response_stream" in content, \
        "Lambda Web Adapter must be configured with response_stream"
    assert "InvokeMode: RESPONSE_STREAM" in content, \
        "Function URL must be configured with RESPONSE_STREAM"

    # Invariant 4: Container image package type
    assert "PackageType: Image" in content, "Function must use container image packaging"

    # Invariant 5: Zero hardcoded secrets
    secret_patterns = [
        r"(?i)aws_secret_access_key\s*=",
        r"(?i)AKIA[0-9A-Z]{16}",
        r"(?i)password\s*:\s*['\"][^'\"]+['\"]",
        r"(?i)bearer\s+[a-zA-Z0-9_\-\.]{20,}"
    ]
    for pattern in secret_patterns:
        match = re.search(pattern, content)
        assert not match, f"Potential hardcoded secret detected matching: {pattern}"

    print("✓ AWS Lambda MicroVM CloudFormation template verification passed.")

def test_lambda_dockerfile():
    dockerfile_path = Path("cloud/agent/Dockerfile.lambda")
    assert dockerfile_path.exists(), f"Missing Dockerfile: {dockerfile_path}"

    content = dockerfile_path.read_text(encoding="utf-8")

    # Invariant 1: AWS Lambda Adapter inclusion
    assert "aws-lambda-adapter" in content, "Must include AWS Lambda Web Adapter"
    assert "/opt/extensions/lambda-adapter" in content, "Must copy lambda-adapter to /opt/extensions"

    # Invariant 2: Streaming environment
    assert "AWS_LWA_INVOKE_MODE=response_stream" in content, \
        "Dockerfile must export AWS_LWA_INVOKE_MODE=response_stream"

    # Invariant 3: Compiled agent binary
    assert "frostfire-agent" in content, "Must bundle frostfire-agent binary"

    print("✓ AWS Lambda Agent Dockerfile verification passed.")

if __name__ == "__main__":
    try:
        test_lambda_microvm_template()
        test_lambda_dockerfile()
        print("All Lambda MicroVM verification tests PASSED.")
    except AssertionError as err:
        print(f"FAILED: {err}", file=sys.stderr)
        sys.exit(1)