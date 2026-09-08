"""
Feature 14: Scheduled Cron Routine Engine (ORIGINAL_REQUEST §R3)
Tests cron expression parsing, next run computation, and SQLite routine persistence.
"""

import unittest
import time
from ..harness import CronParser, RoutineStore, RoutineJob


class TestFeature14CronEngine(unittest.TestCase):
    """Verifies scheduled agent routine registration, cron parsing, and SQLite persistence."""

    def test_feat14_01_cron_parser_validates_standard_expressions(self):
        """Authoritative Source: ORIGINAL_REQUEST.md §R3 line 39 & Acceptance Criteria line 57."""
        valid_expressions = [
            "* * * * *",       # Every minute
            "*/15 * * * *",    # Every 15 minutes
            "0 9 * * 1-5",     # 9am on weekdays
            "0 0 1 1 *",       # Midnight on Jan 1st
            "30 23 * * 0,6",   # 11:30pm on weekends
        ]
        for expr in valid_expressions:
            try:
                CronParser.validate_expression(expr)
            except Exception as e:
                self.fail(f"Valid expression '{expr}' failed validation: {e}")

    def test_feat14_02_cron_next_run_calculation(self):
        """Authoritative Source: Next execution calculation specification."""
        # Test reference: 2026-09-08 12:00:00 UTC (timestamp 1788868800)
        # Expression: every hour on minute 15 -> next run must be 12:15:00 UTC
        expr = "15 * * * *"
        ref_ts = 1788868800  # 12:00:00
        next_run = CronParser.compute_next_run(expr, ref_ts)
        self.assertGreater(next_run, ref_ts)
        self.assertEqual(next_run - ref_ts, 15 * 60)  # Exactly 15 minutes later

    def test_feat14_03_sqlite_routine_store_persistence(self):
        """Authoritative Source: PROJECT.md Feature 15 (SQLite RoutineStore)."""
        store = RoutineStore(":memory:")
        job = RoutineJob(
            id="routine_daily_review",
            name="Daily Code Review",
            cron_expr="0 9 * * *",
            action_payload='{"action": "code_review", "target": "main"}',
            enabled=True
        )
        store.add_routine(job)

        fetched = store.get_routine("routine_daily_review")
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.name, "Daily Code Review")
        self.assertEqual(fetched.cron_expr, "0 9 * * *")
        store.close()

    def test_feat14_04_due_routines_query(self):
        """Authoritative Source: Routine runner polling specification."""
        store = RoutineStore(":memory:")
        now = int(time.time())
        due_job = RoutineJob(
            id="due_job_1",
            name="Immediate Job",
            cron_expr="* * * * *",
            action_payload="{}",
            next_run_at=now - 10,  # 10 seconds ago
            enabled=True
        )
        future_job = RoutineJob(
            id="future_job_1",
            name="Future Job",
            cron_expr="* * * * *",
            action_payload="{}",
            next_run_at=now + 3600, # 1 hour from now
            enabled=True
        )
        store.add_routine(due_job)
        store.add_routine(future_job)

        due_list = store.list_due_routines(current_timestamp=now)
        due_ids = [j.id for j in due_list]
        self.assertIn("due_job_1", due_ids)
        self.assertNotIn("future_job_1", due_ids)
        store.close()

    def test_feat14_05_routine_toggle_and_run_recording(self):
        """Authoritative Source: Routine state management specification."""
        store = RoutineStore(":memory:")
        job = RoutineJob(
            id="toggle_job",
            name="Toggleable",
            cron_expr="0 12 * * *",
            action_payload="{}",
            enabled=True
        )
        store.add_routine(job)

        store.toggle_enabled("toggle_job", enabled=False)
        fetched = store.get_routine("toggle_job")
        self.assertFalse(fetched.enabled)

        # Record execution
        store.record_run("toggle_job", run_time=1000, next_run=2000)
        fetched = store.get_routine("toggle_job")
        self.assertEqual(fetched.last_run_at, 1000)
        self.assertEqual(fetched.next_run_at, 2000)
        store.close()


if __name__ == "__main__":
    unittest.main()
