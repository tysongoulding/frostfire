"""
Feature 13: Crash-Loop Defenses & Orphan Reaping (ORIGINAL_REQUEST §R3)
Tests stale .X*-lock cleaning, dead socket cleanup, port reaping, and crash-loop backoff.
"""

import unittest
import tempfile
from pathlib import Path
from ..harness import StaleLockCleaner, CrashLoopWatchdog, PortReaper


class TestFeature13CrashDefenses(unittest.TestCase):
    """Verifies crash resilience, orphan process cleanup, and lock reclamation."""

    def test_feat13_01_stale_lock_cleaner_detects_dead_pid(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R3 line 38 (.X*-lock cleaning)."""
        # Mock PID checker where PID 999999 is dead
        cleaner = StaleLockCleaner(pid_checker=lambda pid: False)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            lock_file = tmp_path / ".X1-lock"
            lock_file.write_text("999999\n", encoding="utf-8")

            socket_dir = tmp_path / ".X11-unix"
            socket_dir.mkdir()
            socket_file = socket_dir / "X1"
            socket_file.write_text("DEAD_SOCKET", encoding="utf-8")

            reclaimed = cleaner.clean_stale_locks(tmp_path)
            self.assertIn(1, reclaimed)
            self.assertFalse(lock_file.exists())
            self.assertFalse(socket_file.exists())

    def test_feat13_02_stale_lock_cleaner_preserves_live_pid(self):
        """Authoritative Source: Safety rule: Active server locks must never be deleted."""
        # Mock PID checker where PID 1234 is alive
        cleaner = StaleLockCleaner(pid_checker=lambda pid: pid == 1234)
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            lock_file = tmp_path / ".X2-lock"
            lock_file.write_text("1234\n", encoding="utf-8")

            reclaimed = cleaner.clean_stale_locks(tmp_path)
            self.assertEqual(len(reclaimed), 0)
            self.assertTrue(lock_file.exists(), "Active lock file must be preserved")

    def test_feat13_03_port_reaper_reclaims_dead_process_ports(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R3 line 38 (stale RFB ports)."""
        reaper = PortReaper(pid_checker=lambda pid: pid == 100)
        reaper.register_binding(port=6081, pid=100)   # Alive
        reaper.register_binding(port=6082, pid=999)   # Dead

        reaped = reaper.reap_stale_ports()
        self.assertIn(6082, reaped)
        self.assertNotIn(6081, reaped)
        self.assertFalse(reaper.is_port_in_use(6082))
        self.assertTrue(reaper.is_port_in_use(6081))

    def test_feat13_04_crash_loop_watchdog_sliding_window(self):
        """Authoritative Source: PROJECT.md Feature 14 (CrashLoopWatchdog)."""
        dog = CrashLoopWatchdog(max_crashes=3, window_seconds=10.0)
        # Record 2 crashes
        dog.record_crash("agent_worker_1", timestamp=100.0)
        dog.record_crash("agent_worker_1", timestamp=102.0)
        self.assertFalse(dog.should_throttle("agent_worker_1", timestamp=103.0))

        # 3rd crash within window triggers throttling
        dog.record_crash("agent_worker_1", timestamp=104.0)
        self.assertTrue(dog.should_throttle("agent_worker_1", timestamp=105.0))

        # After window passes, throttling lifts
        self.assertFalse(dog.should_throttle("agent_worker_1", timestamp=115.0))

    def test_feat13_05_crash_loop_watchdog_exponential_backoff(self):
        """Authoritative Source: Exponential backoff calculation for process supervisor."""
        dog = CrashLoopWatchdog(max_crashes=3, base_backoff_seconds=2.0)
        dog.record_crash("svc", timestamp=1.0)
        dog.record_crash("svc", timestamp=2.0)
        self.assertEqual(dog.get_backoff_seconds("svc"), 0.0)

        dog.record_crash("svc", timestamp=3.0)  # 3rd crash
        self.assertEqual(dog.get_backoff_seconds("svc"), 2.0)

        dog.record_crash("svc", timestamp=4.0)  # 4th crash
        self.assertEqual(dog.get_backoff_seconds("svc"), 4.0)


if __name__ == "__main__":
    unittest.main()
