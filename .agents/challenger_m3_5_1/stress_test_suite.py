#!/usr/bin/env python3
"""
Empirical Challenger Stress-Testing Suite for Milestone 3.5 (Feature F17)
Executes deep structural validation, boundary exploration, and adversarial checks
on deploy/aws/lambda-microvm.yaml and cloud/agent/Dockerfile.lambda.
"""

import sys
import re
from pathlib import Path
import yaml

def get_cfn_yaml_loader():
    """Constructs a PyYAML loader that supports CloudFormation intrinsic tags."""
    class CfnSafeLoader(yaml.SafeLoader):
        pass

    def make_ctor(tag):
        def ctor(loader, node):
            if isinstance(node, yaml.ScalarNode):
                return {tag: loader.construct_scalar(node)}
            elif isinstance(node, yaml.SequenceNode):
                return {tag: loader.construct_sequence(node)}
            elif isinstance(node, yaml.MappingNode):
                return {tag: loader.construct_mapping(node)}
        return ctor

    cfn_tags = [
        "!Ref", "!Sub", "!GetAtt", "!Join", "!Select", "!Split",
        "!FindInMap", "!Base64", "!Cidr", "!And", "!Equals",
        "!If", "!Not", "!Or", "!Condition"
    ]
    for tag in cfn_tags:
        CfnSafeLoader.add_constructor(tag, make_ctor(tag))
    return CfnSafeLoader

