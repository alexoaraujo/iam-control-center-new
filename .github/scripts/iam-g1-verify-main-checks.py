#!/usr/bin/env python3
"""Fail-closed verification of ALL pages of exact-main GitHub check runs.

Input is the array of REST page objects produced by:
  gh api --paginate --slurp "repos/OWNER/REPO/commits/SHA/check-runs?per_page=100"

No secret, GitHub credential, token, or network access is used here.
"""
from __future__ import annotations

import json
import re
import sys

REPO = "alexoaraujo/iam-control-center-new"
REQUIRED = frozenset((
    "quality",
    "pg18-security-contracts",
    "g1-real-restore-offline-contract",
))
MAX_BYTES = 8 * 1024 * 1024
MAX_PAGES = 50
MAX_CHECKS = 5000
JOB_URL = re.compile(
    r"^https://github\.com/alexoaraujo/iam-control-center-new/"
    r"actions/runs/[1-9][0-9]*/job/[1-9][0-9]*$"
)
SHA = re.compile(r"^[a-f0-9]{40}$")


class GateBlocked(Exception):
    """Do not echo raw API payloads or exception data into workflow logs."""


def verify_paginated_main_checks(pages: object, sha: str) -> int:
    if not SHA.fullmatch(sha):
        raise GateBlocked("invalid exact approved main SHA")
    if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
        raise GateBlocked("missing or unbounded paginated response")

    runs = []
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
        runs.extend(listed)
        if len(runs) > MAX_CHECKS:
            raise GateBlocked("too many check runs")
    if not 1 <= total <= MAX_CHECKS or len(runs) != total:
        raise GateBlocked("incomplete or duplicated check-runs pages")

    found = set()
    for run in runs:
        if not isinstance(run, dict) or run.get("name") not in REQUIRED:
            continue
        app = run.get("app")
        if (
            run.get("head_sha") == sha
            and run.get("status") == "completed"
            and run.get("conclusion") == "success"
            and isinstance(app, dict)
            and app.get("slug") == "github-actions"
            and JOB_URL.fullmatch(run.get("details_url") or "")
        ):
            found.add(run["name"])
    if found != REQUIRED:
        raise GateBlocked("required exact-SHA trusted GitHub Actions checks not proven")
    return len(runs)


def main() -> int:
    if len(sys.argv) != 2:
        print("BLOCKED_G1_RESTORE_MAIN_CHECKS_ARGS", file=sys.stderr)
        return 2
    try:
        raw = sys.stdin.buffer.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES or not raw:
            raise GateBlocked("check-runs response missing or oversized")
        count = verify_paginated_main_checks(json.loads(raw), sys.argv[1])
    except (ValueError, TypeError, GateBlocked):
        print("BLOCKED_G1_RESTORE_MISSING_MAIN_GATES", file=sys.stderr)
        return 2
    print(f"PASS_G1_RESTORE_MAIN_SHA_AND_PG18_QUALITY_OFFLINE_CHECKS total_checks={count}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
