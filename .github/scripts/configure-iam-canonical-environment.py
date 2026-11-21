#!/usr/bin/env python3
"""Configure a *protected* GitHub environment and store 3 Neon secrets via gh CLI.

Run locally with GitHub CLI authenticated as a repository administrator.
Never put connection strings in shell arguments, CI inputs, git, logs or issues.
This does not run a workflow, migrate schemas, or alter Neon databases.
"""
from __future__ import annotations

import getpass
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

REPOSITORY = "alexoaraujo/iam-control-center-new"
ENVIRONMENT = "IAM-Canonical-Isolated-Restore"
MAINTAINER = "alexoaraujo"
SECRET_NAMES = (
    "IAM_CANONICAL_SOURCE_URL",
    "IAM_CANONICAL_TARGET_URL",
    "IAM_CANONICAL_OPERATOR_APPROVAL",
)
APPROVAL_LATCH = "APPROVED_BR_SWEET_UNION_ONLY"
ENV_API = f"repos/{REPOSITORY}/environments/{ENVIRONMENT}"

def fail(message: str) -> None:
    raise RuntimeError(message)

def gh(*args: str, input_value: str | None = None) -> str:
    try:
        p = subprocess.run(
            ["gh", *args], input=input_value, capture_output=True, text=True,
            check=False, timeout=45, env={**os.environ, "GH_PAGER": "cat"},
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        fail("GitHub CLI missing or timed out: authenticate locally with gh auth login")
    if p.returncode != 0:
        # gh errors can include request bodies; redact by never echoing stderr.
        fail("GitHub API operation denied or failed; check admin authorization and API access")
    return p.stdout

def gh_json(*args: str, input_value: str | None = None):
    try:
        return json.loads(gh(*args, input_value=input_value))
    except json.JSONDecodeError as exc:
        raise RuntimeError("GitHub returned invalid JSON") from exc

def verify_account_and_repo() -> None:
    repo = gh_json("api", f"repos/{REPOSITORY}")
    if repo.get("default_branch") != "main" or repo.get("private") is not False:
        fail("expected public repository with main as default branch")
    actor = gh_json("api", "user")
    if actor.get("login") != MAINTAINER or not isinstance(actor.get("id"), int):
        fail("single-maintainer operator identity mismatch")
    permissions = gh_json(
        "api", f"repos/{REPOSITORY}/collaborators/{MAINTAINER}/permission"
    )
    if permissions.get("permission") != "admin":
        fail("single maintainer must have repository admin permission")


def verify_environment() -> None:
    info = gh_json("api", ENV_API)
    if info.get("name") != ENVIRONMENT:
        fail("environment identity mismatch")
    bp = info.get("deployment_branch_policy") or {}
    if bp.get("protected_branches") is not False or bp.get("custom_branch_policies") is not True:
        fail("environment branch policy is not custom-only")
    if info.get("can_admins_bypass") is not False:
        fail("administrator bypass must remain disabled")
    # Single-maintainer PEOS policy: no human required-reviewers gate.
    if any(rule.get("type") == "required_reviewers"
           for rule in info.get("protection_rules", [])):
        fail("mandatory independent reviewer still configured")
    policies = gh_json("api", f"{ENV_API}/deployment-branch-policies?per_page=100")
    actual = [(x.get("name"), x.get("type")) for x in policies.get("branch_policies", [])]
    if actual != [("main", "branch")]:
        fail("deployment branch policies must contain exactly one branch: main")


def ensure_protected_environment() -> None:
    payload = json.dumps({
        "wait_timer": 0,
        "prevent_self_review": False,
        "can_admins_bypass": False,
        "reviewers": [],
        "deployment_branch_policy": {
            "protected_branches": False,
            "custom_branch_policies": True
        }
    })
    gh_json("api", "-X", "PUT", ENV_API, "--input", "-", input_value=payload)
    policies = gh_json("api", f"{ENV_API}/deployment-branch-policies?per_page=100")
    existing = [(x.get("name"), x.get("type"))
                for x in policies.get("branch_policies", [])]
    if not existing:
        gh_json("api", "-X", "POST",
                f"{ENV_API}/deployment-branch-policies",
                "--input", "-",
                input_value=json.dumps({"name": "main", "type": "branch"}))
    elif existing != [("main", "branch")]:
        fail("unexpected branch policy; refusing to override")
    verify_environment()


def set_environment_secret(name: str, value: str) -> None:
    if name not in SECRET_NAMES or not value:
        fail("invalid secret name/value")
    # gh secret set encrypts locally. Its value comes from stdin, not CLI argv.
    gh("secret", "set", name, "--env", ENVIRONMENT,
       "--repo", REPOSITORY, input_value=value)

def verify_secret_metadata() -> None:
    rows = gh_json("api", f"{ENV_API}/secrets?per_page=100")
    present = {x.get("name") for x in rows.get("secrets", [])}
    missing = sorted(set(SECRET_NAMES) - present)
    if missing:
        fail("required environment secrets are missing: " + ", ".join(missing))

def guard_module():
    path = (Path(__file__).resolve().parents[2] / "database" / "scripts"
            / "guard-canonical-restore-target.py")
    spec = importlib.util.spec_from_file_location("iam_guard_secure_setup", path)
    if spec is None or spec.loader is None:
        fail("target URL allowlist guard is missing")
    import sys as _sys
    module = importlib.util.module_from_spec(spec)
    _sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module

def main() -> int:
    try:
        verify_account_and_repo()
        ensure_protected_environment()
        print("PASS_ENVIRONMENT_POLICY: single maintainer, no required reviewers, main only")
        guard = guard_module()
        if not sys.stdin.isatty():
            fail("must run interactively in a private terminal; no automation/pipes for plaintext URLs")
        source = getpass.getpass("Paste SOURCE URL (iam_schema_export_reader), hidden: ")
        target = getpass.getpass("Paste TARGET URL (iam_canonical_validation), hidden: ")
        try:
            guard.verify_connections(source, target)
        except guard.GateBlocked as exc:
            raise RuntimeError(f"credential URL allowlist rejected: {exc}") from exc
        set_environment_secret("IAM_CANONICAL_SOURCE_URL", source)
        set_environment_secret("IAM_CANONICAL_TARGET_URL", target)
        # This public sentinel is NOT proof of operator authorization.
        # The single maintainer retains exact-SHA, manual confirmation,
        # branch scope, TLS and restore/rollback technical gates.
        set_environment_secret("IAM_CANONICAL_OPERATOR_APPROVAL", APPROVAL_LATCH)
        verify_secret_metadata()
        verify_environment()
        print("PASS_SECRET_METADATA: all three names exist in protected environment")
        print("No credentials printed; no Neon DDL, export or restore executed")
        print("Verify exact-SHA maintainer attestation and live Environment readback per run")
        return 0
    except RuntimeError as exc:
        print(f"BLOCKED_ENVIRONMENT_CONFIGURATION: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
