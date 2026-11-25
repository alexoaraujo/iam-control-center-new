#!/usr/bin/env python3
"""Local read-only Environment governance inventory; never authorizes operations."""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
POLICY = ROOT / ".github/policies/environments.json"
SAFE = re.compile(r"[A-Za-z0-9_./* -]{1,255}\Z")
REPO = "alexoaraujo/iam-control-center-new"

class Blocked(Exception):
    pass

def name(value):
    if not isinstance(value, str) or not SAFE.fullmatch(value):
        raise Blocked("UNSAFE_METADATA")
    return value

def rows(pages, key):
    if not isinstance(pages, list) or not pages:
        raise Blocked("PAGINATION_UNVERIFIED")
    out = []
    total = None
    for page in pages:
        if not isinstance(page, dict) or type(page.get("total_count")) is not int or not isinstance(page.get(key), list):
            raise Blocked("INVALID_LIST_RESPONSE")
        if total is not None and total != page["total_count"]:
            raise Blocked("COUNT_CHANGED_DURING_READ")
        total = page["total_count"]
        out.extend(page[key])
    if total != len(out) or any(not isinstance(item, dict) for item in out):
        raise Blocked("INCOMPLETE_LIST")
    return out

def names(items):
    result = sorted(name(i.get("name")) for i in items)
    if len(result) != len(set(result)):
        raise Blocked("DUPLICATE_NAMES")
    return result

def reviewer_metadata(rules):
    result = []
    for rule in rules:
        actors = rule.get("reviewers")
        if not isinstance(actors, list) or not actors:
            raise Blocked("REVIEWER_LIST_UNVERIFIED")
        for actor in actors:
            if not isinstance(actor, dict) or actor.get("type") not in {"User", "Team"}:
                raise Blocked("REVIEWER_TYPE_UNVERIFIED")
            obj = actor.get("reviewer")
            if not isinstance(obj, dict) or type(obj.get("id")) is not int or obj["id"] <= 0:
                raise Blocked("REVIEWER_ID_UNVERIFIED")
            label = name(obj.get("login") if actor["type"] == "User" else obj.get("slug"))
            result.append({"type": actor["type"], "id": obj["id"], "name": label})
    if len({(a["type"], a["id"]) for a in result}) != len(result):
        raise Blocked("DUPLICATE_REVIEWER_ID")
    return result

def custom_metadata(items):
    result = []
    for item in items:
        app = item.get("app")
        if (type(item.get("id")) is not int or item["id"] <= 0 or
                type(item.get("enabled")) is not bool or not isinstance(app, dict) or
                type(app.get("id")) is not int or app["id"] <= 0):
            raise Blocked("CUSTOM_PROTECTION_UNVERIFIED")
        result.append({"id": item["id"], "enabled": item["enabled"], "app_id": app["id"]})
    if len({item["id"] for item in result}) != len(result):
        raise Blocked("DUPLICATE_CUSTOM_PROTECTION")
    return result

def gh(path):
    try:
        result = subprocess.run(
            ["gh", "api", "--hostname", "github.com", "--method", "GET", "--paginate", "--slurp", "-H", "X-GitHub-Api-Version: 2022-11-28", path],
            capture_output=True, text=True, check=True, timeout=90,
        )
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError):
        raise Blocked("GITHUB_READ_FAILED") from None

