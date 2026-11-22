#!/usr/bin/env python3
"""Fail-closed verification of ALL pages of exact-main GitHub check runs.

Input is the array of REST page objects produced by:
  gh api --paginate --slurp "repos/OWNER/REPO/commits/SHA/check-runs?per_page=100"

Only the CLI mode reads trusted GitHub Actions run metadata through read-only GH_TOKEN.\nThe pure verification function accepts an injected metadata loader for offline tests.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys

REPO = "alexoaraujo/iam-control-center-new"
EXPECTED_WORKFLOWS = {
    "quality": ".github/workflows/quality.yml",
    "pg18-security-contracts": ".github/workflows/iam-required-security-gate.yml",
    "g1-real-restore-offline-contract":
        ".github/workflows/iam-g1-real-restore-offline-contract.yml",
}
REQUIRED = frozenset(EXPECTED_WORKFLOWS)
MAX_BYTES = 8 * 1024 * 1024
MAX_PAGES = 50
MAX_CHECKS = 5000
JOB_URL = re.compile(
    r"^https://github\.com/alexoaraujo/iam-control-center-new/"
    r"actions/runs/(?P<run>[1-9][0-9]*)/job/(?P<job>[1-9][0-9]*)$"
)
SHA = re.compile(r"^[a-f0-9]{40}$")


class GateBlocked(Exception):
    """Do not echo raw API payloads or exception data into workflow logs."""


def verify_paginated_main_checks(pages: object, sha: str, load_run) -> int:
    if not callable(load_run):
        raise GateBlocked("trusted workflow provenance loader missing")
    if not SHA.fullmatch(sha):
        raise GateBlocked("invalid exact approved main SHA")
    if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
        raise GateBlocked("missing or unbounded paginated response")

    runs = []
    seen_ids = set()
    total = None
    for index, page in enumerate(pages):
        if not isinstance(page, dict) or type(page.get("total_count")) is not int:
            raise GateBlocked("invalid response page metadata")
        listed = page.get("check_runs")
        if (not isinstance(listed, list) or not 1 <= len(listed) <= 100
                or (index < len(pages) - 1 and len(listed) != 100)):
            raise GateBlocked("invalid, incomplete or duplicate check-runs page")
        if total is None:
            total = page["total_count"]
        if page["total_count"] != total:
            raise GateBlocked("check-runs count changed during pagination")
        for check in listed:
            if (not isinstance(check, dict) or type(check.get("id")) is not int
                    or check["id"] <= 0 or check["id"] in seen_ids):
                raise GateBlocked("invalid or repeated check-run identity")
            seen_ids.add(check["id"])
        runs.extend(listed)
        if len(runs) > MAX_CHECKS:
            raise GateBlocked("too many check runs")
    if not 1 <= total <= MAX_CHECKS or len(runs) != total:
        raise GateBlocked("incomplete or duplicated check-runs pages")

    found = set()
    metadata_cache = {}
    for run in runs:
        if run.get("name") not in REQUIRED:
            continue
        app = run.get("app")
        url = run.get("details_url")
        match = JOB_URL.fullmatch(url) if isinstance(url, str) else None
        if (run.get("head_sha") != sha
                or run.get("status") != "completed"
                or run.get("conclusion") != "success"
                or not isinstance(app, dict)
                or app.get("slug") != "github-actions"
                or match is None
                or str(run["id"]) != match.group("job")):
            continue
        suite = run.get("check_suite")
        if not isinstance(suite, dict) or type(suite.get("id")) is not int:
            continue
        run_id = match.group("run")
        if run_id not in metadata_cache:
            try:
                metadata_cache[run_id] = load_run(run_id)
            except (OSError, ValueError, TypeError, subprocess.SubprocessError):
                raise GateBlocked("trusted workflow metadata unavailable") from None
        info = metadata_cache[run_id]
        if (not isinstance(info, dict)
                or info.get("head_sha") != sha
                or info.get("head_branch") != "main"
                or info.get("event") != "push"
                or info.get("status") != "completed"
                or info.get("conclusion") != "success"
                or info.get("path") != EXPECTED_WORKFLOWS[run["name"]]
                or (info.get("repository") or {}).get("full_name") != REPO
                or info.get("check_suite_id") != suite["id"]
                or str(info.get("id")) != run_id):
            continue
        found.add(run["name"])
    if found != REQUIRED:
        raise GateBlocked("required exact-SHA trusted GitHub Actions checks not proven")
    return len(runs)


def get_workflow_run(run_id: str) -> dict:
    """Read-only GitHub REST metadata; reject errors without printing API data."""
    if not re.fullmatch(r"[1-9][0-9]{0,19}", run_id):
        raise GateBlocked("invalid workflow run ID")
    result = subprocess.run(
        ["gh", "api", f"repos/{REPO}/actions/runs/{run_id}"],
        capture_output=True, check=False, timeout=20,
    )
    if result.returncode or len(result.stdout) > 1048576:
        raise GateBlocked("trusted workflow API read denied")
    return json.loads(result.stdout)


def main() -> int:
    if len(sys.argv) != 2:
        print("BLOCKED_G1_RESTORE_MAIN_CHECKS_ARGS", file=sys.stderr)
        return 2
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES or not raw:
            raise GateBlocked("check-runs response missing or oversized")
        count = verify_paginated_main_checks(json.loads(raw), sys.argv[1], get_workflow_run)
    except (ValueError, TypeError, GateBlocked, OSError, subprocess.SubprocessError):
        print("BLOCKED_G1_RESTORE_MISSING_MAIN_GATES", file=sys.stderr)
        return 2
    print(f"PASS_G1_RESTORE_MAIN_SHA_AND_PG18_QUALITY_OFFLINE_CHECKS total_checks={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
