#!/usr/bin/env python3
"""Admin-only, local hardening of an EXISTING PR128 G3 GitHub Environment.

Never creates Environments, handles owner secrets, executes G3, or writes Neon.
Usage:
    python3 .github/scripts/iam-g3-environment-bootstrap.py --mode plan
    python3 .github/scripts/iam-g3-environment-bootstrap.py --mode verify
    python3 .github/scripts/iam-g3-environment-bootstrap.py --mode apply \
      --confirm HARDEN_EXISTING_G3_ENV_NO_SECRETS
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

REPOSITORY = "alexoaraujo/iam-control-center-new"
MAINTAINER = "alexoaraujo"
ENVIRONMENT = "IAM-G3-PR128-Disposable-RBAC"
PR_REF = "refs/pull/128/merge"
CONFIRMATION = "HARDEN_EXISTING_G3_ENV_NO_SECRETS"
BASE = f"repos/{REPOSITORY}/environments/{ENVIRONMENT}"
POLICY_PATH = BASE + "/deployment-branch-policies?per_page=100"
CUSTOM_PATH = BASE + "/deployment_protection_rules"


class GateBlocked(RuntimeError):
    pass


def gh_json(*args: str, payload: dict | None = None):
    command = ["gh", "api", *args]
    if payload is not None:
        command += ["--input", "-"]
    try:
        response = subprocess.run(
            command, input=json.dumps(payload) if payload is not None else None,
            text=True, capture_output=True, check=False, timeout=35,
            env={**os.environ, "GH_PAGER": "cat"},
        )
    except (OSError, subprocess.TimeoutExpired):
        raise GateBlocked("GH_CLI_NOT_AVAILABLE_OR_TIMED_OUT") from None
    if response.returncode:
        # Deliberately do not echo stderr/stdout: never leak auth headers.
        raise GateBlocked("GITHUB_ADMIN_API_DENIED_OR_UNAVAILABLE")
    try:
        return json.loads(response.stdout)
    except (ValueError, TypeError):
        raise GateBlocked("GITHUB_ADMIN_API_INVALID_JSON") from None


def assert_admin():
    repository = gh_json(f"repos/{REPOSITORY}")
    actor = gh_json("user")
    permission = gh_json(
        f"repos/{REPOSITORY}/collaborators/{MAINTAINER}/permission"
    )
    if (not isinstance(repository, dict)
        or repository.get("full_name") != REPOSITORY
        or repository.get("default_branch") != "main"
        or not isinstance(actor, dict)
        or actor.get("login") != MAINTAINER
        or not isinstance(permission, dict)
        or permission.get("permission") != "admin"):
        raise GateBlocked("REPOSITORY_OR_ADMIN_ACTOR_MISMATCH")


def existing_environment():
    item = gh_json(BASE)
    if not isinstance(item, dict) or item.get("name") != ENVIRONMENT:
        raise GateBlocked("EXISTING_G3_ENVIRONMENT_NOT_FOUND")
    return item


def policies_exact(payload):
    if not isinstance(payload, dict):
        return False
    items = payload.get("branch_policies")
    return (payload.get("total_count") == 1
            and isinstance(items, list) and len(items) == 1
            and isinstance(items[0], dict)
            and items[0].get("name") == PR_REF
            and items[0].get("type") == "branch")


def policies_empty(payload):
    return (isinstance(payload, dict)
            and payload.get("total_count") == 0
            and payload.get("branch_policies") == [])


def assert_environment(metadata, policies, custom):
    if not isinstance(metadata, dict) or metadata.get("name") != ENVIRONMENT:
        raise GateBlocked("G3_ENV_IDENTITY_NOT_VERIFIED")
    bp = metadata.get("deployment_branch_policy")
    if (metadata.get("can_admins_bypass") is not False
        or not isinstance(bp, dict)
        or bp.get("protected_branches") is not False
        or bp.get("custom_branch_policies") is not True):
        raise GateBlocked("G3_ADMIN_BYPASS_OR_BRANCH_MODE_INVALID")
    rules = metadata.get("protection_rules")
    if (not isinstance(rules, list)
        or not any(isinstance(x, dict) and x.get("type") == "branch_policy"
                   for x in rules)
        or any(not isinstance(x, dict) or x.get("type") not in
               ("branch_policy", "wait_timer") for x in rules)
        or any(x.get("type") == "wait_timer" and x.get("wait_timer") != 0
               for x in rules)):
        raise GateBlocked("G3_ENV_PROTECTION_RULES_INVALID")
    if not policies_exact(policies):
        raise GateBlocked("G3_EXACT_PR128_BRANCH_REF_NOT_PROVEN")
    if (not isinstance(custom, dict) or custom.get("total_count") != 0
        or custom.get("custom_deployment_protection_rules") != []):
        raise GateBlocked("G3_UNKNOWN_CUSTOM_DEPLOYMENT_RULE")
    return True


def verify():
    metadata = existing_environment()
    policies = gh_json(POLICY_PATH)
    custom = gh_json(CUSTOM_PATH)
    assert_environment(metadata, policies, custom)
    print("PASS_G3_ADMIN_READBACK_EXISTING_ENV_ONLY")
    print("PASS_G3_ADMIN_BYPASS_DISABLED_AND_EXACT_PR128_REF")
    print("G3_OWNER_SECRET=NOT_READ_NOT_PROVISIONED")
    print("G3_POSITIVE_HTTP=NOT_RUN")


def apply():
    if os.environ.get("GITHUB_ACTIONS") == "true" or not sys.stdin.isatty():
        raise GateBlocked("LOCAL_INTERACTIVE_ADMIN_TERMINAL_REQUIRED")
    assert_admin()
    before = existing_environment()  # Fail closed: NEVER auto-create Environment.
    rules = before.get("protection_rules")
    if not isinstance(rules, list) or any(
        not isinstance(rule, dict) or rule.get("type") not in
        ("branch_policy", "wait_timer") for rule in rules
    ):
        raise GateBlocked("EXISTING_UNEXPECTED_PROTECTION_RULES")
    if any(rule.get("type") == "wait_timer" and rule.get("wait_timer") != 0
           for rule in rules):
        raise GateBlocked("EXISTING_WAIT_TIMER_REQUIRES_REVIEW")
    mode = before.get("deployment_branch_policy")
    if isinstance(mode, dict) and mode.get("custom_branch_policies") is True:
        current = gh_json(POLICY_PATH)
        if not (policies_empty(current) or policies_exact(current)):
            raise GateBlocked("EXISTING_BRANCH_RULES_NOT_SAFE_TO_REPLACE")
    # Never reference this environment via a workflow merely to create it.
    payload = {
        "wait_timer": 0,
        "prevent_self_review": False,
        "can_admins_bypass": False,
        "reviewers": [],
        "deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": True
        },
    }
    updated = gh_json("-X", "PUT", BASE, payload=payload)
    if not isinstance(updated, dict) or updated.get("name") != ENVIRONMENT:
        raise GateBlocked("G3_ENV_UPDATE_NOT_CONFIRMED")
    current = gh_json(POLICY_PATH)
    if policies_empty(current):
        added = gh_json(
            "-X", "POST", BASE + "/deployment-branch-policies",
            payload={"name": PR_REF, "type": "branch"},
        )
        if not isinstance(added, dict) or added.get("name") != PR_REF:
            raise GateBlocked("G3_PR128_BRANCH_RULE_CREATE_NOT_CONFIRMED")
    elif not policies_exact(current):
        raise GateBlocked("G3_EXISTING_BRANCH_RULES_UNEXPECTED")
    verify()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("plan", "apply", "verify"),
                        default="plan")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()
    try:
        if args.mode == "plan":
            print(f"PLAN_G3_HARDEN_EXISTING_ONLY {REPOSITORY} {ENVIRONMENT}")
            print(f"PLAN_G3_ONLY_DEPLOYMENT_REF {PR_REF}")
            print("PLAN_G3_NO_SECRETS_NO_NEON_NO_WORKFLOW_DISPATCH")
            return 0
        if args.mode == "apply":
            if args.confirm != CONFIRMATION:
                raise GateBlocked("EXPLICIT_CONFIRMATION_NOT_PROVIDED")
            apply()
        else:
            verify()
        return 0
    except GateBlocked as exc:
        print("BLOCKED_G3_GITHUB_ENV_BOOTSTRAP " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
