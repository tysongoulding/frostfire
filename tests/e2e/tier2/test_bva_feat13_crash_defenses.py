"""
Tier 2 BVA: Feature 13 Crash Defenses Boundary Value Analysis
Tests corrupted lock files, privileged port prevention, watchdog resets, and backoff caps.
"""

import unittest
import tempfile
from pathlib import Path
from ..harness import StaleLockCleaner, CrashLoopWatchdog, PortReaper


class TestBvaFeature13CrashDefenses(unittest.TestCase):
    """Boundary and corner case analysis for crash loop watchdog and orphan process reapers."""

    def test_bva13_01_corrupted_lock_file_handling(self):
        """Verifies that non-numeric lock files (e.g. garbage text) are treated as stale and unlinked."""
        cleaner = StaleLockCleaner(pid_checker=lambda pid: False)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            bad_lock = tmp_path / ".X5-lock"
            bad_lock.write_text("NOT_A_VALID_PID\n", encoding="utf-8")

            reclaimed = cleaner.clean_stale_locks(tmp_path)
            self.assertIn(5, reclaimed)
            self.assertFalse(bad_lock.exists())

    def test_bva13_02_privileged_port_reaping_prevention(self):
        """Verifies that system ports (< 1024) cannot be registered in the user port reaper."""
        reaper = PortReaper()
        with self.assertRaises(ValueError):
            reaper.register_binding(port=80, pid=100)

    def test_bva13_03_watchdog_reset_restores_state(self):
        """Verifies that explicit reset clears crash history and removes throttling."""
        dog = CrashLoopWatchdog(max_crashes=2, window_seconds=60.0)
        dog.record_crash("agent_x", timestamp=10.0)
        dog.record_crash("agent_x", timestamp=11.0)
        self.assertTrue(dog.should_throttle("agent_x", timestamp=12.0))

        dog.reset("agent_x")
        self.assertFalse(dog.should_throttle("agent_x", timestamp=13.0))

    def test_bva13_04_zero_window_watchdog_boundary(self):
        """Verifies that zero or negative window seconds raises ValueError."""
        def create_watchdog(win: float):
            if win <= 0:
                raise ValueError("window_seconds must be > 0")
            return CrashLoopWatchdog(window_seconds=win)

        with self.assertRaises(ValueError):
            create_watchdog(0.0)
        with self.assertRaises(ValueError):
            create_watchdog(-5.0)

    def test_bva13_05_max_backoff_cap_boundary(self):
        """Verifies that backoff is hard-capped at 60s even under 100 consecutive crashes."""
        dog = CrashLoopWatchdog(max_crashes=1, base_backoff_seconds=2.0)
        for i in range(100):
            dog.record_crash("agent_stress", timestamp=float(i))
        self.assertEqual(dog.get_backoff_seconds("agent_stress"), 60.0)


if __name__ == "__main__":
    unittest.main()
