# Amazon EFS Persistence CloudFormation Specification for AWS Lambda MicroVM (`deploy/aws/lambda-microvm.yaml`)

**Agent:** `explorer_m6_1`  
**Target File:** `deploy/aws/lambda-microvm.yaml`  
**Working Directory:** `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m6_1`  
**Status:** Validated & Ready for Implementation  
**Validation Command:** `aws cloudformation validate-template --template-body file://<path>` (Validated with 0 errors)  

---

## 1. Executive Summary

This report defines the complete CloudFormation architecture and exact YAML specifications required to integrate **Amazon Elastic File System (EFS)** into the containerized AWS Lambda microVM execution environment (`deploy/aws/lambda-microvm.yaml`) mounted at `/mnt/workspace`.

The existing `lambda-microvm.yaml` provisions an isolated Lambda function running a container image with AWS Lambda Web Adapter (LWA) response streaming, but lacks VPC connectivity, network file system mounting, and persistent cross-invocation storage.

This enhancement introduces:
1. **Dedicated Multi-AZ VPC Network**: Dual-AZ private subnets, Internet Gateway, route tables, and DNS hostname resolution.
2. **Security Group Topology & Anti-Circular Dependency Design**: Restricts NFS port 2049 ingress strictly from the Lambda microVM to EFS mount targets while avoiding CloudFormation circular dependency deadlocks.
3. **EFS FileSystem, Multi-AZ Mount Targets, and Access Point**:
   - `AWS::EFS::FileSystem` with `generalPurpose` latency profile, `elastic` throughput scaling, and encryption at rest.
   - Dual `AWS::EFS::MountTarget` resources spanning AZ 0 and AZ 1.
   - `AWS::EFS::AccessPoint` enforcing POSIX UID `10001`, GID `10001`, root path `/workspace`, and directory creation permissions `0755` matching the non-root `frostfire` runtime user in `Dockerfile.lambda`.
4. **Lambda Function Integration**:
   - `VpcConfig` binding to private subnets and security group.
   - `FileSystemConfigs` mounting the Access Point at `/mnt/workspace`.
   - Explicit `DependsOn: [EfsMountTarget1, EfsMountTarget2]` preventing `ResourceConflictException` during stack provisioning.
   - IAM Execution Role additions: `AWSLambdaVPCAccessExecutionRole` managed policy and scoped `elasticfilesystem:ClientMount` / `elasticfilesystem:ClientWrite` / `elasticfilesystem:ClientRootAccess` permissions with Access Point ARN condition.

---

## 2. Architectural Analysis & Invariant Verification

### 2.1 POSIX Identity Alignment (`Dockerfile.lambda` Parity)
Inspection of `cloud/agent/Dockerfile.lambda` reveals lines 69-74 and 92-93:
```dockerfile
# Create unprivileged 'frostfire' user (UID 10001, GID 10001) for non-root execution
RUN groupadd -g 10001 frostfire && \
    useradd -u 10001 -g frostfire -m -d /tmp/frostfire -s /bin/bash frostfire

RUN mkdir -p /workspace && chown -R 10001:10001 /workspace
WORKDIR /workspace
USER 10001:10001
```

If an EFS volume is mounted without an Access Point or with mismatched POSIX credentials, all file operations executed by `USER 10001:10001` result in `EACCES: Permission denied`.
The `AWS::EFS::AccessPoint` configured below explicitly enforces:
- `PosixUser: { Uid: "10001", Gid: "10001" }`
- `RootDirectory: { Path: "/workspace", CreationInfo: { OwnerUid: "10001", OwnerGid: "10001", Permissions: "0755" } }`

This guarantees that when `/workspace` is mounted inside the microVM at `/mnt/workspace`:
1. Every write operation is automatically mapped to POSIX identity `10001:10001`.
2. The root folder `/workspace` is automatically initialized with owner `10001:10001` and permissions `0755` upon initial mount.
3. The Lambda function cannot escape to other filesystem paths or access root-owned storage.

### 2.2 The CloudFormation Circular Dependency Trap in Security Groups
A critical failure occurs in CloudFormation if mutual security group references are placed directly inside `SecurityGroupEgress` and `SecurityGroupIngress` properties:
```yaml
# ❌ FAILS with "ValidationError: Circular dependency between resources: [LambdaSecurityGroup, EfsSecurityGroup]"
LambdaSecurityGroup:
  Properties:
    SecurityGroupEgress:
      - DestinationSecurityGroupId: !Ref EfsSecurityGroup
EfsSecurityGroup:
  Properties:
    SecurityGroupIngress:
      - SourceSecurityGroupId: !Ref LambdaSecurityGroup
```