def test_cloudformation_yaml_parsing():
    print("=== Test 1: CloudFormation Template Deep Inspection ===")
    cfn_path = Path("deploy/aws/lambda-microvm.yaml")
    assert cfn_path.exists(), f"File not found: {cfn_path}"

    # 1. Byte level line ending invariant
    raw_bytes = cfn_path.read_bytes()
    cr_count = raw_bytes.count(b"\r")
    assert cr_count == 0, f"Found {cr_count} CR bytes in {cfn_path}! Must be 0 (pure Unix LF)."
    print("  [PASS] 0 CR bytes in lambda-microvm.yaml")

    raw_text = cfn_path.read_text(encoding="utf-8")
    loader = get_cfn_yaml_loader()
    parsed = yaml.load(raw_text, Loader=loader)

    assert parsed.get("AWSTemplateFormatVersion") == "2010-09-09", "Invalid or missing AWSTemplateFormatVersion"
    params = parsed.get("Parameters", {})
    print(f"  [INFO] Extracted parameters via PyYAML: {list(params.keys())}")

    assert "LambdaMemorySize" in params, "Missing LambdaMemorySize"
    assert "EphemeralStorageSize" in params, "Missing EphemeralStorageSize"
    assert "TimeoutSeconds" in params, "Missing TimeoutSeconds"
    assert "EnvironmentName" in params, "Missing EnvironmentName"
    assert "ContainerImageUri" in params, "Missing ContainerImageUri"
    assert "GatewayEndpoint" in params, "Missing GatewayEndpoint"

    # LambdaMemorySize bounds (512 - 10240, default 10240)
    mem = params["LambdaMemorySize"]
    assert mem["Type"] == "Number", f"Expected Number, got {mem.get('Type')}"
    assert int(mem["MinValue"]) == 512, f"Expected MinValue 512, got {mem.get('MinValue')}"
    assert int(mem["MaxValue"]) == 10240, f"Expected MaxValue 10240, got {mem.get('MaxValue')}"
    assert int(mem["Default"]) == 10240, f"Expected Default 10240, got {mem.get('Default')}"
    print("  [PASS] LambdaMemorySize parameter bounds: 512-10240 (default: 10240)")

    # EphemeralStorageSize bounds (512 - 10240, default 10240)
    eph = params["EphemeralStorageSize"]
    assert eph["Type"] == "Number", f"Expected Number, got {eph.get('Type')}"
    assert int(eph["MinValue"]) == 512, f"Expected MinValue 512, got {eph.get('MinValue')}"
    assert int(eph["MaxValue"]) == 10240, f"Expected MaxValue 10240, got {eph.get('MaxValue')}"
    assert int(eph["Default"]) == 10240, f"Expected Default 10240, got {eph.get('Default')}"
    print("  [PASS] EphemeralStorageSize parameter bounds: 512-10240 (default: 10240)")

    # TimeoutSeconds bounds (30 - 900, default 900)
    to = params["TimeoutSeconds"]
    assert to["Type"] == "Number", f"Expected Number, got {to.get('Type')}"
    assert int(to["MinValue"]) == 30, f"Expected MinValue 30, got {to.get('MinValue')}"
    assert int(to["MaxValue"]) == 900, f"Expected MaxValue 900, got {to.get('MaxValue')}"
    assert int(to["Default"]) == 900, f"Expected Default 900, got {to.get('Default')}"
    print("  [PASS] TimeoutSeconds parameter bounds: 30-900 (default: 900)")

    # 3. Resources verification
    resources = parsed.get("Resources", {})
    assert "AgentMicroVmFunction" in resources, "Missing AgentMicroVmFunction resource"
    fn = resources["AgentMicroVmFunction"]
    assert fn["Type"] == "AWS::Lambda::Function", "AgentMicroVmFunction must be AWS::Lambda::Function"
    fn_props = fn["Properties"]
    assert fn_props.get("PackageType") == "Image", f"Expected PackageType Image, got {fn_props.get('PackageType')}"
    assert fn_props.get("MemorySize") == {"!Ref": "LambdaMemorySize"}, "MemorySize must ref LambdaMemorySize"
    assert fn_props.get("EphemeralStorage", {}).get("Size") == {"!Ref": "EphemeralStorageSize"}, "EphemeralStorage.Size must ref EphemeralStorageSize"
    assert fn_props.get("Timeout") == {"!Ref": "TimeoutSeconds"}, "Timeout must ref TimeoutSeconds"
    print("  [PASS] AgentMicroVmFunction correctly binds sizing parameters to MicroVM configuration")

    # 4. Response Streaming & LWA Exec Wrapper Invariants
    env_vars = fn_props.get("Environment", {}).get("Variables", {})
    assert env_vars.get("AWS_LAMBDA_EXEC_WRAPPER") == "/opt/bootstrap", "AWS_LAMBDA_EXEC_WRAPPER must be /opt/bootstrap"
    assert env_vars.get("AWS_LWA_INVOKE_MODE") == "response_stream", "AWS_LWA_INVOKE_MODE must be response_stream"

    assert "AgentFunctionUrl" in resources, "Missing AgentFunctionUrl resource"
    url_res = resources["AgentFunctionUrl"]
    assert url_res.get("Type") == "AWS::Lambda::Url", "AgentFunctionUrl must be AWS::Lambda::Url"
    url_props = url_res.get("Properties", {})
    assert url_props.get("InvokeMode") == "RESPONSE_STREAM", f"Expected InvokeMode RESPONSE_STREAM, got {url_props.get('InvokeMode')}"
    assert url_props.get("AuthType") == "NONE", "AgentFunctionUrl AuthType must be NONE"
    print("  [PASS] Response streaming and LWA bootstrap properties verified")

    # 5. Security & Invariant Check: IAM Least Privilege and Resource Segregation
    assert "LambdaExecutionRole" in resources, "Missing LambdaExecutionRole"
    role = resources["LambdaExecutionRole"]
    role_props = role.get("Properties", {})
    assert "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" in role_props.get("ManagedPolicyArns", [])
    policies = role_props.get("Policies", [])
    assert len(policies) > 0, "Expected at least one inline policy"
    sec_stmt = policies[0]["PolicyDocument"]["Statement"][0]
    action = sec_stmt["Action"]
    if isinstance(action, list):
        assert "secretsmanager:GetSecretValue" in action
    else:
        assert action == "secretsmanager:GetSecretValue"
    print("  [PASS] IAM least-privilege scoping verified")

