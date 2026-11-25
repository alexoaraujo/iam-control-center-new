#!/usr/bin/env python3
"""Offline/safe read-only PEOS Environment approval status (no secret retrieval)."""
import json
import os
import re
import sys
from urllib import request, error

REPO = "alexoaraujo/iam-control-center-new"
ENVIRONMENTS = (
    "Preview", "IAM-Canonical-Isolated-Restore", "Neon-PR-Lifecycle",
    "IAM-Audit-Development", "IAM-G1-Backup-Custody",
    "IAM-G1-Disposable-Lease-Revocation", "IAM-G1-Disposable-Lease-Probe",
)
ROOT = f"https://api.github.com/repos/{REPO}/environments"

# Policy for privileged Environments is fixed by trusted workflow refs, not
# inferred from a boolean API flag. Preview can use only explicit PR merge
# refs or the two reviewed integration branches; wildcard patterns are denied.
EXACT_BRANCHES = {
    "IAM-Canonical-Isolated-Restore": "main",
    "Neon-PR-Lifecycle": "main",
    "IAM-Audit-Development": "main",
    "IAM-G1-Backup-Custody": "main",
    "IAM-G1-Disposable-Lease-Revocation": "main",
    "IAM-G1-Disposable-Lease-Probe": "audit/iam-g1-lease-schema-probe-20261115",
}
PREVIEW_BRANCHES = {
    "main",
    "integration/peos-single-maintainer-bun-20261117",
    "integration/peos-g1-g2-canonical-bun-20261118",
    "docs/peos-g1-iam-sync-runbook-20261114",
}
PREVIEW_PR_REF = re.compile(r"refs/pull/[1-9][0-9]*/merge\Z")

def verify_branch_policies(name, environment, policies):
    branch = environment.get("deployment_branch_policy")
    if not isinstance(branch, dict) or (
        branch.get("protected_branches") is not False or
        branch.get("custom_branch_policies") is not True
    ):
        raise Blocked("CUSTOM_BRANCH_RESTRICTIONS_NOT_ATTESTED")
    if not isinstance(policies, dict):
        raise Blocked("DEPLOYMENT_BRANCH_POLICIES_MISSING")
    items = policies.get("branch_policies")
    count = policies.get("total_count")
    # per_page=100; never certify a partial/ambiguous read or page truncation.
    if (type(count) is not int or not isinstance(items, list) or
            count != len(items) or not 1 <= count <= 100):
        raise Blocked("DEPLOYMENT_BRANCH_POLICY_COUNT_UNVERIFIED")
    names = []
    for item in items:
        if not isinstance(item, dict) or item.get("type") != "branch":
            raise Blocked("DEPLOYMENT_BRANCH_POLICY_TYPE_INVALID")
        branch_name = item.get("name")
        if not isinstance(branch_name, str) or not branch_name:
            raise Blocked("DEPLOYMENT_BRANCH_POLICY_NAME_INVALID")
        if name == "Preview":
            if branch_name not in PREVIEW_BRANCHES and not PREVIEW_PR_REF.fullmatch(branch_name):
                raise Blocked("PREVIEW_BRANCH_NOT_ALLOWLISTED")
        elif branch_name != EXACT_BRANCHES.get(name):
            raise Blocked("PRIVILEGED_BRANCH_NOT_ALLOWLISTED")
        names.append(branch_name)
    if len(names) != len(set(names)):
        raise Blocked("DUPLICATE_DEPLOYMENT_BRANCH_POLICY")
    if name == "Preview":
        if "main" not in names:
            raise Blocked("PREVIEW_MAIN_BRANCH_NOT_PRESENT")
    elif names != [EXACT_BRANCHES[name]]:
        raise Blocked("PRIVILEGED_BRANCH_POLICY_NOT_EXACT")

def branch_policy_diagnostic(payload):
    """Bounded branch-policy metadata only; never log tokens or arbitrary API fields."""
    if not isinstance(payload, dict):
        return {"status": "invalid_response"}
    items = payload.get("branch_policies")
    count = payload.get("total_count")
    if type(count) is not int:
        count = "<invalid>"
    if not isinstance(items, list):
        return {"total_count": count, "status": "missing_branch_policies"}
    # Even malformed API payloads can never amplify job logs without bound.
    policies = []
    for item in items[:100]:
        if not isinstance(item, dict):
            policies.append({"name": "<invalid>", "type": "<invalid>"})
            continue
        name, kind = item.get("name"), item.get("type")
        if not isinstance(name, str) or len(name) > 250 or any(
            not 32 <= ord(ch) <= 126 for ch in name
        ):
            name = "<invalid>"
        if kind not in ("branch", "tag"):
            kind = "<invalid>"
        policies.append({"name": name, "type": kind})
    return {"total_count": count, "listed_count": len(items), "branch_policies": policies}


class Blocked(RuntimeError):
    pass

def verify(name, environment, custom, policies):
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
    verify_branch_policies(name, environment, policies)
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
        branch_policies = None
        try:
            environment = api("/" + name, token)
            custom_rules = api("/" + name + "/deployment_protection_rules", token)
            branch_policies = api("/" + name + "/deployment-branch-policies?per_page=100", token)
            verify(name, environment, custom_rules, branch_policies)
            print("PASS_PE0S_ENV_NO_HUMAN_APPROVAL " + name)
        except Blocked as exc:
            failures += 1
            print("BLOCKED_PE0S_ENV " + name + " " + str(exc), file=sys.stderr)
            # GitHub Environment read APIs are inaccessible to this connector;
            # diagnostics must be observable in the actual read-only CI run.
            # Emit only bounded non-secret branch names/types after policy drift.
            if branch_policies is not None and ("BRANCH" in str(exc) or "POLICY" in str(exc)):
                print("PEOS_ENV_BRANCH_POLICY_EVIDENCE " + name + " " +
                      json.dumps(branch_policy_diagnostic(branch_policies), sort_keys=True),
                      file=sys.stderr)
    print(f"PEOS_ENVIRONMENTS={len(ENVIRONMENTS)} BLOCKED={failures}")
    return 2 if failures else 0

if __name__ == "__main__":
    sys.exit(main())
