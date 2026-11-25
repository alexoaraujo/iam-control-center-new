#!/usr/bin/env python3
"""Offline positive and negative contracts for paginated trusted main check provenance."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
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
IDENTITIES = {name: (123+i, 456+i, 789+i) for i, name in enumerate(REQUIRED)}


def fake_run(name, **changes):
    rid, job, suite = IDENTITIES[name]
    result = {
        "id": rid,
        "head_sha": SHA,
        "head_branch": "main",
        "event": "push",
        "status": "completed",
        "conclusion": "success",
        "path": gate.EXPECTED_WORKFLOWS[name],
        "check_suite_id": suite,
        "repository": {"full_name": gate.REPO},
    }
    result.update(changes)
    return result


def load_run(run_id):
    for name, (rid, _, _) in IDENTITIES.items():
        if str(rid) == run_id:
            return fake_run(name)
    raise AssertionError("Unexpected GH API read")


def check(name, *, sha=SHA, status="completed", conclusion="success",
          app="github-actions", url=None):
    rid, job, suite = IDENTITIES.get(name, (998, 999, 997))
    if url is None:
        url = f"https://github.com/{gate.REPO}/actions/runs/{rid}/job/{job}"
    return {
        "id": job,
        "name": name,
        "head_sha": sha,
        "status": status,
        "conclusion": conclusion,
        "app": {"slug": app},
        "details_url": url,
        "check_suite": {"id": suite},
    }


def pages(*, count=108, good_on_second=True):
    unrelated = [dict(check("unrelated-" + str(i)), id=10000+i)
                 for i in range(count - 3)]
    required = [check(n) for n in REQUIRED]
    records = unrelated + required if good_on_second else required + unrelated
    return [{"total_count": len(records), "check_runs": records[i:i+100]}
            for i in range(0, len(records), 100)]


class Contracts(unittest.TestCase):
    def verify(self, payload, sha=SHA, loader=load_run):
        return gate.verify_paginated_main_checks(payload, sha, loader)

    def test_108_checks_gate_passes_when_required_are_on_second_page(self):
        sample = pages()
        self.assertEqual(len(sample), 2)
        self.assertTrue(all(x["name"] not in gate.REQUIRED
                            for x in sample[0]["check_runs"]))
        self.assertEqual(self.verify(sample), 108)

    def test_single_page_and_multi_page_supported(self):
        sample = [check(n) for n in REQUIRED]
        self.assertEqual(self.verify([{"total_count": 3, "check_runs": sample}]), 3)
        self.assertEqual(self.verify(pages(count=208)), 208)

    def test_missing_or_repeated_page_fails_closed(self):
        sample = pages()
        for bad in [sample[:1], sample + [sample[1]],
                    [sample[0], sample[0]]]:
            with self.subTest(length=len(bad)), self.assertRaises(gate.GateBlocked):
                self.verify(bad)

    def test_second_page_check_mismatch_fails_closed(self):
        for key, value in [
            ("head_sha", OTHER), ("status", "queued"),
            ("conclusion", "skipped"), ("conclusion", "failure"),
            ("app", {"slug": "another-app"}),
            ("details_url", "https://example.invalid/job/1"),
            ("id", 56474), ("check_suite", {"id": 222222}),
        ]:
            with self.subTest(change=key), self.assertRaises(gate.GateBlocked):
                sample = pages()
                entry = next(x for x in sample[1]["check_runs"] if x["name"] == "quality")
                entry[key] = value
                self.verify(sample)

    def test_workflow_provenance_path_and_event_mismatches_block(self):
        for k, value in [
            ("head_sha", OTHER), ("head_branch", "development"),
            ("event", "pull_request"), ("status", "in_progress"),
            ("conclusion", "failure"),
            ("path", ".github/workflows/untrusted-workflow.yml"),
            ("repository", {"full_name": "attacker/iam-control-center-new"}),
            ("check_suite_id", 123456), ("id", 99999),
        ]:
            with self.subTest(field=k), self.assertRaises(gate.GateBlocked):
                def changed(run_id):
                    result = load_run(run_id)
                    if run_id == str(IDENTITIES["quality"][0]):
                        result[k] = value
                    return result
                self.verify(pages(), loader=changed)

    def test_missing_workflow_metadata_or_api_failure_fails_closed(self):
        for loader in [None, lambda _: {},
                       lambda _: (_ for _ in ()).throw(OSError("API unavailable"))]:
            with self.subTest(loader=str(loader)), self.assertRaises(gate.GateBlocked):
                self.verify(pages(), loader=loader)

    def test_wrong_sha_and_missing_pages_fail_closed(self):
        for bad in ("", "main", OTHER[:39], "x" * 40):
            with self.subTest(sha=bad), self.assertRaises(gate.GateBlocked):
                self.verify(pages(), sha=bad)
        sample = pages()
        for page in sample:
            for item in page["check_runs"]:
                if item["name"] in REQUIRED:
                    item["head_sha"] = OTHER
        with self.assertRaises(gate.GateBlocked):
            self.verify(sample)
        with self.assertRaises(gate.GateBlocked):
            self.verify([{"total_count": 0, "check_runs": []}] * 51)

    def test_corrupt_page_metadata_and_duplicate_ids_fail_closed(self):
        a = pages()
        for bad in [
            [], {}, [{"message": "unauthorized"}],
            [{"total_count": 101, "check_runs": []}],
            [{"total_count": 108, "check_runs": a[0]["check_runs"]},
             {"total_count": 109, "check_runs": a[1]["check_runs"]}],
            [{"total_count": 3, "check_runs": [check("quality")] * 3}],
            a + [{"total_count": 108, "check_runs": []}],
        ]:
            with self.subTest(type=type(bad).__name__), self.assertRaises(gate.GateBlocked):
                self.verify(bad)

    def test_cli_mock_gh_read_only_metadata(self):
        # Fake gh executable: no real credentials, tokens, network or restore actions.
        all_meta = {str(identity[0]): fake_run(name)
                    for name, identity in IDENTITIES.items()}
        with tempfile.TemporaryDirectory() as tmp:
            script = Path(tmp, "gh")
            script.write_text(
                "#!/usr/bin/env python3\n"
                "import json,sys\n"
                "data=" + repr(all_meta) + "\n"
                "key=sys.argv[-1].split('/')[-1]\n"
                "sys.stdout.write(json.dumps(data[key]))\n"
            )
            script.chmod(0o700)
            env = {**os.environ, "PATH": tmp + os.pathsep + os.environ.get("PATH", "")}
            ok = subprocess.run(
                [sys.executable, str(VERIFIER), SHA],
                input=json.dumps(pages()).encode(), capture_output=True, env=env, check=False,
            )
            self.assertEqual(ok.returncode, 0, ok.stderr)
            self.assertIn(b"total_checks=108", ok.stdout)
            bad = subprocess.run(
                [sys.executable, str(VERIFIER), SHA],
                input=json.dumps(pages()[:1]).encode(), capture_output=True,
                env=env, check=False,
            )
            self.assertEqual(bad.returncode, 2)
            self.assertIn(b"BLOCKED_G1_RESTORE_MISSING_MAIN_GATES", bad.stderr)
            self.assertNotIn(b"PASS_G1_", bad.stdout)

    def test_workflow_retains_exact_sha_and_protected_environment(self):
        s = WORKFLOW.read_text()
        for required in [
            "gh api --paginate --slurp", "check-runs?per_page=100",
            '.github/scripts/iam-g1-verify-main-checks.py "$GITHUB_SHA"',
            "BLOCKED_G1_RESTORE_MISSING_MAIN_GATES",
            '[[ "$APPROVED_MAIN_SHA" =~ ^[0-9a-f]{40}$',
            "IAM-G1-Full-Restore-Custody", "IAM-G1-B2-Full-Readback-Custody",
            "refs/heads/main", "RESTORE_G1_FULL_B2_TO_EXACT_DISPOSABLE_ONLY",
        ]:
            with self.subTest(required=required):
                self.assertIn(required, s)
        self.assertNotIn('checks="$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/check-runs?per_page=100")"', s)


if __name__ == "__main__":
    unittest.main(buffer=True)