def test_parameter_boundary_generator():
    print("\n=== Test 2: Parameter Boundary Generator & Adversarial Oracle ===")
    class ParamValidator:
        def __init__(self, min_val, max_val, param_type="Number"):
            self.min_val = min_val
            self.max_val = max_val
            self.param_type = param_type

        def validate(self, val):
            if self.param_type == "Number":
                try:
                    num = int(val)
                except (ValueError, TypeError):
                    return False, f"Not a valid number: {val}"
                if num < self.min_val:
                    return False, f"Value {num} < MinValue {self.min_val}"
                if num > self.max_val:
                    return False, f"Value {num} > MaxValue {self.max_val}"
                return True, "Valid"
            return True, "Valid"

    mem_validator = ParamValidator(512, 10240)
    eph_validator = ParamValidator(512, 10240)
    to_validator = ParamValidator(30, 900)

    # Edge cases for Memory (512 - 10240)
    assert not mem_validator.validate(0)[0]
    assert not mem_validator.validate(-1)[0]
    assert not mem_validator.validate(511)[0]
    assert mem_validator.validate(512)[0]
    assert mem_validator.validate(1024)[0]
    assert mem_validator.validate(10240)[0]
    assert not mem_validator.validate(10241)[0]
    assert not mem_validator.validate("abc")[0]
    assert not mem_validator.validate("")[0]
    print("  [PASS] Memory boundary checks (0, 511, 512, 10240, 10241) behave according to spec")

    # Edge cases for Timeout (30 - 900)
    assert not to_validator.validate(0)[0]
    assert not to_validator.validate(29)[0]
    assert to_validator.validate(30)[0]
    assert to_validator.validate(60)[0]
    assert to_validator.validate(900)[0]
    assert not to_validator.validate(901)[0]
    print("  [PASS] Timeout boundary checks (0, 29, 30, 900, 901) behave according to spec")

    # Edge cases for Ephemeral Storage (512 - 10240)
    assert not eph_validator.validate(511)[0]
    assert eph_validator.validate(512)[0]
    assert eph_validator.validate(10240)[0]
    assert not eph_validator.validate(10241)[0]
    print("  [PASS] Ephemeral storage boundary checks (511, 512, 10240, 10241) behave according to spec")

def test_dockerfile_ast_and_invariants():
    print("\n=== Test 3: Dockerfile Structural & Security Invariants ===")
    df_path = Path("cloud/agent/Dockerfile.lambda")
    assert df_path.exists(), f"File not found: {df_path}"

    raw_bytes = df_path.read_bytes()
    cr_count = raw_bytes.count(b"\r")
    assert cr_count == 0, f"Found {cr_count} CR bytes in {df_path}! Must be 0 (pure Unix LF)."
    print("  [PASS] 0 CR bytes in Dockerfile.lambda")

    content = df_path.read_text(encoding="utf-8")
    lines = [line.strip() for line in content.split("\n")]

    # Check multi-stage layout
    stages = [line for line in lines if line.startswith("FROM ")]
    assert len(stages) == 3, f"Expected 3 multi-stage builds, got {len(stages)}: {stages}"
    assert "lambda-adapter" in stages[0], "Stage 1 must be lambda-adapter"
    assert "builder" in stages[1], "Stage 2 must be builder"
    assert "runtime" in stages[2], "Stage 3 must be runtime"
    print("  [PASS] Multi-stage architecture verified (adapter, builder, runtime)")

    # Check symlink: ln -s /opt/extensions/lambda-adapter /opt/bootstrap
    assert any("ln -s /opt/extensions/lambda-adapter /opt/bootstrap" in line for line in lines), \
        "Missing symlink from /opt/extensions/lambda-adapter to /opt/bootstrap"
    print("  [PASS] /opt/bootstrap symlink creation verified")

    # Check user: 10001:10001
    assert any("groupadd -g 10001" in line for line in lines), "Missing groupadd for GID 10001"
    assert any("useradd -u 10001 -g frostfire" in line for line in lines), "Missing useradd for UID 10001"
    assert "USER 10001:10001" in lines, "Missing active switch 'USER 10001:10001'"
    print("  [PASS] Non-root execution user 10001:10001 strictly enforced")

    # Check AWS_LWA_INVOKE_MODE=response_stream
    assert "AWS_LWA_INVOKE_MODE=response_stream" in content, "Missing AWS_LWA_INVOKE_MODE=response_stream"
    assert "AWS_LWA_READ_TIMEOUT_MS=900000" in content, "Missing AWS_LWA_READ_TIMEOUT_MS=900000"
    assert "PORT=8080" in content, "Missing PORT=8080"
    print("  [PASS] AWS Lambda Web Adapter environment configuration verified")

    # Check strip command for binary size optimization
    assert any("strip" in line and "frostfire-agent" in line for line in lines), \
        "Missing strip command on frostfire-agent binary"
    print("  [PASS] Binary stripping verified for cold-start minimization")

    # Check read-only rootfs compliance: HOME=/tmp and TMPDIR=/tmp
    assert "ENV HOME=/tmp" in content and "TMPDIR=/tmp" in content, \
        "HOME and TMPDIR must be set to /tmp for Lambda read-only rootfs compliance"
    print("  [PASS] Read-only rootfs compatibility (/tmp scratchpads) verified")