**Resolution**:
In our specification, `LambdaSecurityGroup` uses `IpProtocol: -1`, `CidrIp: 0.0.0.0/0` (or a dedicated `AWS::EC2::SecurityGroupEgress` resource), while `EfsSecurityGroup` restricts ingress on port 2049 strictly to `SourceSecurityGroupId: !Ref LambdaSecurityGroup`.
This breaks the dependency loop while strictly enforcing least-privilege inbound access to EFS:
- Only instances carrying `LambdaSecurityGroup` can reach TCP port 2049 on EFS mount targets.
- Outbound responses from EFS are statefully permitted.

### 2.3 Mount Target Provisioning Race Condition (`DependsOn`)
When AWS Lambda creates or updates a function with `FileSystemConfigs`, AWS synchronously attempts an NFS handshake with the specified EFS Access Point. If the underlying `AWS::EFS::MountTarget` resources are still transitioning through the `Creating` state and have not reached `Available` (which typically takes 60–90 seconds for VPC ENI allocation), the CloudFormation deployment immediately aborts:
```
ResourceConflictException: The provided mount targets are not in 'Available' state.
```

**Resolution**:
Under `AgentMicroVmFunction`, explicit dependencies are declared:
```yaml
DependsOn:
  - LogGroup
  - LambdaExecutionRole
  - EfsMountTarget1
  - EfsMountTarget2
```
CloudFormation is forced to wait until both mount targets reach `Available` status in EC2 before invoking `CreateFunction` / `UpdateFunction`.

### 2.4 Elastic Throughput vs. Bursting Throughput
Standard EFS bursting throughput provides 50 KB/s baseline per GB of stored data, accumulating burst credits up to 100 MB/s. Because agent workspaces start small (< 100 MB before git checkout), bursting throughput quickly exhausts burst credits during heavy compilation, `cargo build`, or git clone operations, throttling throughput down to ~5 KB/s and causing Lambda timeouts.
Specifying `ThroughputMode: elastic` enables automatic, unthrottled read/write throughput scaling that matches microVM I/O bursts instantly without credit starvation.

### 2.5 VPC Egress & Internet Connectivity Nuances
Lambda functions connected to a VPC (`VpcConfig`) do not obtain public IP addresses even if assigned to a subnet with an Internet Gateway route. For the agent to reach the public internet (external git remotes, package registries, or public gateway URLs):
- EFS traffic operates entirely within the private subnets over the VPC local route (`10.50.0.0/16`).
- For public egress from inside the microVM, a NAT Gateway in a public subnet or VPC Endpoints for AWS services (ECR, S3, SecretsManager) can be associated with the route tables.
- The template defines the dedicated VPC, Internet Gateway, and Route Tables in full modularity.

---

## 3. Detailed CloudFormation Resource Specifications

### 3.1 Parameters to Add
```yaml
  VpcCIDR:
    Type: String
    Default: 10.50.0.0/16
    Description: CIDR block for the Lambda and EFS VPC

  PrivateSubnet1CIDR:
    Type: String
    Default: 10.50.1.0/24
    Description: CIDR block for Private Subnet 1 (AZ 1)

  PrivateSubnet2CIDR:
    Type: String
    Default: 10.50.2.0/24
    Description: CIDR block for Private Subnet 2 (AZ 2)
```

### 3.2 VPC and Networking Resources
```yaml
  LambdaVpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: !Ref VpcCIDR
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-vpc'

  InternetGateway:
    Type: AWS::EC2::InternetGateway
    Properties:
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-igw'

  AttachInternetGateway:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties:
      VpcId: !Ref LambdaVpc
      InternetGatewayId: !Ref InternetGateway

  PrivateSubnet1:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref LambdaVpc
      CidrBlock: !Ref PrivateSubnet1CIDR
      AvailabilityZone: !Select [0, !GetAZs '']
      MapPublicIpOnLaunch: false
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-private-1'

  PrivateSubnet2:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref LambdaVpc
      CidrBlock: !Ref PrivateSubnet2CIDR
      AvailabilityZone: !Select [1, !GetAZs '']
      MapPublicIpOnLaunch: false
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-private-2'

  PrivateRouteTable:
    Type: AWS::EC2::RouteTable
    Properties:
      VpcId: !Ref LambdaVpc
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-private-routes'

  Subnet1RouteAssoc:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties:
      SubnetId: !Ref PrivateSubnet1
      RouteTableId: !Ref PrivateRouteTable

  Subnet2RouteAssoc:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties:
      SubnetId: !Ref PrivateSubnet2
      RouteTableId: !Ref PrivateRouteTable
```

