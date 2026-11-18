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
# PEOS single-maintainer: no mandatory second human reviewer.
ENVS = {
    "IAM-G1-Disposable-Lease-Revocation": "main",
    "IAM-G1-Disposable-Lease-Probe": "audit/iam-g1-lease-schema-probe-20261115",
}
API_ROOT = f"https://api.github.com/repos/{REPO}/environments"


class GateBlocked(RuntimeError):
    pass


def verify_configuration(name: str, environment: dict, policies: dict, custom_rules: dict) -> None:
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
    # Zero human required-reviewers is a deliberate policy invariant.
    # This is not a waiver of branch allowlists, technical latches, or OIDC.
    if any(rule.get("type") == "required_reviewers" for rule in rules):
        raise GateBlocked("MANDATORY_HUMAN_REVIEWER_STILL_CONFIGURED")
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
    for env in ENVS:
        read = get_json("/" + env, token)
        branch_rules = get_json("/" + env + "/deployment-branch-policies?per_page=100", token)
        custom_rules = get_json("/" + env + "/deployment_protection_rules", token)
        verify_configuration(env, read, branch_rules, custom_rules)
        print("PASS_G1_LIVE_ENV_PROTECTION_READONLY " + env)
    print("PASS_G1_LIVE_ENVIRONMENTS_BOTH_READONLY_NO_SECRETS")


if __name__ == "__main__":
    try:
        live_attest()
    except GateBlocked as error:
        print("BLOCKED_G1_LIVE_ENVIRONMENT_ATTESTATION: " + str(error), file=sys.stderr)
        raise SystemExit(2)