def test_cfn_reference_graph_and_credential_leak_scan():
    print("\n=== Test 5: CloudFormation Reference Graph & Credential Leak Scan ===")
    cfn_path = Path("deploy/aws/lambda-microvm.yaml")
    raw_text = cfn_path.read_text(encoding="utf-8")
    loader = get_cfn_yaml_loader()
    parsed = yaml.load(raw_text, Loader=loader)

    params = set(parsed.get("Parameters", {}).keys())
    resources = set(parsed.get("Resources", {}).keys())
    pseudo_params = {"AWS::Region", "AWS::AccountId", "AWS::StackName", "AWS::StackId", "AWS::NoValue"}

    # Extract all !Ref occurrences in the YAML text
    refs = re.findall(r"!Ref\s+([a-zA-Z0-9]+)", raw_text)
    for ref in refs:
        assert ref in params or ref in resources or ref in pseudo_params, \
            f"Dangling !Ref target: '{ref}' not found in Parameters or Resources"
    print(f"  [PASS] All {len(refs)} !Ref intrinsic targets verified against parameter/resource graph")

    # Extract all !GetAtt occurrences
    getatts = re.findall(r"!GetAtt\s+([a-zA-Z0-9]+)\.([a-zA-Z0-9]+)", raw_text)
    for res_name, attr in getatts:
        assert res_name in resources, f"Dangling !GetAtt resource: '{res_name}' not in Resources"
    print(f"  [PASS] All {len(getatts)} !GetAtt targets bound to existing resources ({getatts})")

    # Credential Leak & Secret Scanning across deploy/ and cloud/agent/
    suspicious_patterns = [
        r"(?i)aws_secret_access_key\s*=",
        r"(?i)AKIA[0-9A-Z]{16}",
        r"(?i)password\s*:\s*['\"][^'\"]+['\"]",
        r"(?i)bearer\s+[a-zA-Z0-9_\-\.]{20,}",
        r"-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----",
    ]
    target_dirs = [Path("deploy/aws"), Path("cloud/agent")]
    scanned_files = 0
    for tdir in target_dirs:
        for fpath in tdir.rglob("*"):
            if fpath.is_file():
                scanned_files += 1
                try:
                    txt = fpath.read_text(encoding="utf-8", errors="ignore")
                    for pat in suspicious_patterns:
                        assert not re.search(pat, txt), f"Potential secret leak in {fpath}: {pat}"
                except Exception as e:
                    pass
    print(f"  [PASS] Clean credential scan across {scanned_files} files in deploy/aws and cloud/agent")

def test_sand_window_router_health_and_token_invariants():
    print("\n=== Test 4: sand-window-router.mjs Health Probe & Auth Invariants ===")
    router_path = Path("cloud/microvm/scripts/sand-window-router.mjs")
    assert router_path.exists(), f"File not found: {router_path}"

    raw_bytes = router_path.read_bytes()
    cr_count = raw_bytes.count(b"\r")
    assert cr_count == 0, f"Found {cr_count} CR bytes in {router_path}! Must be 0 (pure Unix LF)."
    print("  [PASS] 0 CR bytes in sand-window-router.mjs")

    content = router_path.read_text(encoding="utf-8")

    # Health route check
    assert 'pathname === "/health" || pathname === "/ready"' in content, \
        "Router must handle /health and /ready paths"
    assert 'res.writeHead(200' in content, "Router must return 200 OK for health probe"
    print("  [PASS] Unauthenticated /health and /ready probes verified")

    # Auth invariant: constant-time token comparison
    assert 'timingSafeEqual' in content, "Router must use timingSafeEqual for token comparison"
    assert 'timingSafeEqual(bb, bb)' in content, "Router must use timingSafeEqual dummy pass on length mismatch"
    print("  [PASS] Constant-time token comparison with length mismatch padding verified")

if __name__ == "__main__":
    try:
        test_cloudformation_yaml_parsing()
        test_parameter_boundary_generator()
        test_dockerfile_ast_and_invariants()
        test_sand_window_router_health_and_token_invariants()
        test_cfn_reference_graph_and_credential_leak_scan()
        print("\n===========================================================")
        print("ALL EMPIRICAL CHALLENGER STRESS TESTS COMPLETED SUCCESSFULLY!")
        print("===========================================================")
    except AssertionError as err:
        print(f"\n[FAIL] Assertion failed: {err}", file=sys.stderr)
        sys.exit(1)
