#!/usr/bin/env python3
"""Local admin READ-ONLY attestation of PR128 G3 secret-name and approved SHA.

Never requests a secret's value. Never writes GitHub settings or connects to Neon.
Requires GitHub CLI authentication as the repository's single admin maintainer.
This attestation does not authorize a privileged G3 job or execute Playwright.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

REPO = "alexoaraujo/iam-control-center-new"
MAINTAINER = "alexoaraujo"
ENV = "IAM-G3-PR128-Disposable-RBAC"
SECRET = "NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL"
SHA_VAR = "IAM_RBAC_PR128_APPROVED_SHA"
PR_BRANCH = "integration/peos-single-maintainer-bun-20261117"
PR_NUMBER = 128
EXACT_REF = "refs/pull/128/merge"
BASE = f"repos/{REPO}/environments/{ENV}"
HEX_SHA = re.compile(r"[0-9a-f]{40}\Z")


class Blocked(RuntimeError):
    pass


def gh_api(path):
    """Return JSON from authenticated gh; never emit stderr/body on failure."""
    try:
        proc = subprocess.run(
            ["gh", "api", path],
            check=False, capture_output=True, text=True,
            timeout=25, env={**os.environ, "GH_PAGER": "cat"},
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("GH_ADMIN_CLI_UNAVAILABLE") from None
    if proc.returncode != 0:
        raise Blocked("GITHUB_ADMIN_READ_UNAVAILABLE") from None
    try:
        return json.loads(proc.stdout)
    except (ValueError, TypeError):
        raise Blocked("GITHUB_ADMIN_READ_NOT_JSON") from None


def exact_policy(info, policies, custom):
    if not isinstance(info, dict) or info.get("name") != ENV:
        raise Blocked("G3_ENVIRONMENT_NOT_ATTESTED")
    bp = info.get("deployment_branch_policy")
    if (info.get("can_admins_bypass") is not False
        or not isinstance(bp, dict)
        or bp.get("protected_branches") is not False
        or bp.get("custom_branch_policies") is not True):
        raise Blocked("G3_ENVIRONMENT_PROTECTION_NOT_ATTESTED")
    rules = info.get("protection_rules")
    if (not isinstance(rules, list)
        or not any(isinstance(r, dict) and r.get("type") == "branch_policy"
                   for r in rules)
        or any(not isinstance(r, dict) or r.get("type") not in
               ("branch_policy", "wait_timer") for r in rules)
        or any(r.get("type") == "wait_timer" and r.get("wait_timer") != 0
               for r in rules)):
        raise Blocked("G3_UNEXPECTED_PROTECTION_RULES")
    items = policies.get("branch_policies") if isinstance(policies, dict) else None
    if (not isinstance(items, list) or len(items) != 1
        or policies.get("total_count") != 1
        or not isinstance(items[0], dict)
        or items[0].get("name") != EXACT_REF
        or items[0].get("type") != "branch"):
        raise Blocked("G3_PR128_BRANCH_RESTRICTION_NOT_EXACT")
    if (not isinstance(custom, dict)
        or custom.get("total_count") != 0
        or custom.get("custom_deployment_protection_rules") != []):
        raise Blocked("G3_CUSTOM_DEPLOYMENT_RULES_NOT_ATTESTED")


def inspect(actor, perm, pr, info, policies, custom, metadata, variable):
    if (not isinstance(actor, dict) or actor.get("login") != MAINTAINER
        or not isinstance(perm, dict) or perm.get("permission") != "admin"):
        raise Blocked("GITHUB_SINGLE_MAINTAINER_ADMIN_NOT_VERIFIED")
    exact_policy(info, policies, custom)
    if (not isinstance(pr, dict) or pr.get("number") != PR_NUMBER
        or pr.get("state") != "open"
        or not isinstance(pr.get("head"), dict)
        or pr["head"].get("ref") != PR_BRANCH
        or not isinstance(pr["head"].get("repo"), dict)
        or pr["head"]["repo"].get("full_name") != REPO
        or not isinstance(pr.get("base"), dict)
        or pr["base"].get("ref") != "main"):
        raise Blocked("G3_PR128_SOURCE_OR_STATE_NOT_ATTESTED")
    current_sha = pr["head"].get("sha")
    if not isinstance(current_sha, str) or not HEX_SHA.fullmatch(current_sha):
        raise Blocked("G3_PR_HEAD_SHA_INVALID")
    if not isinstance(metadata, dict):
        raise Blocked("G3_SECRET_NAME_LIST_UNAVAILABLE")
    arr, count = metadata.get("secrets"), metadata.get("total_count")
    if (type(count) is not int or count > 100
        or not isinstance(arr, list) or len(arr) != count):
        raise Blocked("G3_SECRET_METADATA_INCOMPLETE")
    names = [entry.get("name") if isinstance(entry, dict) else None for entry in arr]
    if SECRET not in names:
        raise Blocked("G3_OWNER_SECRET_NAME_NOT_FOUND")
    if (not isinstance(variable, dict) or variable.get("name") != SHA_VAR):
        raise Blocked("G3_APPROVED_SHA_VARIABLE_MISSING")
    approved = variable.get("value")
    if (not isinstance(approved, str) or not HEX_SHA.fullmatch(approved)
        or approved != current_sha):
        raise Blocked("G3_APPROVED_SHA_NOT_EXACT_PR_HEAD")
    return current_sha, count


def run():
    # Deliberately never run privileged metadata inspection inside a PR job.
    if os.environ.get("GITHUB_ACTIONS") == "true":
        raise Blocked("G3_LOCAL_ADMIN_TERMINAL_ONLY")
    actor = gh_api("user")
    perm = gh_api(f"repos/{REPO}/collaborators/{MAINTAINER}/permission")
    pr = gh_api(f"repos/{REPO}/pulls/{PR_NUMBER}")
    info = gh_api(BASE)
    policies = gh_api(BASE + "/deployment-branch-policies?per_page=100")
    custom = gh_api(BASE + "/deployment_protection_rules")
    metadata = gh_api(BASE + "/secrets?per_page=100")
    variable = gh_api(BASE + "/variables/" + SHA_VAR)
    sha, number = inspect(actor, perm, pr, info, policies, custom, metadata, variable)
    # Do not print any secret names apart from the expected name, timestamps,
    # URL, raw API data or environment variables.
    print("PASS_G3_OWNER_SECRET_NAME_PRESENT_IN_PROTECTED_ENV")
    print("PASS_G3_APPROVED_SHA_EQUALS_CURRENT_PR_HEAD " + sha)
    print("G3_ENV_SECRET_COUNT=" + str(number))
    print("G3_OWNER_SECRET_VALUE_AND_NEON_ROLE_NOT_VERIFIED")
    print("G3_WORKFLOW_SOURCE_TRUST=NOT_ATTESTED")
    print("G3_POSITIVE_AUTH0_HTTP_200_403=NOT_RUN")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("plan", "verify"), default="plan")
    opts = p.parse_args()
    if opts.mode == "plan":
        print("PLAN_G3_ADMIN_METADATA_READONLY env=" + ENV + " pr=128")
        print("PLAN_G3_REQUIRES_SECRET_NAME=" + SECRET)
        print("PLAN_G3_REQUIRES_APPROVED_SHA_VARIABLE=" + SHA_VAR)
        print("PLAN_G3_NO_SECRETS_VALUES_NO_GITHUB_WRITES_NO_DATABASE")
        return 0
    try:
        run()
        return 0
    except Blocked as exc:
        print("BLOCKED_G3_OWNER_METADATA " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
