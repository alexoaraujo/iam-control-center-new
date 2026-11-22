#!/usr/bin/env python3
"""Negative and >100-check regression contracts for G1 trusted main preflight."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
VERIFIER = ROOT / ".github/scripts/iam-g1-verify-main-checks.py"
WORKFLOW = ROOT / ".github/workflows/iam-g1-b2-isolated-full-restore.yml"
spec = importlib.util.spec_from_file_location("g1_paginated_check_gate", VERIFIER)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
SHA = "a" * 40
OTHER = "b" * 40
REQUIRED = sorted(gate.REQUIRED)


def check(name, *, sha=SHA, status="completed", conclusion="success",
          app="github-actions", url=None):
    if url is None:
        url = "https://github.com/alexoaraujo/iam-control-center-new/actions/runs/123/job/456"
    return {
        "name": name,
        "head_sha": sha,
        "status": status,
        "conclusion": conclusion,
        "app": {"slug": app},
        "details_url": url,
    }


def pages(*, count=108, good_on_second=True):
    unrelated = [check("unrelated-" + str(i)) for i in range(count - 3)]
    required = [check(n) for n in REQUIRED]
    records = unrelated + required if good_on_second else required + unrelated
    return [{"total_count": len(records), "check_runs": records[i:i+100]}
            for i in range(0, len(records), 100)]


class Contracts(unittest.TestCase):
    def test_108_checks_gate_passes_when_all_required_are_on_second_page(self):
        page_set = pages()
        self.assertEqual(len(page_set), 2)
        self.assertTrue(all(x["name"] not in gate.REQUIRED
                            for x in page_set[0]["check_runs"]))
        self.assertEqual(gate.verify_paginated_main_checks(page_set, SHA), 108)

    def test_single_page_and_multi_page_both_supported(self):
        sample = [check(n) for n in REQUIRED]
        self.assertEqual(gate.verify_paginated_main_checks(
            [{"total_count": 3, "check_runs": sample}], SHA), 3)
        self.assertEqual(gate.verify_paginated_main_checks(pages(count=208), SHA), 208)

    def test_missing_later_page_is_fail_closed(self):
        sample = pages()
        with self.assertRaises(gate.GateBlocked):
            gate.verify_paginated_main_checks(sample[:1], SHA)

    def test_second_page_errors_never_count_as_success(self):
        for key, value in [
            ("head_sha", OTHER),
            ("status", "queued"),
            ("conclusion", "skipped"),
            ("conclusion", "failure"),
            ("app", {"slug": "other-app"}),
            ("details_url", "https://example.invalid/not-a-github-job"),
        ]:
            with self.subTest(change=key, value=value):
                sample = pages()
                item = next(x for x in sample[1]["check_runs"]
                            if x["name"] == "quality")
                item[key] = value
                with self.assertRaises(gate.GateBlocked):
                    gate.verify_paginated_main_checks(sample, SHA)

    def test_no_match_from_different_sha_even_with_all_checks_present(self):
        sample = pages()
        for page in sample:
            for item in page["check_runs"]:
                if item["name"] in gate.REQUIRED:
                    item["head_sha"] = OTHER
        with self.assertRaises(gate.GateBlocked):
            gate.verify_paginated_main_checks(sample, SHA)

    def test_incomplete_or_corrupt_page_metadata_fails_closed(self):
        variants = []
        original = pages()
        variants.append([])
        variants.append({})
        variants.append([{"message": "Bad credentials"}])
        variants.append([{"total_count": 101, "check_runs": []}])
        variants.append(original + [{"total_count": 108, "check_runs": []}])
        variants.append([{"total_count": 108, "check_runs": original[0]["check_runs"]},
                         {"total_count": 109, "check_runs": original[1]["check_runs"]}])
        variants.append([{"total_count": 3, "check_runs": [
            check(n) for n in REQUIRED for _ in range(2)]}])
        for bad in variants:
            with self.subTest(shape=type(bad).__name__), self.assertRaises(gate.GateBlocked):
                gate.verify_paginated_main_checks(bad, SHA)

    def test_reject_non_sha_and_too_many_pages(self):
        sample = pages()
        for bad in ("", "main", OTHER[:39], "x" * 40):
            with self.subTest(sha=bad), self.assertRaises(gate.GateBlocked):
                gate.verify_paginated_main_checks(sample, bad)
        with self.assertRaises(gate.GateBlocked):
            gate.verify_paginated_main_checks(
                [{"total_count": 0, "check_runs": []}] * 51, SHA)

    def test_cli_prints_pass_only_after_complete_pages(self):
        success = subprocess.run(
            [sys.executable, str(VERIFIER), SHA],
            input=json.dumps(pages()).encode(),
            capture_output=True, check=False,
        )
        self.assertEqual(success.returncode, 0)
        self.assertIn(b"total_checks=108", success.stdout)
        failed = subprocess.run(
            [sys.executable, str(VERIFIER), SHA],
            input=json.dumps(pages()[:1]).encode(),
            capture_output=True, check=False,
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertIn(b"BLOCKED_G1_RESTORE_MISSING_MAIN_GATES", failed.stderr)
        self.assertNotIn(b"PASS_G1_", failed.stdout)

    def test_workflow_uses_authenticated_all_page_api_without_bypass(self):
        s = WORKFLOW.read_text()
        self.assertIn('gh api --paginate --slurp', s)
        self.assertIn('check-runs?per_page=100', s)
        self.assertIn('.github/scripts/iam-g1-verify-main-checks.py "$GITHUB_SHA"', s)
        self.assertNotIn('checks="$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/check-runs?per_page=100")"', s)
        self.assertIn('BLOCKED_G1_RESTORE_MISSING_MAIN_GATES', s)
        self.assertIn('[[ "$APPROVED_MAIN_SHA" =~ ^[0-9a-f]{40}$', s)
        self.assertIn('IAM-G1-Full-Restore-Custody', s)
        self.assertIn('IAM-G1-B2-Full-Readback-Custody', s)
        self.assertIn('refs/heads/main', s)
        self.assertIn('RESTORE_G1_FULL_B2_TO_EXACT_DISPOSABLE_ONLY', s)


if __name__ == "__main__":
    unittest.main(buffer=True)
