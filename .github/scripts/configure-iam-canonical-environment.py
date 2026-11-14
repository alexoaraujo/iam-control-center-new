#!/usr/bin/env python3
"""Configure a *protected* GitHub environment and store 3 Neon secrets via gh CLI.

Run locally with GitHub CLI authenticated as a repository administrator.
Never put connection strings in shell arguments, CI inputs, git, logs or issues.
This does not run a workflow, migrate schemas, or alter Neon databases.
"""
from __future__ import annotations

import argparse
import getpass
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

REPOSITORY = "alexoaraujo/iam-control-center-new"
ENVIRONMENT = "IAM-Canonical-Isolated-Restore"
REVIEWER = "alexoaraujo83"
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

def verify_account_and_repo() -> int:
    repo = gh_json("api", f"repos/{REPOSITORY}")
    if repo.get("default_branch") != "main" or repo.get("private") is not False:
        fail("expected public repository with main as default branch")
    user = gh_json("api", "user")
    reviewer = gh_json("api", f"users/{REVIEWER}")
    if user.get("id") == reviewer.get("id"):
        fail("reviewer must be a distinct GitHub identity")
    collaborator = gh_json(
        "api", f"repos/{REPOSITORY}/collaborators/{REVIEWER}/permission"
    )
    if collaborator.get("permission") not in ("read", "triage", "write", "maintain", "admin"):
        fail("reviewer has no repository access")
    if not isinstance(reviewer.get("id"), int):
        fail("reviewer ID unavailable")
    return reviewer["id"]

def verify_environment(review_id: int) -> None:
    info = gh_json("api", ENV_API)
    if info.get("name") != ENVIRONMENT:
        fail("environment identity mismatch")
    if info.get("can_admins_bypass") is not False:
        fail("administrator bypass must be disabled on the protected environment")
    bp = info.get("deployment_branch_policy") or {}
    if bp.get("protected_branches") is not False or bp.get("custom_branch_policies") is not True:
        fail("environment branch policy is not custom-only")
    reviewers = [rule for rule in info.get("protection_rules", [])
                 if rule.get("type") == "required_reviewers"]
    if len(reviewers) != 1:
        fail("environment has no exactly one required-reviewer protection rule")
    rule = reviewers[0]
    if rule.get("prevent_self_review") is not True:
        fail("Prevent self-review is not active")
    allowed = [x for x in rule.get("reviewers", [])
               if x.get("type") == "User"]
    if len(allowed) != 1 or allowed[0].get("reviewer", {}).get("id") != review_id:
        fail("independent required reviewer is not configured")
    policies = gh_json("api", f"{ENV_API}/deployment-branch-policies?per_page=100")
    actual = [(x.get("name"), x.get("type")) for x in policies.get("branch_policies", [])]
    if actual != [("main", "branch")]:
        fail("deployment branch policies must contain exactly one branch: main")