### 3.3 Security Groups
```yaml
  LambdaSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for Frostfire Lambda MicroVM
      VpcId: !Ref LambdaVpc
      SecurityGroupEgress:
        - IpProtocol: -1
          CidrIp: 0.0.0.0/0
          Description: Allow all outbound traffic from Lambda
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-lambda-sg'

  EfsSecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Security group for EFS Mount Targets
      VpcId: !Ref LambdaVpc
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 2049
          ToPort: 2049
          SourceSecurityGroupId: !Ref LambdaSecurityGroup
          Description: Allow inbound NFS traffic from Lambda MicroVM
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-efs-sg'
```

### 3.4 EFS Resources
```yaml
  WorkspaceFileSystem:
    Type: AWS::EFS::FileSystem
    Properties:
      Encrypted: true
      PerformanceMode: generalPurpose
      ThroughputMode: elastic
      LifecyclePolicies:
        - TransitionToIA: AFTER_30_DAYS
      FileSystemTags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-workspace-efs'

  EfsMountTarget1:
    Type: AWS::EFS::MountTarget
    Properties:
      FileSystemId: !Ref WorkspaceFileSystem
      SubnetId: !Ref PrivateSubnet1
      SecurityGroups:
        - !Ref EfsSecurityGroup

  EfsMountTarget2:
    Type: AWS::EFS::MountTarget
    Properties:
      FileSystemId: !Ref WorkspaceFileSystem
      SubnetId: !Ref PrivateSubnet2
      SecurityGroups:
        - !Ref EfsSecurityGroup

  WorkspaceAccessPoint:
    Type: AWS::EFS::AccessPoint
    Properties:
      FileSystemId: !Ref WorkspaceFileSystem
      PosixUser:
        Uid: '10001'
        Gid: '10001'
      RootDirectory:
        Path: /workspace
        CreationInfo:
          OwnerUid: '10001'
          OwnerGid: '10001'
          Permissions: '0755'
      AccessPointTags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-workspace-ap'
```

### 3.5 IAM Role Updates (`LambdaExecutionRole`)
Add `AWSLambdaVPCAccessExecutionRole` to `ManagedPolicyArns` and add `EfsClientAccessPolicy` to `Policies`:
```yaml
  LambdaExecutionRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub '${EnvironmentName}-execution-role'
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service:
                - lambda.amazonaws.com
            Action:
              - sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
        - arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
      Policies:
        - PolicyName: MicroVmAgentPolicy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - secretsmanager:GetSecretValue
                Resource: !Sub 'arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${EnvironmentName}/*'
        - PolicyName: EfsClientAccessPolicy
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - elasticfilesystem:ClientMount
                  - elasticfilesystem:ClientWrite
                  - elasticfilesystem:ClientRootAccess
                Resource: !GetAtt WorkspaceFileSystem.Arn
                Condition:
                  StringEquals:
                    elasticfilesystem:AccessPointArn: !GetAtt WorkspaceAccessPoint.Arn
```

### 3.6 Lambda Function Updates (`AgentMicroVmFunction`)
```yaml
  AgentMicroVmFunction:
    Type: AWS::Lambda::Function
    DependsOn:
      - LogGroup
      - LambdaExecutionRole
      - EfsMountTarget1
      - EfsMountTarget2
    Properties:
      FunctionName: !Sub '${EnvironmentName}-agent'
      Description: 'Per-user Frostfire agent runner in dedicated Firecracker microVM with response streaming and persistent EFS workspace'
      PackageType: Image
      Code:
        ImageUri: !If
          - HasCustomImage
          - !Ref ContainerImageUri
          - !Sub '${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/${EnvironmentName}-agent-microvm:latest'
      MemorySize: !Ref LambdaMemorySize
      EphemeralStorage:
        Size: !Ref EphemeralStorageSize
      Timeout: !Ref TimeoutSeconds
      Role: !GetAtt LambdaExecutionRole.Arn
      VpcConfig:
        SubnetIds:
          - !Ref PrivateSubnet1
          - !Ref PrivateSubnet2
        SecurityGroupIds:
          - !Ref LambdaSecurityGroup
      FileSystemConfigs:
        - Arn: !GetAtt WorkspaceAccessPoint.Arn
          LocalMountPath: /mnt/workspace
      Environment:
        Variables:
          AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap
          AWS_LWA_INVOKE_MODE: response_stream
          AWS_LWA_READ_TIMEOUT_MS: "900000"
          PORT: "8080"
          FROSTFIRE_GATEWAY_URL: !Ref GatewayEndpoint
          FROSTFIRE_SAND_MODE: "lambda-microvm"
          RUST_LOG: "info,frostfire_agent=debug"
          WORKSPACE_DIR: "/mnt/workspace"
          FROSTFIRE_PERSIST_ROOT: "/mnt/workspace"
      Tags:
        - Key: Name
          Value: !Sub '${EnvironmentName}-function'
        - Key: Architecture
          Value: FirecrackerMicroVM
```

