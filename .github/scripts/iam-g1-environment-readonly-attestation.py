#!/usr/bin/env python3
"""Read-only, secret-free IAM G1 GitHub Environment attestation.

Uses GitHub Actions GITHUB_TOKEN with actions: read only. Never updates an
Environment, accesses its secrets, deploys, or connects to Neon/PostgreSQL.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

REPO = "alexoaraujo/iam-control-center-new"
REVIEWER = "alexoaraujo83"
ENVS = {
    "IAM-G1-Disposable-Lease-Revocation": "main",
    "IAM-G1-Disposable-Lease-Probe": "audit/iam-g1-lease-schema-probe-20261115",
    "IAM-G1-Full-Backup-Custody": "main",
    "IAM-G1-B2-Full-Readback-Custody": "main",
    "IAM-G1-Full-Restore-Custody": "main",
}
API_ROOT = f"https://api.github.com/repos/{REPO}/environments"


class GateBlocked(RuntimeError):
    pass


def verify_configuration(name: str, environment: dict, policies: dict, custom_rules: dict) -> str:
    """Validate metadata, rejecting unknown/bypassed protections."""
    if name not in ENVS:
        raise GateBlocked("UNKNOWN_ENVIRONMENT")
    if environment.get("name") != name:
        raise GateBlocked("ENV_NAME_MISMATCH")
    # GitHub's API returns can_admins_bypass even when REST examples omit it.
    # An absent value must fail closed.
    if environment.get("can_admins_bypass") is not False:
        raise GateBlocked("ADMIN_BYPASS_ENABLED_OR_NOT_ATTESTED")
    branch_guard = environment.get("deployment_branch_policy") or {}
    if (branch_guard.get("protected_branches") is not False or
            branch_guard.get("custom_branch_policies") is not True):
        raise GateBlocked("BRANCH_SELECTION_NOT_EXCLUSIVE_CUSTOM")
    rules = environment.get("protection_rules")
    if not isinstance(rules, list):
        raise GateBlocked("PROTECTION_RULES_UNREADABLE")
    if any(rule.get("type") not in
           {"required_reviewers", "branch_policy", "wait_timer"} for rule in rules):
        raise GateBlocked("UNAPPROVED_CUSTOM_DEPLOYMENT_RULE")
    # Metadata audit supports the documented solo-maintainer policy. This
    # script never unlocks an Environment or accesses its secrets: no reviewer
    # is an explicit SOLO status, not proof of independent operational approval.
    # When a reviewer rule EXISTS, preserve its original strict contract.
    reviewers = [rule for rule in rules if rule.get("type") == "required_reviewers"]
    if len(reviewers) > 1:
        raise GateBlocked("DUPLICATE_REQUIRED_REVIEWER_RULES")
    review_mode = "SOLO_NO_REQUIRED_REVIEWER"
    if reviewers:
        if reviewers[0].get("prevent_self_review") is not True:
            raise GateBlocked("REQUIRED_REVIEWER_SELF_REVIEW_GUARD_DISABLED")
        allowed = reviewers[0].get("reviewers", [])
        if (not isinstance(allowed, list) or len(allowed) != 1 or
                allowed[0].get("type") != "User" or
                (allowed[0].get("reviewer") or {}).get("login") != REVIEWER):
            raise GateBlocked("INDEPENDENT_REVIEWER_MISMATCH")
        review_mode = "INDEPENDENT_REVIEWER"
    timers = [rule for rule in rules if rule.get("type") == "wait_timer"]
    if any(rule.get("wait_timer") != 0 for rule in timers):
        raise GateBlocked("UNEXPECTED_WAIT_TIMER")
    # Custom GitHub App protection rules have their OWN REST endpoint; the
    # environment.protection_rules collection alone is insufficient.
    custom_list = custom_rules.get("custom_deployment_protection_rules")
    if (custom_rules.get("total_count") != 0 or
            not isinstance(custom_list, list) or len(custom_list) != 0):
        raise GateBlocked("CUSTOM_DEPLOYMENT_PROTECTION_RULE_ACTIVE_OR_UNKNOWN")
    listed = policies.get("branch_policies")
    if (policies.get("total_count") != 1 or
            not isinstance(listed, list) or len(listed) != 1 or
            listed[0].get("name") != ENVS[name] or
            listed[0].get("type") != "branch"):
        raise GateBlocked("DEPLOYMENT_BRANCH_PATTERN_NOT_EXACT")
    return review_mode


def get_json(path: str, token: str) -> dict:
    if not token:
        raise GateBlocked("GITHUB_READ_TOKEN_MISSING")
    request = urllib.request.Request(
        API_ROOT + path,
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "iam-g1-readonly-environment-audit",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.status != 200:
                raise GateBlocked("GITHUB_ENVIRONMENT_API_BAD_STATUS")
            obj = json.loads(response.read(524288).decode("utf-8"))
    except urllib.error.HTTPError as error:
        # Explicit HTTP classification without echoing the URL, headers or body.
        stage = ("BRANCH_POLICIES" if "/deployment-branch-policies" in path
                 else "CUSTOM_RULES" if "/deployment_protection_rules" in path
                 else "ENVIRONMENT")
        outcome = {401: "UNAUTHORIZED", 403: "FORBIDDEN",
                   404: "NOT_FOUND_OR_INACCESSIBLE",
                   429: "RATE_LIMITED"}.get(error.code, "OTHER")
        raise GateBlocked("GITHUB_ENVIRONMENT_API_" + stage + "_" + outcome) from None
    except (urllib.error.URLError, ValueError, UnicodeError):
        # Never print request headers: they contain the workflow token.
        raise GateBlocked("GITHUB_ENVIRONMENT_API_READ_FAILED") from None
    if not isinstance(obj, dict):
        raise GateBlocked("GITHUB_ENVIRONMENT_API_INVALID_RESPONSE")
    return obj


def live_attest() -> None:
    if os.environ.get("GITHUB_REPOSITORY") != REPO:
        raise GateBlocked("GITHUB_REPOSITORY_NOT_ALLOWLISTED")
    token = os.environ.get("GITHUB_TOKEN", "")
    blocked = []
    attested_ids: set[int] = set()
    for env in ENVS:
        try:
            read = get_json("/" + env, token)
            # GitHub returns HTTP 404 for branch-policy listing when custom
            # branch policies are disabled. Identify the effective setting
            # before that endpoint, without mislabeling it as inaccessible.
            if read.get("name") != env:
                raise GateBlocked("ENV_NAME_MISMATCH")
            # Numeric IDs come from the named REST resource, not a copied URL.
            env_id = read.get("id")
            if isinstance(env_id, bool) or not isinstance(env_id, int) or env_id <= 0:
                raise GateBlocked("ENVIRONMENT_ID_MISSING_OR_INVALID")
            if env_id in attested_ids:
                raise GateBlocked("ENVIRONMENT_ID_COLLISION")
            if read.get("can_admins_bypass") is not False:
                raise GateBlocked("ADMIN_BYPASS_ENABLED_OR_NOT_ATTESTED")
            guard = read.get("deployment_branch_policy") or {}
            if (guard.get("protected_branches") is not False or
                    guard.get("custom_branch_policies") is not True):
                raise GateBlocked("BRANCH_SELECTION_NOT_EXCLUSIVE_CUSTOM")
            branch_rules = get_json("/" + env + "/deployment-branch-policies?per_page=100", token)
            custom_rules = get_json("/" + env + "/deployment_protection_rules", token)
            review_mode = verify_configuration(env, read, branch_rules, custom_rules)
            attested_ids.add(env_id)
        except GateBlocked as error:
            # Continue gathering independent Environment metadata, but NEVER
            # return success after a partial audit or print token/API response.
            blocked.append(env + ": " + str(error))
            continue
        print("PASS_G1_LIVE_ENV_METADATA_READONLY " + env +
              " environment_id=" + str(env_id) +
              " console_url=https://github.com/" + REPO +
              "/settings/environments/" + str(env_id) +
              " reviewer_mode=" + review_mode)
        if review_mode == "SOLO_NO_REQUIRED_REVIEWER":
            print("NOT_ATTESTED_G1_INDEPENDENT_REVIEW " + env)
    if blocked:
        for failure in blocked:
            print("BLOCKED_G1_LIVE_ENVIRONMENT_DETAIL: " + failure, file=sys.stderr)
        raise GateBlocked("TOTAL_BLOCKED_ENVIRONMENTS=" + str(len(blocked)))
    print("PASS_G1_LIVE_ENV_METADATA_FIVE_READONLY_NO_SECRETS")
    print("G1_PRIVILEGED_OPERATIONS=NOT_AUTHORIZED_BY_METADATA_AUDIT")


if __name__ == "__main__":
    try:
        live_attest()
    except GateBlocked as error:
        print("BLOCKED_G1_LIVE_ENVIRONMENT_ATTESTATION: " + str(error), file=sys.stderr)
        raise SystemExit(2)