def ensure_protected_environment(review_id: int) -> None:
    payload = json.dumps({
        "wait_timer": 0,
        "can_admins_bypass": False,
        "prevent_self_review": True,
        "reviewers": [{"type": "User", "id": review_id}],
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
    verify_environment(review_id)

def set_environment_secret(name: str, value: str) -> None:
    if name not in SECRET_NAMES or not value:
        fail("invalid secret name/value")
    # gh secret set encrypts locally. Its value comes from stdin, not CLI argv.
    gh("secret", "set", name, "--env", ENVIRONMENT,
       "--repo", REPOSITORY, input_value=value)

def present_secret_names() -> set[str]:
    """Only GitHub secret *metadata*. Secret values are never read or printed."""
    rows = gh_json("api", f"{ENV_API}/secrets?per_page=100")
    return {x.get("name") for x in rows.get("secrets", [])
            if isinstance(x.get("name"), str)}

def verify_secret_metadata() -> None:
    present = present_secret_names()
    missing = sorted(set(SECRET_NAMES) - present)
    if missing:
        fail("required environment secrets are missing: " + ", ".join(missing))

def sync_target_only(review_id: int) -> None:
    """Set only a MISSING target URL, without rotating source or approval."""
    verify_environment(review_id)
    present = present_secret_names()
    required = {"IAM_CANONICAL_SOURCE_URL", "IAM_CANONICAL_OPERATOR_APPROVAL"}
    missing = sorted(required - present)
    if missing:
        fail("existing source/approval secret metadata missing: " + ", ".join(missing))
    if "IAM_CANONICAL_TARGET_URL" in present:
        # An existing value cannot be attested via GitHub secret metadata.
        print("SKIPPED_TARGET_EXISTS: no overwrite; value is NOT verified")
        print("Run the protected auth_only workflow to attest the actual credentials")
        return
    if not sys.stdin.isatty():
        fail("target-only secret setup requires a private interactive terminal")
    target = getpass.getpass("Paste TARGET URL (iam_canonical_validation), hidden: ")
    guard = guard_module()
    try:
        guard.parse_approved_url(
            target,
            host=guard.TARGET_HOST,
            database=guard.TARGET_DATABASE,
            role=guard.TARGET_ROLE,
        )
    except guard.GateBlocked as exc:
        fail(f"target URL allowlist rejected: {exc}")
    # No source or approval secret is accessed, read, or overwritten.
    set_environment_secret("IAM_CANONICAL_TARGET_URL", target)
    verify_secret_metadata()
    verify_environment(review_id)
    print("PASS_TARGET_SECRET_METADATA: only target written to protected environment")
    print("NOT_ATTESTED: source and approval secret values cannot be read by GitHub")
    print("NEXT_GATE: protected auth_only; do not run readiness/export/restore yet")

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
    parser = argparse.ArgumentParser(
        description="Fail-closed GitHub Environment secret metadata or interactive setup"
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--verify-only", action="store_true",
                      help="Check environment policy and all 3 secret names; never read values")
    mode.add_argument("--target-only", action="store_true",
                      help="Write only a missing target secret; preserve source/approval")
    mode.add_argument("--protect-only", action="store_true",
                      help="Configure independent reviewer, prevent self-review and disable admin bypass; never touch secrets")
    args = parser.parse_args()
    try:
        review_id = verify_account_and_repo()
        if args.verify_only:
            verify_environment(review_id)
            verify_secret_metadata()
            print("PASS_METADATA_ONLY: protected main, reviewer, 3 secret names")
            print("NOT_ATTESTED: URL values, TLS auth, privileges, or restore")
            return 0
        if args.target_only:
            sync_target_only(review_id)
            return 0
        if args.protect_only:
            ensure_protected_environment(review_id)
            verify_secret_metadata()
            print("PASS_PROTECTION_ONLY: main-only, independent reviewer, no admin bypass")
            print("NO_SECRET_WRITE: existing source, target and approval values preserved")
            print("NEXT_GATE: run --verify-only; then reviewed main auth_only / NO_DDL")
            return 0
        # Historical full-configuration mode is unchanged; it explicitly
        # requires the operator to provide and validate BOTH secret URLs.
        ensure_protected_environment(review_id)
        print("PASS_ENVIRONMENT_POLICY: independent reviewer, self-review denied, main only")
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
        # This publicly known sentinel is NOT the approval mechanism.
        # Required environment reviewers and branch restrictions are the actual gate.
        set_environment_secret("IAM_CANONICAL_OPERATOR_APPROVAL", APPROVAL_LATCH)
        verify_secret_metadata()
        verify_environment(review_id)
        print("PASS_SECRET_METADATA: all three names exist in protected environment")
        print("No credentials printed; no Neon DDL, export or restore executed")
        print("Verify actual reviewer approval for each run in GitHub Environments")
        return 0
    except RuntimeError as exc:
        print(f"BLOCKED_ENVIRONMENT_CONFIGURATION: {exc}", file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
