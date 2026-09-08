import sys
import os
import subprocess

# Add script directory to path
script_path = os.path.abspath("cloud/microvm/scripts/sand-exit-watch")

# 1. Test help / usage or basic execution
proc = subprocess.run([sys.executable, script_path, "--max-restarts", "2", "--", sys.executable, "-c", "import sys; sys.exit(0)"], capture_output=True, text=True)
assert proc.returncode == 0, f"Clean child exit should result in code 0, got {proc.returncode}"
assert "Monitored child exited cleanly with code 0" in proc.stderr

# 2. Test crash loop backoff & max restart termination
proc_crash = subprocess.run([sys.executable, script_path, "--max-restarts", "1", "--", sys.executable, "-c", "import sys; sys.exit(1)"], capture_output=True, text=True)
assert proc_crash.returncode == 1, f"Crash loop exceeded should return 1, got {proc_crash.returncode}"
assert "FATAL: Exceeded maximum restarts" in proc_crash.stderr

print("ALL SAND-EXIT-WATCH BEHAVIORAL TESTS PASSED")