def audit(policy, read):
    if policy.get("repository") != REPO or policy.get("version") != 1:
        raise Blocked("UNTRUSTED_POLICY")
    base = "repos/" + REPO
    inventory = rows(read(base + "/environments?per_page=100"), "environments")
    actual = names(inventory)
    repo_secrets = names(rows(read(base + "/actions/secrets?per_page=100"), "secrets"))
    repo_vars = names(rows(read(base + "/actions/variables?per_page=100"), "variables"))
    report = {"repository": REPO, "mode": "READ_ONLY_NO_AUTHORIZATION",
              "repository_variable_names": repo_vars,
              "repository_secret_names": repo_secrets, "environments": [],
              "unobserved_candidates": sorted(set(policy["environments"]) - set(actual)),
              "preview_wildcard_activation": "HOLD_PENDING_TRUSTED_EXECUTOR_MIGRATION"}
    seen_ids = set()
    for item in inventory:
        env = name(item.get("name"))
        env_id = item.get("id")
        if type(env_id) is not int or env_id <= 0 or env_id in seen_ids:
            raise Blocked("INVALID_ENVIRONMENT_ID")
        seen_ids.add(env_id)
        path = base + "/environments/" + quote(env, safe="")
        detail = read(path)
        if not isinstance(detail, list) or len(detail) != 1 or not isinstance(detail[0], dict):
            raise Blocked("INVALID_ENVIRONMENT_DETAIL")
        meta = detail[0]
        if meta.get("id") != env_id or meta.get("name") != env:
            raise Blocked("ENVIRONMENT_IDENTITY_MISMATCH")
        rules = meta.get("protection_rules")
        if not isinstance(rules, list) or any(not isinstance(rule, dict) for rule in rules):
            raise Blocked("UNREADABLE_PROTECTIONS")
        kinds = sorted(name(rule.get("type")) for rule in rules)
        reviewers = [rule for rule in rules if rule.get("type") == "required_reviewers"]
        actors = reviewer_metadata(reviewers)
        custom_rules = custom_metadata(rows(
            read(path + "/deployment_protection_rules?per_page=100"),
            "custom_deployment_protection_rules"))
        timers = [rule.get("wait_timer") for rule in rules if rule.get("type") == "wait_timer"]
        if any(type(timer) is not int or not 0 <= timer <= 43200 for timer in timers):
            raise Blocked("WAIT_TIMER_UNVERIFIED")
        branch = meta.get("deployment_branch_policy")
        custom = isinstance(branch, dict) and branch.get("custom_branch_policies") is True and branch.get("protected_branches") is False
        policies = rows(read(path + "/deployment-branch-policies?per_page=100"), "branch_policies") if custom else []
        refs = [(name(p.get("type")), name(p.get("name"))) for p in policies]
        secret_names = names(rows(read(path + "/secrets?per_page=100"), "secrets"))
        # API may return variable values; discard them immediately, never log them.
        variable_names = names(rows(read(path + "/variables?per_page=100"), "variables"))
        expected = policy["environments"].get(env)
        findings = []
        if expected is None:
            findings.append("UNKNOWN_ENVIRONMENT_REVIEW_REQUIRED")
        if meta.get("can_admins_bypass") is not False:
            findings.append("ADMIN_BYPASS_NOT_DISABLED_OR_UNATTESTED")
        if not custom or not refs or len(refs) != len(set(refs)):
            findings.append("BRANCH_POLICY_UNATTESTED")
        if expected and set(refs) != {("branch", b) for b in expected["branches"]}:
            findings.append("BRANCH_POLICY_DRIFT")
        if any(k not in {"branch_policy", "required_reviewers", "wait_timer"} for k in kinds):
            findings.append("UNREVIEWED_PROTECTION")
        if custom_rules:
            findings.append("CUSTOM_PROTECTION_REVIEW_REQUIRED")
        if any(timer > 0 for timer in timers):
            findings.append("ACTIVE_WAIT_TIMER_REVIEW_REQUIRED")
        if len(kinds) != len(set(kinds)):
            findings.append("DUPLICATE_PROTECTION_TYPE")
        if len(reviewers) != 1 or reviewers[0].get("prevent_self_review") is not True:
            if env != "Preview":
                findings.append("INDEPENDENT_APPROVAL_NOT_ATTESTED")
        if env == "Preview":
            if repo_secrets or secret_names:
                findings.append("PREVIEW_SECRET_SCOPE_REQUIRES_SEGREGATION")
            # This initial candidate cannot attest trusted code, OIDC or external
            # credential scopes; never certify wildcard activation on metadata alone.
            findings.append("PREVIEW_WILDCARD_ACTIVATION_HOLD")
        report["environments"].append({
            "name": env, "id": env_id, "protection_types": kinds,
            "reviewers": actors, "wait_timers_minutes": timers,
            "custom_protections": custom_rules,
            "admin_bypass_disabled": meta.get("can_admins_bypass") is False,
            "prevent_self_review": len(reviewers) == 1 and reviewers[0].get("prevent_self_review") is True,
            "branch_policies": sorted(refs), "secret_names": secret_names,
            "variable_names": variable_names, "findings": findings})
    if "Preview" not in actual:
        raise Blocked("PREVIEW_MISSING")
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", required=True,
                        help="explicit read-only local GitHub CLI inventory")
    parser.parse_args()
    try:
        report = audit(json.loads(POLICY.read_text()), gh)
        print(json.dumps(report, indent=2, sort_keys=True))
        # Deliberate HOLD until the next reviewed migration, not an approval gate.
        return 2
    except (Blocked, OSError, ValueError, KeyError, TypeError):
        print("BLOCKED_ENVIRONMENT_INVENTORY_UNVERIFIED", file=sys.stderr)
        return 2

if __name__ == "__main__":
    sys.exit(main())
