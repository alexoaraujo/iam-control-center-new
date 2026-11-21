#!/usr/bin/env python3
"""Fail-closed GitHub admin bootstrap for ONE disposable G1 revoker environment.

Requires a separately authenticated gh CLI actor with repository Administration
write; never accepts or uploads database credentials. --apply changes only the
GitHub environment, its main-only deployment policy and non-secret variables.
PR SHA is NOT executable on main, so approved SHA is deliberately invalidated.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
import sys

REPO = "alexoaraujo/iam-control-center-new"
ENV = "IAM-G1-Disposable-Lease-Revocation"
MAINTAINER = "alexoaraujo"
PROJECT = "tiny-rice-70320263"
BRANCH = "br-spring-grass-b6gap6kp"
HOST = "ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech"
EXPIRES = "2026-11-16T12:00:00Z"
CONFIRM = "CONFIGURE_G1_ENV_ONLY_NO_SECRETS"
BLOCKED_SHA = "BLOCKED_UNTIL_MAINTAINER_SHA_RECORDED"
BASE = f"repos/{REPO}/environments/{ENV}"
VARIABLES = {
    "IAM_G1_DISPOSABLE_PROJECT_ID": PROJECT,
    "IAM_G1_DISPOSABLE_BRANCH_ID": BRANCH,
    "IAM_G1_DISPOSABLE_REVOKER_APPROVED_SHA": BLOCKED_SHA,
}


class Blocked(RuntimeError):
    pass


def gh(args: list[str], data: dict | None = None) -> object:
    cmd = ["gh", *args]
    if data is not None:
        cmd += ["--input", "-"]
    try:
        result = subprocess.run(
            cmd, input=json.dumps(data) if data is not None else None,
            text=True, capture_output=True, check=False, timeout=35,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked("GH_CLI_NOT_AVAILABLE_OR_TIMEOUT") from exc
    if result.returncode != 0:
        # No subprocess stderr: it may include internal repository URLs or auth data.
        raise Blocked("GITHUB_ADMIN_API_DENIED_OR_INVALID_RESPONSE")
    if args[:1] == ["api"]:
        try:
            return json.loads(result.stdout)
        except (ValueError, TypeError) as exc:
            raise Blocked("GITHUB_ADMIN_API_NOT_JSON") from exc
    return result.stdout.strip()


def expected_environment(actual: dict) -> bool:
    branch_policy = actual.get("deployment_branch_policy") or {}
    if (actual.get("name") != ENV
            or actual.get("can_admins_bypass") is not False
            or branch_policy.get("protected_branches") is not False
            or branch_policy.get("custom_branch_policies") is not True):
        return False
    return not any(
        rule.get("type") == "required_reviewers"
        for rule in actual.get("protection_rules", [])
    )


def expected_policies(payload: dict) -> bool:
    policies = payload.get("branch_policies", [])
    return (payload.get("total_count") == 1 and len(policies) == 1
            and policies[0].get("name") == "main"
            and policies[0].get("type", "branch") == "branch")


def read_protection() -> None:
    environment = gh(["api", BASE])
    policies = gh(["api", BASE + "/deployment-branch-policies"])
    if not isinstance(environment, dict) or not expected_environment(environment):
        raise Blocked("ENV_SINGLE_MAINTAINER_POLICY_OR_ADMIN_BYPASS_INVALID")
    if not isinstance(policies, dict) or not expected_policies(policies):
        raise Blocked("ENV_MISSING_EXCLUSIVE_MAIN_POLICY")
    print("PASS_G1_GITHUB_ENV_SINGLE_MAINTAINER_NO_REVIEWERS_MAIN_ONLY")


def branch_not_expired() -> None:
    expiry = dt.datetime.fromisoformat(EXPIRES.replace("Z", "+00:00"))
    if dt.datetime.now(dt.timezone.utc) >= expiry:
        raise Blocked("G1_DISPOSABLE_BRANCH_TTL_EXPIRED")


def apply_environment() -> None:
    branch_not_expired()
    repo = gh(["api", f"repos/{REPO}"])
    actor = gh(["api", "user"])
    permission = gh(["api", f"repos/{REPO}/collaborators/{MAINTAINER}/permission"])
    if (not isinstance(repo, dict)
            or repo.get("private") is not False
            or repo.get("default_branch") != "main"
            or not isinstance(actor, dict)
            or actor.get("login") != MAINTAINER
            or not isinstance(actor.get("id"), int)
            or not isinstance(permission, dict)
            or permission.get("permission") != "admin"):
        raise Blocked("GITHUB_SINGLE_MAINTAINER_ADMIN_PRECONDITION")
    body = {
        "wait_timer": 0,
        "prevent_self_review": False,
        "can_admins_bypass": False,
        "reviewers": [],
        "deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": True
        },
    }
    gh(["api", "--method", "PUT", BASE], body)
    policies = gh(["api", BASE + "/deployment-branch-policies"])
    if not isinstance(policies, dict):
        raise Blocked("UNREADABLE_DEPLOYMENT_POLICY")
    existing = policies.get("branch_policies", [])
    if not existing:
        gh(["api", "--method", "POST",
            BASE + "/deployment-branch-policies"], {"name": "main", "type": "branch"})
    elif not expected_policies(policies):
        raise Blocked("UNEXPECTED_EXISTING_BRANCH_POLICIES_MANUAL_REVIEW")
    read_protection()
    # Intentionally deny the job until the maintainer records an exact SHA on main.
    for name, value in VARIABLES.items():
        gh(["variable", "set", name, "--repo", REPO, "--env", ENV, "--body", value])
    print("PASS_G1_PUBLIC_ENV_AND_NON_SECRET_VARS_CONFIGURED")
    print("BLOCKED_G1_ADMIN_SECRET_AND_MAIN_SHA_NOT_ACTIVATED")


def verify_non_secret_vars() -> None:
    data = gh(["variable", "list", "--repo", REPO, "--env", ENV, "--json", "name,value"])
    try:
        items = json.loads(data) if isinstance(data, str) else data
    except ValueError as exc:
        raise Blocked("VARIABLES_NOT_JSON") from exc
    if not isinstance(items, list):
        raise Blocked("ENV_VARIABLES_NOT_ACCESSIBLE")
    found = {item.get("name"): item.get("value") for item in items}
    for name, value in VARIABLES.items():
        if found.get(name) != value:
            raise Blocked("G1_VARIABLE_NOT_AT_EXPECTED_SAFE_VALUE_" + name)
    print("PASS_G1_ENV_NON_SECRET_VARIABLES_FAIL_CLOSED")
    print(f"NEON_CONTROL_PLANE_ATTESTATION_EXTERNAL: {PROJECT}/{BRANCH}/{HOST}")
    print("BLOCKED_G1_DB_SECRETS_AND_APPROVED_MAIN_SHA_PENDING")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("plan", "apply", "verify"), default="plan")
    p.add_argument("--confirm", default="")
    args = p.parse_args()
    try:
        if args.mode == "plan":
            print(f"PLAN_G1: repo={REPO} env={ENV} maintainer={MAINTAINER} branch=main")
            print(f"PLAN_G1: neon_project={PROJECT} neon_branch={BRANCH} ttl={EXPIRES}")
            print("PLAN_G1: no Neon SQL, no database secrets, no live revoker activation")
            return 0
        if args.mode == "apply":
            if args.confirm != CONFIRM:
                raise Blocked("EXPLICIT_GITHUB_ONLY_CONFIRMATION_MISSING")
            apply_environment()
        read_protection()
        verify_non_secret_vars()
        return 0
    except Blocked as exc:
        print("BLOCKED_G1_GITHUB_ENV_BOOTSTRAP: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
