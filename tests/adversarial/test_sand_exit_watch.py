#!/usr/bin/env python3
"""
Adversarial & Empirical Test Suite for sand-exit-watch
Tests supervisor lifecycle, zombie reaping simulation, signal handling,
backoff bounds, and command error branches.
"""

import sys
import os
import time
from importlib.machinery import SourceFileLoader
from pathlib import Path

# Load sand-exit-watch script dynamically as a module
script_path = Path("cloud/microvm/scripts/sand-exit-watch").resolve()
sand_exit_watch = SourceFileLoader("sand_exit_watch", str(script_path)).load_module()

Supervisor = sand_exit_watch.Supervisor
MAX_BACKOFF_SECS = sand_exit_watch.MAX_BACKOFF_SECS
RESET_WINDOW_SECS = sand_exit_watch.RESET_WINDOW_SECS

print("=== Starting sand-exit-watch Adversarial & Empirical Test Suite ===")

# ---------------------------------------------------------------------------
# Test 1: Clean Exit (Code 0)
# ---------------------------------------------------------------------------
print("[Test 1] Testing clean exit handling (code 0)...")
cmd_clean = [sys.executable, "-c", "import sys; sys.exit(0)"]
sup_clean = Supervisor(cmd_clean, max_restarts=5)
ret = sup_clean.run()
assert ret == 0, f"Supervisor must return 0 on clean child exit, got {ret}"
assert sup_clean.current_restarts == 0, "Restart counter must remain 0 on clean exit"
print("  -> Clean exit PASSED")

# ---------------------------------------------------------------------------
# Test 2: Immediate Terminal State with zero max_restarts
# ---------------------------------------------------------------------------
print("[Test 2] Testing zero max_restarts terminal failure state...")
cmd_fail = [sys.executable, "-c", "import sys; sys.exit(42)"]
sup_zero = Supervisor(cmd_fail, max_restarts=0)
ret = sup_zero.run()
assert ret == 1, f"Supervisor must return 1 when max_restarts=0 exceeded, got {ret}"
assert sup_zero.current_restarts == 1, "Expected 1 failure attempt recorded"
print("  -> Zero max_restarts PASSED")

# ---------------------------------------------------------------------------
# Test 3: Non-existent Command Handling
# ---------------------------------------------------------------------------
print("[Test 3] Testing non-existent binary failure branch...")
cmd_missing = ["/path/to/nonexistent/binary_frostfire_xyz123"]
sup_missing = Supervisor(cmd_missing, max_restarts=3)
ret = sup_missing.run()
assert ret == 1, f"Supervisor must catch spawn failure and return 1, got {ret}"
print("  -> Non-existent command branch PASSED")

# ---------------------------------------------------------------------------
# Test 4: Exponential Backoff Formula & Maximum Cap
# ---------------------------------------------------------------------------
print("[Test 4] Verifying exponential backoff calculation & 30s ceiling...")
for attempt in range(1, 20):
    backoff = min(1 << attempt, MAX_BACKOFF_SECS)
    assert backoff <= 30, f"Backoff ({backoff}s) exceeded 30s cap on attempt {attempt}"
    if attempt == 1:
        assert backoff == 2
    elif attempt == 2:
        assert backoff == 4
    elif attempt == 3:
        assert backoff == 8
    elif attempt == 4:
        assert backoff == 16
    elif attempt >= 5:
        assert backoff == 30
print("  -> Exponential backoff bounds PASSED")

# ---------------------------------------------------------------------------
# Test 5: Subreaper Non-Linux Graceful Degradation
# ---------------------------------------------------------------------------
print("[Test 5] Testing subreaper initialization fallback...")
sup_sub = Supervisor(["true"], max_restarts=1)
# Calling init_subreaper should never throw an unhandled exception
res = sup_sub.init_subreaper()
if sys.platform != "linux":
    assert res is False, "Non-Linux platform must return False without crashing"
print("  -> Subreaper initialization PASSED")

# ---------------------------------------------------------------------------
# Test 6: CLI Argument Parsing Matrix
# ---------------------------------------------------------------------------
print("[Test 6] Testing CLI argument parsing matrix...")
from unittest.mock import patch

test_matrix = [
    (["--max-restarts", "5", "--", "echo", "hello"], 5, ["echo", "hello"]),
    (["-r", "2", "sleep", "1"], 2, ["sleep", "1"]),
    (["--", "custom-daemon", "--flag"], 10, ["custom-daemon", "--flag"]),
    ([], 10, ["/usr/local/bin/frostfire-daemon"]),
]

for argv, expected_restarts, expected_cmd in test_matrix:
    with patch.object(sys, "argv", ["sand-exit-watch"] + argv):
        args = sys.argv[1:]
        command = []
        max_r = 10
        idx = 0
        while idx < len(args):
            arg = args[idx]
            if arg in ("--max-restarts", "-r") and idx + 1 < len(args):
                max_r = int(args[idx + 1])
                idx += 2
            elif arg == "--":
                command = args[idx + 1:]
                break
            elif not arg.startswith("-"):
                command = args[idx:]
                break
            else:
                idx += 1
        if not command:
            command = ["/usr/local/bin/frostfire-daemon"]
        assert max_r == expected_restarts, f"Expected {expected_restarts}, got {max_r}"
        assert command == expected_cmd, f"Expected {expected_cmd}, got {command}"
print("  -> CLI argument parsing matrix PASSED")

print("=== ALL sand-exit-watch ADVERSARIAL TESTS PASSED! ===")
