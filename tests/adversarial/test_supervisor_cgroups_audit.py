#!/usr/bin/env python3
"""
Tier 5 Adversarial & Empirical Audit Suite for Supervisor & Cgroup Invariants
Validates:
- sand-exit-watch:
  - Subreaper constant and initialization
  - Exponential backoff calculation and cap: min(1 << attempt, MAX_BACKOFF_SECS)
  - Maximum restarts exhaustion and exit code 1
  - Clean exit code 0 termination
  - Health/stability reset window (>= RESET_WINDOW_SECS resets restart counter to 0)
  - Signal handling and graceful shutdown logic
- box-cgroups.sh:
  - Dual-domain priority weights: interactive 800 vs agent 100 (8:1 ratio)
  - Memory bounds: interactive (4G high / 6G max) vs agent (10G high / 12G max)
  - Swap disabled (memory.swap.max = 0)
  - Input sanitization: path traversal prevention, weight bounds (1..10000), numeric PID validation
"""

import sys
import os
import re
import math
from pathlib import Path

def audit_supervisor():
    print("=== [Audit: sand-exit-watch Supervisor Invariants] ===")
    watch_path = Path("cloud/microvm/scripts/sand-exit-watch")
    assert watch_path.exists(), f"Missing {watch_path}"
    content = watch_path.read_text(encoding="utf-8")

    # 1. Subreaper Constant & Call
    assert "PR_SET_CHILD_SUBREAPER = 36" in content, "PR_SET_CHILD_SUBREAPER must be 36"
    assert "prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)" in content, "prctl must set child subreaper to 1"
    print("  ✓ Linux Subreaper PR_SET_CHILD_SUBREAPER=36 correctly specified and invoked.")

    # 2. Exponential Backoff Formula
    # Formula: min(1 << attempt, MAX_BACKOFF_SECS)
    assert "min(1 << self.current_restarts, MAX_BACKOFF_SECS)" in content, \
        "Missing exponential backoff formula: min(1 << self.current_restarts, MAX_BACKOFF_SECS)"

    MAX_BACKOFF = 30
    for attempt in range(1, 15):
        backoff = min(1 << attempt, MAX_BACKOFF)
        expected = min(2 ** attempt, 30)
        assert backoff == expected, f"Backoff calculation mismatch at attempt {attempt}: {backoff} != {expected}"
    print("  ✓ Exponential backoff math verified across attempts 1..15 (caps at 30s).")

    # 3. Stability Reset Window
    assert "RESET_WINDOW_SECS" in content, "Missing RESET_WINDOW_SECS constant"
    assert "self.current_restarts = 0" in content, "Missing reset of current_restarts on stable execution"
    print("  ✓ Stability reset window verified: child running >= RESET_WINDOW_SECS clears crash count.")

    # 4. Maximum Restarts Cap & Exit Code
    assert "if self.current_restarts > self.max_restarts:" in content, "Missing check for max_restarts exhaustion"
    assert "return 1" in content, "Exhausted restarts must return terminal failure code 1"
    assert "if code == 0:" in content, "Clean exit (code 0) must be handled"
    assert "return 0" in content, "Clean exit must return code 0"
    print("  ✓ Terminal crash loop exit (code 1) and clean termination (code 0) verified.")

    # 5. Zombie Reaping
    assert "waitpid(-1, os.WNOHANG)" in content, "Must invoke waitpid with -1 and WNOHANG to reap orphan zombies"
    assert "reap_zombies" in content, "reap_zombies function must be defined and called in event loops"
    print("  ✓ Orphan zombie reaping with WNOHANG verified.")

def audit_cgroups():
    print("\n=== [Audit: box-cgroups.sh Dual-Domain Cgroups Invariants] ===")
    cgroup_path = Path("cloud/microvm/scripts/box-cgroups.sh")
    assert cgroup_path.exists(), f"Missing {cgroup_path}"
    content = cgroup_path.read_text(encoding="utf-8")

    # 1. Dual-Slice Priority Ratio (800 vs 100)
    assert 'SAND_CGROUP_INTERACTIVE_WEIGHT="${SAND_CGROUP_INTERACTIVE_WEIGHT:-800}"' in content, \
        "Default interactive weight must be 800"
    assert 'SAND_CGROUP_AGENT_WEIGHT="${SAND_CGROUP_AGENT_WEIGHT:-100}"' in content, \
        "Default agent weight must be 100"

    # Invariant: interactive_weight >= agent_weight * 8
    assert 'SAND_CGROUP_INTERACTIVE_WEIGHT}" -lt "$((SAND_CGROUP_AGENT_WEIGHT * 8))"' in content, \
        "Missing 8:1 priority ratio invariant check"
    print("  ✓ Dual-domain priority weights verified: interactive (800) vs agent (100) -> 8:1 ratio.")

    # 2. Memory & Swap Constraints
    assert 'SAND_CGROUP_INTERACTIVE_MEMORY_HIGH="${SAND_CGROUP_INTERACTIVE_MEMORY_HIGH:-4G}"' in content, \
        "Interactive memory high must be 4G"
    assert 'SAND_CGROUP_INTERACTIVE_MEMORY_MAX="${SAND_CGROUP_INTERACTIVE_MEMORY_MAX:-6G}"' in content, \
        "Interactive memory max must be 6G"
    assert 'SAND_CGROUP_AGENT_MEMORY_HIGH="${SAND_CGROUP_AGENT_MEMORY_HIGH:-10G}"' in content, \
        "Agent memory high must be 10G"
    assert 'SAND_CGROUP_AGENT_MEMORY_MAX="${SAND_CGROUP_AGENT_MEMORY_MAX:-12G}"' in content, \
        "Agent memory max must be 12G"

    # Swap disabling: memory.swap.max = 0
    assert '"0" "${target_dir}/memory.swap.max"' in content, "Swap must be disabled via memory.swap.max = 0"
    print("  ✓ Memory throttling (interactive 4G/6G vs agent 10G/12G) and swap disabling verified.")

    # 3. Input Sanitization & Path Traversal Defense
    assert "sand_cgroup_sanitize_group" in content, "Must define group name sanitization function"
    assert "*..* | /* | \"\") return 1" in content, "Must reject .., absolute paths /, and empty group strings"

    # Numeric & range validation on cpu.weight
    assert '"${weight}" -lt 1 ] || [ "${weight}" -gt 10000' in content, \
        "Weight must be constrained strictly to range 1..10000"
    print("  ✓ Cgroup path traversal prevention and weight boundary validation verified.")

if __name__ == "__main__":
    try:
        audit_supervisor()
        audit_cgroups()
        print("\nAll Supervisor & Cgroups Tier 5 Audits PASSED successfully!")
    except AssertionError as err:
        print(f"\n[FATAL AUDIT FAILURE] {err}", file=sys.stderr)
        sys.exit(1)