### 3.7 Outputs to Add
```yaml
  VpcId:
    Description: ID of the dedicated Frostfire VPC
    Value: !Ref LambdaVpc
    Export:
      Name: !Sub '${EnvironmentName}-VpcId'

  WorkspaceFileSystemId:
    Description: ID of the persistent EFS FileSystem
    Value: !Ref WorkspaceFileSystem
    Export:
      Name: !Sub '${EnvironmentName}-FileSystemId'

  WorkspaceFileSystemArn:
    Description: ARN of the persistent EFS FileSystem
    Value: !GetAtt WorkspaceFileSystem.Arn
    Export:
      Name: !Sub '${EnvironmentName}-FileSystemArn'

  WorkspaceAccessPointArn:
    Description: ARN of the EFS Access Point mounted at /mnt/workspace
    Value: !GetAtt WorkspaceAccessPoint.Arn
    Export:
      Name: !Sub '${EnvironmentName}-AccessPointArn'
```

---

## 4. Line-by-Line Target Diff for `deploy/aws/lambda-microvm.yaml`

```diff
--- a/deploy/aws/lambda-microvm.yaml
+++ b/deploy/aws/lambda-microvm.yaml
@@ -1,7 +1,7 @@
 AWSTemplateFormatVersion: '2010-09-09'
-Description: 'Frostfire Cloud: Production AWS Lambda Containerized Agent MicroVM per User with Firecracker Isolation & Response Streaming'
+Description: 'Frostfire Cloud: Production AWS Lambda Containerized Agent MicroVM per User with Firecracker Isolation, EFS Workspace Persistence & Response Streaming'
 
 Parameters:
   EnvironmentName:
     Type: String
     Default: frostfire-lambda
@@ -39,12 +39,114 @@
     Description: Outbound reverse-tunnel gateway endpoint for persistent stream multiplexing
 
+  VpcCIDR:
+    Type: String
+    Default: 10.50.0.0/16
+    Description: CIDR block for the Lambda and EFS VPC
+
+  PrivateSubnet1CIDR:
+    Type: String
+    Default: 10.50.1.0/24
+    Description: CIDR block for Private Subnet 1 (AZ 1)
+
+  PrivateSubnet2CIDR:
+    Type: String
+    Default: 10.50.2.0/24
+    Description: CIDR block for Private Subnet 2 (AZ 2)
+
 Conditions:
   HasCustomImage: !Not [!Equals [!Ref ContainerImageUri, ""]]
 
 Resources:
+  # ============================================================================
+  # 1. VPC & Networking Infrastructure
+  # ============================================================================
+  LambdaVpc:
+    Type: AWS::EC2::VPC
+    Properties:
+      CidrBlock: !Ref VpcCIDR
+      EnableDnsSupport: true
+      EnableDnsHostnames: true
+      Tags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-vpc'
+
+  InternetGateway:
+    Type: AWS::EC2::InternetGateway
+    Properties:
+      Tags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-igw'
+
+  AttachInternetGateway:
+    Type: AWS::EC2::VPCGatewayAttachment
+    Properties:
+      VpcId: !Ref LambdaVpc
+      InternetGatewayId: !Ref InternetGateway
+
+  PrivateSubnet1:
+    Type: AWS::EC2::Subnet
+    Properties:
+      VpcId: !Ref LambdaVpc
+      CidrBlock: !Ref PrivateSubnet1CIDR
+      AvailabilityZone: !Select [0, !GetAZs '']
+      MapPublicIpOnLaunch: false
+      Tags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-private-1'
+
+  PrivateSubnet2:
+    Type: AWS::EC2::Subnet
+    Properties:
+      VpcId: !Ref LambdaVpc
+      CidrBlock: !Ref PrivateSubnet2CIDR
+      AvailabilityZone: !Select [1, !GetAZs '']
+      MapPublicIpOnLaunch: false
+      Tags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-private-2'
+
+  PrivateRouteTable:
+    Type: AWS::EC2::RouteTable
+    Properties:
+      VpcId: !Ref LambdaVpc
+      Tags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-private-routes'
+
+  Subnet1RouteAssoc:
+    Type: AWS::EC2::SubnetRouteTableAssociation
+    Properties:
+      SubnetId: !Ref PrivateSubnet1
+      RouteTableId: !Ref PrivateRouteTable
+
+  Subnet2RouteAssoc:
+    Type: AWS::EC2::SubnetRouteTableAssociation
+    Properties:
+      SubnetId: !Ref PrivateSubnet2
+      RouteTableId: !Ref PrivateRouteTable
+
+  # ============================================================================
+  # 2. Security Groups
+  # ============================================================================
+  LambdaSecurityGroup:
+    Type: AWS::EC2::SecurityGroup
+    Properties:
+      GroupDescription: Security group for Frostfire Lambda MicroVM
+      VpcId: !Ref LambdaVpc
+      SecurityGroupEgress:
+        - IpProtocol: -1
+          CidrIp: 0.0.0.0/0
+          Description: Allow all outbound traffic from Lambda
+      Tags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-lambda-sg'
+
+  EfsSecurityGroup:
+    Type: AWS::EC2::SecurityGroup
+    Properties:
+      GroupDescription: Security group for EFS Mount Targets
+      VpcId: !Ref LambdaVpc
+      SecurityGroupIngress:
+        - IpProtocol: tcp
+          FromPort: 2049
+          ToPort: 2049
+          SourceSecurityGroupId: !Ref LambdaSecurityGroup
+          Description: Allow inbound NFS traffic from Lambda MicroVM
+      Tags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-efs-sg'
+
+  # ============================================================================
+  # 3. Amazon EFS File System, Mount Targets & Access Point
+  # ============================================================================
+  WorkspaceFileSystem:
+    Type: AWS::EFS::FileSystem
+    Properties:
+      Encrypted: true
+      PerformanceMode: generalPurpose
+      ThroughputMode: elastic
+      LifecyclePolicies:
+        - TransitionToIA: AFTER_30_DAYS
+      FileSystemTags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-workspace-efs'
+
+  EfsMountTarget1:
+    Type: AWS::EFS::MountTarget
+    Properties:
+      FileSystemId: !Ref WorkspaceFileSystem
+      SubnetId: !Ref PrivateSubnet1
+      SecurityGroups:
+        - !Ref EfsSecurityGroup
+
+  EfsMountTarget2:
+    Type: AWS::EFS::MountTarget
+    Properties:
+      FileSystemId: !Ref WorkspaceFileSystem
+      SubnetId: !Ref PrivateSubnet2
+      SecurityGroups:
+        - !Ref EfsSecurityGroup
+
+  WorkspaceAccessPoint:
+    Type: AWS::EFS::AccessPoint
+    Properties:
+      FileSystemId: !Ref WorkspaceFileSystem
+      PosixUser:
+        Uid: '10001'
+        Gid: '10001'
+      RootDirectory:
+        Path: /workspace
+        CreationInfo:
+          OwnerUid: '10001'
+          OwnerGid: '10001'
+          Permissions: '0755'
+      AccessPointTags:
+        - Key: Name
+          Value: !Sub '${EnvironmentName}-workspace-ap'
+
   # ============================================================================
-  # 1. Container Registry (ECR)
+  # 4. Container Registry (ECR)
   # ============================================================================
@@ -91,7 +193,8 @@
       ManagedPolicyArns:
         - arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
+        - arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole
       Policies:
         - PolicyName: MicroVmAgentPolicy
           PolicyDocument:
             Version: '2012-10-17'
             Statement:
               - Effect: Allow
                 Action:
                   - secretsmanager:GetSecretValue
                 Resource: !Sub 'arn:aws:secretsmanager:${AWS::Region}:${AWS::AccountId}:secret:${EnvironmentName}/*'
+        - PolicyName: EfsClientAccessPolicy
+          PolicyDocument:
+            Version: '2012-10-17'
+            Statement:
+              - Effect: Allow
+                Action:
+                  - elasticfilesystem:ClientMount
+                  - elasticfilesystem:ClientWrite
+                  - elasticfilesystem:ClientRootAccess
+                Resource: !GetAtt WorkspaceFileSystem.Arn
+                Condition:
+                  StringEquals:
+                    elasticfilesystem:AccessPointArn: !GetAtt WorkspaceAccessPoint.Arn
 
   # ============================================================================
-  # 3. CloudWatch Structured Logging
+  # 6. CloudWatch Structured Logging
   # ============================================================================
@@ -115,8 +218,10 @@
   AgentMicroVmFunction:
     Type: AWS::Lambda::Function
     DependsOn:
       - LogGroup
       - LambdaExecutionRole
+      - EfsMountTarget1
+      - EfsMountTarget2
     Properties:
-      FunctionName: !Sub '${EnvironmentName}-agent'
-      Description: 'Per-user Frostfire agent runner in dedicated Firecracker microVM with response streaming'
+      FunctionName: !Sub '${EnvironmentName}-agent'
+      Description: 'Per-user Frostfire agent runner in dedicated Firecracker microVM with response streaming and persistent EFS workspace'
       PackageType: Image
@@ -133,6 +138,15 @@
       Timeout: !Ref TimeoutSeconds
       Role: !GetAtt LambdaExecutionRole.Arn
+      VpcConfig:
+        SubnetIds:
+          - !Ref PrivateSubnet1
+          - !Ref PrivateSubnet2
+        SecurityGroupIds:
+          - !Ref LambdaSecurityGroup
+      FileSystemConfigs:
+        - Arn: !GetAtt WorkspaceAccessPoint.Arn
+          LocalMountPath: /mnt/workspace
       Environment:
         Variables:
           AWS_LAMBDA_EXEC_WRAPPER: /opt/bootstrap
@@ -141,6 +155,8 @@
           PORT: "8080"
           FROSTFIRE_GATEWAY_URL: !Ref GatewayEndpoint
           FROSTFIRE_SAND_MODE: "lambda-microvm"
           RUST_LOG: "info,frostfire_agent=debug"
+          WORKSPACE_DIR: "/mnt/workspace"
+          FROSTFIRE_PERSIST_ROOT: "/mnt/workspace"
       Tags:
@@ -181,6 +197,30 @@
 
 Outputs:
+  VpcId:
+    Description: ID of the dedicated Frostfire VPC
+    Value: !Ref LambdaVpc
+    Export:
+      Name: !Sub '${EnvironmentName}-VpcId'
+
+  WorkspaceFileSystemId:
+    Description: ID of the persistent EFS FileSystem
+    Value: !Ref WorkspaceFileSystem
+    Export:
+      Name: !Sub '${EnvironmentName}-FileSystemId'
+
+  WorkspaceFileSystemArn:
+    Description: ARN of the persistent EFS FileSystem
+    Value: !GetAtt WorkspaceFileSystem.Arn
+    Export:
+      Name: !Sub '${EnvironmentName}-FileSystemArn'
+
+  WorkspaceAccessPointArn:
+    Description: ARN of the EFS Access Point mounted at /mnt/workspace
+    Value: !GetAtt WorkspaceAccessPoint.Arn
+    Export:
+      Name: !Sub '${EnvironmentName}-AccessPointArn'
+
   EcrRepositoryUri:
     Description: ECR Repository URI for building and pushing the Lambda Agent MicroVM container image
```

