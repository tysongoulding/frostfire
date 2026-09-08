# Dispatch: Explorer M2-2 (OverlayFS CoW MicroVM Branching & Script Syntax)

## Instructions
Read `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md`, `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md`, and `docs/MICROVM_ARCHITECTURE.md`.
Read `explorer_survey_3` handoff: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_survey_3\handoff.md`.
Your role is `teamwork_preview_explorer`.
Working directory: `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_2`.

Your scope is Milestone 2: MicroVM Virtualization Infrastructure (OverlayFS & Script Normalization):
1. Investigate OverlayFS Copy-on-Write rootfs branching in `cloud/microvm/run-vm.sh` and `cloud/microvm/build-rootfs.sh`:
   - Read-only golden base (`lowerdir`) layered over Docker rootfs.
   - Volatile sparse ext4 overlay (`upperdir` + `workdir`) mounted per-VM allowing instant branching without mutating the base image.
   - Firecracker drive attachment configuration (`is_read_only: true` for golden base if attached, or overlay rootfs mount in guest init).
2. Investigate script line endings (CRLF vs LF) and syntax validation:
   - Identify all shell scripts with Windows CRLF line endings (`cloud/microvm/run-vm.sh`, `cloud/microvm/build-rootfs.sh`, `cloud/microvm/scripts/start-desktop.sh`, `deploy/gcp/deploy-cloudrun.sh`, `deploy/proxmox/deploy-lxc.sh`, `scripts/gcp-setup-wizard.sh`).
   - Specify LF normalization and automated `bash -n` syntax verification.
3. Formulate exact implementation steps and test commands.
Deliver your report to `c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_2\report.md` and `handoff.md`.

## 2026-09-08T21:06:35Z
Read c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\ORIGINAL_REQUEST.md, c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\orchestrator_1\PROJECT.md, docs/MICROVM_ARCHITECTURE.md, and your dispatch instructions at c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_2\DISPATCH.md.
Your working directory is c:\Users\tyson\.repo\personal\frostfire-cloud\.agents\explorer_m2_2.
Investigate OverlayFS CoW branching in run-vm.sh and CRLF-to-LF line ending normalization. Deliver report.md and handoff.md, then notify parent.

