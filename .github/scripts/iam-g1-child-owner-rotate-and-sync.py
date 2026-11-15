#!/usr/bin/env python3
"""Rotate ONLY disposable child neondb_owner and sync one protected GitHub secret.

Run on a trusted administrator workstation with NEON_API_KEY, authenticated gh,
and PostgreSQL 18 psql. Secrets never enter process arguments, files or logs.
No grants, revocations, migrations, production changes, or workflow dispatch.
If GitHub sync fails after rotation, run --mode sync-only when access returns.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

REPO = "alexoaraujo/iam-control-center-new"
ENV = "IAM-G1-Disposable-Lease-Revocation"
SECRET = "IAM_G1_DISPOSABLE_REVOKER_URL"
PROJECT = "tiny-rice-70320263"
CHILD = "br-spring-grass-b6gap6kp"
PARENT = "br-ancient-term-b6mmx5ol"
ROLE = "neondb_owner"
DATABASE = "iam_database"
HOST = "ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech"
EXPIRES = dt.datetime(2026, 11, 16, 12, 0, tzinfo=dt.timezone.utc)
NEON_API = "https://console.neon.tech/api/v2"
CONFIRM = "ROTATE_G1_DISPOSABLE_CHILD_AND_SYNC_SECRET_ONLY"


class Blocked(RuntimeError):
    pass


def gh(args: list[str], *, stdin: str | None = None) -> str:
    try:
        p = subprocess.run(
            ["gh", *args], input=stdin, capture_output=True, text=True,
            check=False, timeout=40,
            env={k: v for k, v in os.environ.items() if k not in
                 ("PGPASSWORD", "IAM_G1_DISPOSABLE_REVOKER_URL")},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked("GITHUB_CLI_NOT_AVAILABLE") from exc
    # The CLI output may accidentally include secrets; never forward failures.
    if p.returncode:
        raise Blocked("GITHUB_API_OR_SECRET_SYNC_DENIED")
    return p.stdout.strip()


def gh_json(args: list[str]) -> dict:
    try:
        result = json.loads(gh(["api", *args]))
    except (ValueError, TypeError) as exc:
        raise Blocked("GITHUB_API_RESPONSE_NOT_JSON") from exc
    if not isinstance(result, dict):
        raise Blocked("GITHUB_API_RESPONSE_NOT_OBJECT")
    return result


def neon(method: str, path: str, key: str) -> dict:
    req = Request(NEON_API + path, method=method, headers={
        "Authorization": "Bearer " + key,
        "Accept": "application/json",
        "User-Agent": "iam-g1-disposable-rotate-sync",
    })
    try:
        with urlopen(req, timeout=25) as res:
            result = json.loads(res.read(1024 * 1024).decode("utf-8"))
    except (HTTPError, URLError, ValueError, OSError) as exc:
        # Never print HTTP bodies, headers, Neon key or returned password.
        raise Blocked("NEON_API_REQUEST_DENIED_OR_UNAVAILABLE") from None
    if not isinstance(result, dict):
        raise Blocked("NEON_API_RESPONSE_NOT_OBJECT")
    return result


def neon_branch(key: str, branch_id: str) -> dict:
    payload = neon("GET", f"/projects/{PROJECT}/branches/{branch_id}", key)
    branch = payload.get("branch")
    if not isinstance(branch, dict):
        raise Blocked("NEON_BRANCH_RESPONSE_INVALID")
    return branch


def preflight(key: str) -> None:
    if dt.datetime.now(dt.timezone.utc) >= EXPIRES - dt.timedelta(minutes=15):
        raise Blocked("CHILD_BRANCH_EXPIRING_OR_EXPIRED")
    if not shutil.which("gh") or not shutil.which("psql"):
        raise Blocked("REQUIRED_GH_OR_PSQL_CLIENT_MISSING")
    # libpq sslrootcert=system is supported by PostgreSQL 18.
    try:
        p = subprocess.run(["psql", "--version"], capture_output=True, text=True,
                           timeout=5, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Blocked("PSQL18_NOT_AVAILABLE") from exc
    if p.returncode or not p.stdout.startswith("psql (PostgreSQL) 18."):
        raise Blocked("PSQL18_REQUIRED_FOR_SYSTEM_CA")
    repo = gh_json([f"repos/{REPO}"])
    if (repo.get("default_branch") != "main"
            or not (repo.get("permissions") or {}).get("admin")):
        raise Blocked("GH_AUTHENTICATED_REPO_ADMIN_REQUIRED")
    actor = gh_json(["user"])
    if actor.get("login") != "alexoaraujo":
        raise Blocked("GH_OPERATOR_IDENTITY_MISMATCH")
    env = gh_json([f"repos/{REPO}/environments/{ENV}"])
    branch_guards = gh_json(
        [f"repos/{REPO}/environments/{ENV}/deployment-branch-policies"])
    custom_rules = gh_json(
        [f"repos/{REPO}/environments/{ENV}/deployment_protection_rules"])
    review_rules = [r for r in env.get("protection_rules", [])
                    if r.get("type") == "required_reviewers"]
    reviewers = (review_rules[0].get("reviewers", []) if len(review_rules) == 1 else [])
    policies = branch_guards.get("branch_policies", [])
    deployment = env.get("deployment_branch_policy") or {}
    if (env.get("can_admins_bypass") is not False
            or deployment.get("protected_branches") is not False
            or deployment.get("custom_branch_policies") is not True
            or len(review_rules) != 1
            or review_rules[0].get("prevent_self_review") is not True
            or len(reviewers) != 1
            or (reviewers[0].get("reviewer") or {}).get("login") != "alexoaraujo83"
            or not isinstance(policies, list)
            or branch_guards.get("total_count") != 1
            or len(policies) != 1 or policies[0].get("name") != "main"
            or policies[0].get("type") != "branch"
            or custom_rules.get("total_count") != 0
            or custom_rules.get("custom_deployment_protection_rules") != []):
        raise Blocked("REVOCATION_GITHUB_ENVIRONMENT_NOT_PROTECTED")
    secrets = gh_json(["-X", "GET",
                       f"repos/{REPO}/environments/{ENV}/secrets"])
    if SECRET not in [s.get("name") for s in secrets.get("secrets", [])]:
        raise Blocked("EXISTING_REVOCATION_SECRET_MISSING")
    branch = neon_branch(key, CHILD)
    parent = neon_branch(key, PARENT)
    expiry = branch.get("expires_at")
    if (branch.get("id") != CHILD or branch.get("project_id") != PROJECT
            or branch.get("parent_id") != PARENT
            or branch.get("default") is not False
            or branch.get("protected") is not False
            or branch.get("current_state") != "ready"
            or expiry != "2026-11-16T12:00:00Z"
            or parent.get("id") != PARENT
            or parent.get("name") != "development"):
        raise Blocked("NEON_CHILD_PARENT_IDENTITY_OR_TTL_MISMATCH")
    print("PASS_G1_CHILD_ONLY_GITHUB_NEON_PREFLIGHT_NO_SECRETS")


def obtain_password(key: str, mode: str) -> str:
    endpoint = (f"/projects/{PROJECT}/branches/{CHILD}/roles/{ROLE}")
    if mode == "rotate":
        result = neon("POST", endpoint + "/reset_password", key)
        role = result.get("role") or {}
        password = role.get("password")
    else:
        result = neon("GET", endpoint + "/reveal_password", key)
        password = result.get("password")
    if not isinstance(password, str) or len(password) < 16:
        raise Blocked("NEW_CHILD_PASSWORD_UNAVAILABLE")
    return password


def connection_url(password: str) -> str:
    encoded = quote(password, safe="")
    return (f"postgresql://{ROLE}:{encoded}@{HOST}:5432/{DATABASE}"
            "?sslmode=verify-full&sslrootcert=system")


def sync_secret(url: str) -> None:
    # stdin is encrypted locally by gh; no --body or shell interpolation.
    for attempt in range(1, 4):
        try:
            gh(["secret", "set", SECRET, "--env", ENV, "--repo", REPO],
               stdin=url)
            print("PASS_G1_GITHUB_ENV_SECRET_SYNCED_NO_VALUE_DISCLOSED")
            return
        except Blocked:
            if attempt == 3:
                raise Blocked("ROTATED_BUT_GITHUB_SYNC_FAILED_RUN_SYNC_ONLY")
            time.sleep(2)


def test_new_connection(password: str) -> None:
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/tmp"),
        "PGHOST": HOST, "PGPORT": "5432", "PGDATABASE": DATABASE,
        "PGUSER": ROLE, "PGPASSWORD": password,
        "PGSSLMODE": "verify-full", "PGSSLROOTCERT": "system",
        "PGCONNECT_TIMEOUT": "8", "PGOPTIONS": "-c statement_timeout=30000",
    }
    for attempt in range(6):
        try:
            result = subprocess.run(
                ["psql", "-X", "-w", "-At", "-v", "ON_ERROR_STOP=1",
                 "-c", "SELECT current_database(),current_user"],
                capture_output=True, text=True, env=env, timeout=25, check=False)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise Blocked("CHILD_CONNECTION_VERIFY_FAILED") from exc
        if result.returncode == 0 and result.stdout.strip() == f"{DATABASE}|{ROLE}":
            print("PASS_G1_CHILD_OWNER_NEW_CREDENTIAL_TLS_VERIFIED")
            return
        if attempt < 5:
            time.sleep(2)
    raise Blocked("CHILD_CONNECTION_VERIFY_FAILED_SECRET_ALREADY_UPDATED")


def execute(mode: str, confirm: str) -> None:
    if mode == "plan":
        print("PLAN_G1_CHILD_ONLY: " + PROJECT + "/" + CHILD + "/" + ROLE)
        print("PLAN_G1_GITHUB_ENV_SECRET_ONLY: " + ENV + "/" + SECRET)
        print("NO SQL GRANT/REVOKE; NO NEON PASSWORD RESET IN PLAN MODE")
        return
    if confirm != CONFIRM:
        raise Blocked("EXPLICIT_ROTATE_AND_SYNC_CONFIRMATION_REQUIRED")
    key = os.environ.get("NEON_API_KEY", "")
    if not key:
        raise Blocked("NEON_API_KEY_MISSING")
    preflight(key)  # All checks precede password-changing POST.
    password = obtain_password(key, mode)
    # If GitHub update fails, --mode sync-only recovers the latest child
    # password through Neon; NEVER start a second reset to recover.
    sync_secret(connection_url(password))
    test_new_connection(password)
    print("PASS_G1_CHILD_ONLY_ROTATE_AND_ENV_SYNC_NO_SECRET_DISCLOSURE"
          if mode == "rotate" else
          "PASS_G1_CHILD_SECRET_RECOVERY_SYNC_ONLY")
    print("NEXT_GATE_INDEPENDENT_REVOKER_PREFLIGHT_STILL_REQUIRED")


def main() -> int:
    args = argparse.ArgumentParser()
    args.add_argument("--mode", choices=["plan", "rotate", "sync-only"],
                      default="plan")
    args.add_argument("--confirm", default="")
    x = args.parse_args()
    try:
        execute(x.mode, x.confirm)
        return 0
    except Blocked as exc:
        print("BLOCKED_G1_ROTATE_SYNC: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