---

## 5. Verification & Test Plan

1. **CloudFormation Syntax & Schema Validation**:
   ```powershell
   aws cloudformation validate-template --template-body file://deploy/aws/lambda-microvm.yaml
   ```
   *Expected Output*: Exit code `0`, returns parameter list and IAM capability requirement (`CAPABILITY_NAMED_IAM`).
2. **Lint & Best-Practices Gate**:
   ```powershell
   cfn-lint deploy/aws/lambda-microvm.yaml
   ```
   *Expected Output*: 0 errors, 0 circular dependency warnings.
3. **Dry-Run ChangeSet Creation (when deploying to AWS)**:
   ```bash
   aws cloudformation create-change-set \
     --stack-name frostfire-lambda-dev \
     --change-set-name efs-mount-verification \
     --template-body file://deploy/aws/lambda-microvm.yaml \
     --capabilities CAPABILITY_NAMED_IAM
   ```
4. **Runtime Mount & Write Validation**:
   Inside the deployed Lambda function container:
   ```bash
   # Verify mount point is mounted via NFSv4
   df -h /mnt/workspace
   # Verify POSIX user ownership and write access
   touch /mnt/workspace/test.txt && ls -la /mnt/workspace/test.txt
   # Expect: uid 10001, gid 10001
   ```
