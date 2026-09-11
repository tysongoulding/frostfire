#!/usr/bin/env python3
"""
Frostfire Cloud Comprehensive E2E Test Suite Runner
Executes Tiers 1 through 4 opaque-box test suites covering all 32 features,
boundary cases, pairwise interactions, and end-to-end application scenarios.
"""

import argparse
import os
import sys
import time
import unittest
from pathlib import Path

# Add workspace root to sys.path so tests.* imports resolve
WORKSPACE_ROOT = Path(__file__).resolve().parent.parent
if str(WORKSPACE_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKSPACE_ROOT))

from tests.test_tier1_features import *
from tests.test_tier2_boundaries import *
from tests.test_tier3_interactions import *
from tests.test_tier4_scenarios import *


def build_tier_suite(tier_name: str) -> unittest.TestSuite:
    """Build a TestSuite for a specific test tier."""
    loader = unittest.TestLoader()
    suite = unittest.TestSuite()

    if tier_name in ["tier1", "all"]:
        from tests import test_tier1_features
        suite.addTests(loader.loadTestsFromModule(test_tier1_features))

    if tier_name in ["tier2", "all"]:
        from tests import test_tier2_boundaries
        suite.addTests(loader.loadTestsFromModule(test_tier2_boundaries))

    if tier_name in ["tier3", "all"]:
        from tests import test_tier3_interactions
        suite.addTests(loader.loadTestsFromModule(test_tier3_interactions))

    if tier_name in ["tier4", "all"]:
        from tests import test_tier4_scenarios
        suite.addTests(loader.loadTestsFromModule(test_tier4_scenarios))

    return suite


def main():
    parser = argparse.ArgumentParser(
        description="Frostfire Cloud Phase 1 E2E Test Suite Runner (Tiers 1-4)"
    )
    parser.add_argument(
        "--tier",
        choices=["1", "2", "3", "4", "all"],
        default="all",
        help="Specific test tier to run (default: all)",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose test reporting",
    )
    args = parser.parse_args()

    tier_map = {
        "1": "tier1",
        "2": "tier2",
        "3": "tier3",
        "4": "tier4",
        "all": "all",
    }
    target_tier = tier_map[args.tier]

    print("=" * 70)
    print(">>> Frostfire Cloud Phase 1 E2E Test Suite Runner")
    print(f">>> Target Scope: {target_tier.upper()} (Tiers 1-4 Opaque-Box Suite)")
    print(f">>> Workspace:    {WORKSPACE_ROOT}")
    print("=" * 70)

    start_time = time.time()
    suite = build_tier_suite(target_tier)
    total_tests = suite.countTestCases()
    print(f">>> Discovered {total_tests} test cases across requested scope.")
    print("-" * 70)

    verbosity = 2 if args.verbose else 1
    runner = unittest.TextTestRunner(verbosity=verbosity)
    result = runner.run(suite)
    elapsed = time.time() - start_time

    print("=" * 70)
    print(">>> Test Run Summary")
    print(f"Total Tests Executed: {result.testsRun}")
    print(f"Passed:               {result.testsRun - len(result.failures) - len(result.errors)}")
    print(f"Failures:             {len(result.failures)}")
    print(f"Errors:               {len(result.errors)}")
    print(f"Elapsed Time:         {elapsed:.3f} seconds")
    print("=" * 70)

    if result.wasSuccessful():
        print(">>> ALL TESTS PASSED! [EXIT 0]")
        return 0
    else:
        print(">>> SOME TESTS FAILED! [EXIT 1]")
        return 1


if __name__ == "__main__":
    sys.exit(main())
