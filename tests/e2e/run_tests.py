#!/usr/bin/env python3
"""
Frostfire E2E Test Runner
Unified test runner for Tiers 1-4 opaque-box end-to-end testing.

Usage:
    python tests/e2e/run_tests.py
    python tests/e2e/run_tests.py --tier 1
    python tests/e2e/run_tests.py --tier 4 -v
    python tests/e2e/run_tests.py --json-report test_report.json
"""

import sys
import os
import argparse
import time
import json
import unittest
from pathlib import Path
from typing import Dict, Any, List

# Ensure repository root is on sys.path
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


class CustomTextTestResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.test_records = []

    def startTest(self, test):
        self._start_time = time.time()
        super().startTest(test)

    def addSuccess(self, test):
        super().addSuccess(test)
        elapsed = time.time() - self._start_time
        self.test_records.append({
            "test": str(test),
            "status": "PASS",
            "elapsed_sec": elapsed,
            "error": None,
        })

    def addFailure(self, test, err):
        super().addFailure(test, err)
        elapsed = time.time() - self._start_time
        self.test_records.append({
            "test": str(test),
            "status": "FAIL",
            "elapsed_sec": elapsed,
            "error": self._exc_info_to_string(err, test),
        })

    def addError(self, test, err):
        super().addError(test, err)
        elapsed = time.time() - self._start_time
        self.test_records.append({
            "test": str(test),
            "status": "ERROR",
            "elapsed_sec": elapsed,
            "error": self._exc_info_to_string(err, test),
        })

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.test_records.append({
            "test": str(test),
            "status": "SKIP",
            "elapsed_sec": 0.0,
            "reason": reason,
        })


def run_tier(tier_name: str, tier_dir: Path, pattern: str = "test_*.py", verbose: bool = False):
    loader = unittest.TestLoader()
    suite = loader.discover(start_dir=str(tier_dir), pattern=pattern, top_level_dir=str(REPO_ROOT))
    stream = sys.stdout if verbose else open(os.devnull, "w")
    runner = unittest.TextTestRunner(stream=stream, verbosity=2 if verbose else 1, resultclass=CustomTextTestResult)
    start_time = time.time()
    result = runner.run(suite)
    duration = time.time() - start_time
    return result, duration


def main():
    parser = argparse.ArgumentParser(description="Frostfire E2E Test Runner (Tiers 1-4)")
    parser.add_argument(
        "--tier",
        "-t",
        choices=["1", "2", "3", "4", "all"],
        default="all",
        help="Test tier to execute (1, 2, 3, 4, or all)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose test output per test case",
    )
    parser.add_argument(
        "--json-report",
        type=str,
        default=None,
        help="File path to write JSON test execution report",
    )
    args = parser.parse_args()

    e2e_dir = Path(__file__).resolve().parent
    tiers_to_run = []
    if args.tier in ["1", "all"]:
        tiers_to_run.append(("Tier 1: Feature Coverage (75 tests)", e2e_dir / "tier1"))
    if args.tier in ["2", "all"]:
        tiers_to_run.append(("Tier 2: Boundary & Corner Cases (75 tests)", e2e_dir / "tier2"))
    if args.tier in ["3", "all"]:
        tiers_to_run.append(("Tier 3: Cross-Feature Combinations (15 tests)", e2e_dir / "tier3"))
    if args.tier in ["4", "all"]:
        tiers_to_run.append(("Tier 4: Real-World Scenarios (8 tests)", e2e_dir / "tier4"))

    print("=" * 80)
    print("           FROSTFIRE PRODUCTION E2E TEST SUITE (TIERS 1-4)")
    print(f"           Root: {REPO_ROOT}")
    print(f"           Mode: Opaque-Box Requirement Verification")
    print("=" * 80)

    total_tests = 0
    total_passed = 0
    total_failed = 0
    total_errors = 0
    total_skipped = 0
    total_duration = 0.0
    tier_summaries = []
    all_records = []

    overall_start = time.time()

    for tier_label, tier_path in tiers_to_run:
        print(f"\n[RUNNING] {tier_label}...")
        result, duration = run_tier(tier_label, tier_path, verbose=args.verbose)
        total_duration += duration

        tier_tests = result.testsRun
        tier_failures = len(result.failures)
        tier_errors = len(result.errors)
        tier_skipped = len(result.skipped)
        tier_passed = tier_tests - tier_failures - tier_errors - tier_skipped

        total_tests += tier_tests
        total_passed += tier_passed
        total_failed += tier_failures
        total_errors += tier_errors
        total_skipped += tier_skipped

        tier_summaries.append({
            "tier": tier_label,
            "tests": tier_tests,
            "passed": tier_passed,
            "failed": tier_failures,
            "errors": tier_errors,
            "skipped": tier_skipped,
            "duration_sec": round(duration, 3),
        })

        if hasattr(result, "test_records"):
            all_records.extend(result.test_records)

        status_flag = "PASSED" if (tier_failures == 0 and tier_errors == 0) else "FAILED"
        print(f"[DONE]    {tier_label}: {tier_passed}/{tier_tests} passed ({duration:.3f}s) - {status_flag}")

        # Print failures if any occurred
        if result.failures:
            for test, traceback in result.failures:
                print(f"\n[-] FAILURE in {test}:\n{traceback}")
        if result.errors:
            for test, traceback in result.errors:
                print(f"\n[!] ERROR in {test}:\n{traceback}")

    overall_elapsed = time.time() - overall_start

    print("\n" + "=" * 80)
    print("                          EXECUTION SUMMARY")
    print("=" * 80)
    print(f"{'Tier Name':<45} | {'Tests':<6} | {'Pass':<5} | {'Fail':<5} | {'Time'}")
    print("-" * 80)
    for s in tier_summaries:
        print(f"{s['tier']:<45} | {s['tests']:<6} | {s['passed']:<5} | {s['failed'] + s['errors']:<5} | {s['duration_sec']:.3f}s")
    print("-" * 80)
    print(f"{'TOTAL':<45} | {total_tests:<6} | {total_passed:<5} | {total_failed + total_errors:<5} | {overall_elapsed:.3f}s")
    print("=" * 80)

    if args.json_report:
        report_data = {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "total_tests": total_tests,
            "passed": total_passed,
            "failed": total_failed,
            "errors": total_errors,
            "skipped": total_skipped,
            "duration_sec": round(overall_elapsed, 3),
            "tier_summaries": tier_summaries,
            "test_records": all_records,
        }
        report_path = Path(args.json_report)
        report_path.write_text(json.dumps(report_data, indent=2), encoding="utf-8")
        print(f"JSON test execution report written to: {report_path.resolve()}")

    if total_failed > 0 or total_errors > 0:
        print("\n❌ SUITE RESULT: FAILED")
        sys.exit(1)
    else:
        print("\n✅ SUITE RESULT: ALL TESTS PASSED (0 FAILURES, 0 ERRORS)")
        sys.exit(0)


if __name__ == "__main__":
    main()
