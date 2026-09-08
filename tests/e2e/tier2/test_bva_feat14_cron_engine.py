"""
Tier 2 BVA: Feature 14 Cron Engine Boundary Value Analysis
Tests invalid field counts, out-of-bounds fields, zero steps, inverted ranges, and empty IDs.
"""

import unittest
from ..harness import CronParser, RoutineJob, RoutineStore


class TestBvaFeature14CronEngine(unittest.TestCase):
    """Boundary and corner case analysis for cron routine scheduler and SQLite store."""

    def test_bva14_01_invalid_field_count(self):
        """Verifies that cron expressions with != 5 fields are rejected."""
        invalid_counts = [
            "* * * *",        # 4 fields
            "* * * * * *",    # 6 fields
            "",               # 0 fields
        ]
        for expr in invalid_counts:
            with self.assertRaises(ValueError):
                CronParser.validate_expression(expr)

    def test_bva14_02_out_of_bounds_fields(self):
        """Verifies out-of-bounds field value rejection."""
        out_of_bounds = [
            "60 * * * *",     # Minute 60 (max 59)
            "* 24 * * *",     # Hour 24 (max 23)
            "* * 32 * *",     # Day 32 (max 31)
            "* * * 13 *",     # Month 13 (max 12)
            "* * * * 8",      # Dow 8 (max 7)
        ]
        for expr in out_of_bounds:
            with self.assertRaises(ValueError):
                CronParser.validate_expression(expr)

    def test_bva14_03_zero_or_negative_step(self):
        """Verifies that step values <= 0 raise ValueError."""
        with self.assertRaises(ValueError):
            CronParser.validate_expression("*/0 * * * *")
        with self.assertRaises(ValueError):
            CronParser.validate_expression("*/-5 * * * *")

    def test_bva14_04_inverted_range(self):
        """Verifies that inverted ranges (e.g. 10-5) raise ValueError."""
        with self.assertRaises(ValueError):
            CronParser.validate_expression("10-5 * * * *")

    def test_bva14_05_empty_routine_id(self):
        """Verifies that an empty routine ID raises ValueError."""
        with self.assertRaises(ValueError):
            job = RoutineJob(id="", name="Empty ID Job", cron_expr="* * * * *", action_payload="{}")
            job.validate()


if __name__ == "__main__":
    unittest.main()
