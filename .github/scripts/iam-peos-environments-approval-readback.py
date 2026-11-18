#!/usr/bin/env python3
"""Offline/safe read-only PEOS Environment approval status (no secret retrieval)."""
import json
import os
import sys
from urllib import request, error

REPO = "alexoaraujo/iam-control-center-new"
ENVIRONMENTS = (
    "Preview", "IAM-Canonical-Isolated-Restore", "Neon-PR-Lifecycle",
    "IAM-Audit-Development", "IAM-G1-Backup-Custody",
    "IAM-G1-Disposable-Lease-Revocation", "IAM-G1-Disposable-Lease-Probe",
)
ROOT = f"https://api.github.com/repos/{REPO}/environments"

class Blocked(RuntimeError):
    pass

def verify(name, environment, custom):
    if name not in ENVIRONMENTS or not isinstance(environment, dict) or environment.get("name") != name:
        raise Blocked("UNTRUSTED_ENVIRONMENT")
    rules = environment.get("protection_rules")
    if not isinstance(rules, list) or any(not isinstance(r, dict) for r in rules):
        raise Blocked("PROTECTION_RULES_MISSING")
    if any(r.get("type") == "required_reviewers" for r in rules):
        raise Blocked("REQUIRED_HUMAN_REVIEWERS_PRESENT")
    if any(r.get("type") not in ("branch_policy", "wait_timer") for r in rules):
        raise Blocked("UNKNOWN_PROTECTION_RULE")
    if any(r.get("type") == "wait_timer" and r.get("wait_timer") != 0 for r in rules):
        raise Blocked("WAIT_TIMER_ACTIVE")
    if environment.get("can_admins_bypass") is not False:
        raise Blocked("ADMIN_BYPASS_NOT_DISABLED")
    branch = environment.get("deployment_branch_policy")
    if not isinstance(branch, dict) or not (
        branch.get("protected_branches") is True or branch.get("custom_branch_policies") is True
    ):
        raise Blocked("BRANCH_RESTRICTIONS_NOT_ATTESTED")
    if not isinstance(custom, dict) or custom.get("total_count") != 0 or custom.get("custom_deployment_protection_rules") != []:
        raise Blocked("CUSTOM_DEPLOYMENT_RULE_NOT_EMPTY")

def api(path, token):
    if not token:
        raise Blocked("READ_TOKEN_MISSING")
    req = request.Request(ROOT + path, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "iam-peos-env-readonly",
    })
    try:
        with request.urlopen(req, timeout=15) as res:
            payload = json.loads(res.read(524288).decode())
    except (OSError, ValueError, UnicodeError):
        raise Blocked("GITHUB_READ_API_UNAVAILABLE") from None
    if not isinstance(payload, dict):
        raise Blocked("GITHUB_READ_API_MALFORMED")
    return payload

def main():
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        print("BLOCKED_PE0S_REPO_ID", file=sys.stderr)
        return 2
    token = os.environ.get("GITHUB_TOKEN", "")
    failures = 0
    for name in ENVIRONMENTS:
        try:
            verify(name, api("/" + name, token),
                   api("/" + name + "/deployment_protection_rules", token))
            print("PASS_PE0S_ENV_NO_HUMAN_APPROVAL " + name)
        except Blocked as exc:
            failures += 1
            print("BLOCKED_PE0S_ENV " + name + " " + str(exc), file=sys.stderr)
    print(f"PEOS_ENVIRONMENTS={len(ENVIRONMENTS)} BLOCKED={failures}")
    return 2 if failures else 0

if __name__ == "__main__":
    sys.exit(main())
