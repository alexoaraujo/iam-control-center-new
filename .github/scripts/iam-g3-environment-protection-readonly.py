#!/usr/bin/env python3
"""Read-only GitHub API policy attestation for PR128's G3 owner Environment.

No 'environment:' is set in the workflow that calls this script. The runner
never receives an owner credential, nor does it read environment secrets.
"""
import json
import os
import re
import sys
from urllib import request, error

REPO = "alexoaraujo/iam-control-center-new"
NAME = "IAM-G3-PR128-Disposable-RBAC"
ROOT = f"https://api.github.com/repos/{REPO}/environments/{NAME}"
ALLOWED = {"refs/pull/128/merge", "integration/peos-single-maintainer-bun-20261117"}


class PolicyBlocked(RuntimeError):
    pass


def verify_g3(metadata, policies, custom):
    if not isinstance(metadata, dict) or metadata.get("name") != NAME:
        raise PolicyBlocked("G3_ENV_NAME_MISMATCH")
    if metadata.get("can_admins_bypass") is not False:
        raise PolicyBlocked("G3_ENV_ADMIN_BYPASS_NOT_DISABLED")
    dp = metadata.get("deployment_branch_policy")
    if not isinstance(dp, dict) or (
        dp.get("protected_branches") is not False or
        dp.get("custom_branch_policies") is not True
    ):
        raise PolicyBlocked("G3_ENV_CUSTOM_BRANCH_POLICY_NOT_ATTESTED")
    rules = metadata.get("protection_rules")
    if not isinstance(rules, list) or not rules or any(
        not isinstance(r, dict) for r in rules
    ):
        raise PolicyBlocked("G3_ENV_PROTECTION_RULES_MISSING")
    if any(r.get("type") == "required_reviewers" for r in rules):
        raise PolicyBlocked("G3_ENV_HUMAN_APPROVAL_REQUIRED")
    if any(r.get("type") not in ("branch_policy", "wait_timer") for r in rules):
        raise PolicyBlocked("G3_ENV_UNEXPECTED_PROTECTION_RULE")
    if not any(r.get("type") == "branch_policy" for r in rules):
        raise PolicyBlocked("G3_ENV_BRANCH_POLICY_RULE_MISSING")
    if any(r.get("type") == "wait_timer" and r.get("wait_timer") != 0 for r in rules):
        raise PolicyBlocked("G3_ENV_WAIT_TIMER_ACTIVE")
    if not isinstance(custom, dict) or (
        custom.get("total_count") != 0 or
        custom.get("custom_deployment_protection_rules") != []
    ):
        raise PolicyBlocked("G3_ENV_CUSTOM_PROTECTION_NOT_EMPTY")
    if not isinstance(policies, dict):
        raise PolicyBlocked("G3_ENV_POLICIES_MISSING")
    count, items = policies.get("total_count"), policies.get("branch_policies")
    if type(count) is not int or not isinstance(items, list) or (
        count != len(items) or not 1 <= count <= 100
    ):
        raise PolicyBlocked("G3_ENV_POLICY_LIST_INCOMPLETE")
    names = []
    for policy in items:
        if not isinstance(policy, dict) or policy.get("type") != "branch":
            raise PolicyBlocked("G3_ENV_POLICY_TYPE_NOT_BRANCH")
        name = policy.get("name")
        if not isinstance(name, str) or name not in ALLOWED:
            raise PolicyBlocked("G3_ENV_BRANCH_NOT_EXACT_ALLOWLIST")
        names.append(name)
    if len(names) != len(set(names)):
        raise PolicyBlocked("G3_ENV_DUPLICATE_BRANCH_POLICY")
    if "refs/pull/128/merge" not in names:
        raise PolicyBlocked("G3_ENV_PR128_MERGE_REF_NOT_ALLOWED")
    return sorted(names)


def query(url, token):
    req = request.Request(url, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "iam-g3-policy-readonly",
    })
    # Never print any upstream error body, token or response headers.
    try:
        with request.urlopen(req, timeout=15) as response:
            return json.loads(response.read(524288).decode("utf-8"))
    except error.HTTPError as exc:
        # Status code only; NEVER include response body, auth headers or URL.
        raise PolicyBlocked("G3_ENV_API_HTTP_" + str(exc.code)) from None
    except (OSError, ValueError, UnicodeError):
        raise PolicyBlocked("G3_ENV_API_READ_UNAVAILABLE") from None


def run(repo, token):
    if repo != REPO:
        raise PolicyBlocked("G3_ENV_UNEXPECTED_REPO")
    if not token:
        raise PolicyBlocked("G3_ENV_TOKEN_MISSING")
    evidence = {}
    for stage, url in (
        ("METADATA", ROOT),
        ("BRANCH_POLICIES", ROOT + "/deployment-branch-policies?per_page=100"),
        ("CUSTOM_RULES", ROOT + "/deployment_protection_rules"),
    ):
        try:
            evidence[stage] = query(url, token)
        except PolicyBlocked as exc:
            raise PolicyBlocked("G3_ENV_" + stage + "_" + str(exc)) from None
        if stage == "METADATA":
            # Emit only typed/allowlisted booleans and rule categories, never raw
            # upstream metadata, secrets, arbitrary strings or HTTP bodies.
            metadata = evidence["METADATA"]
            dp = metadata.get("deployment_branch_policy")
            dp = dp if isinstance(dp, dict) else {}
            rules = metadata.get("protection_rules")
            rules = rules if isinstance(rules, list) else []
            kinds = [
                r.get("type") if isinstance(r, dict) and r.get("type") in
                ("branch_policy", "required_reviewers", "wait_timer")
                else "unknown"
                for r in rules[:20]
            ]
            snapshot = {
                "name_matches_target": metadata.get("name") == NAME,
                "admins_bypass_disabled": metadata.get("can_admins_bypass") is False,
                "admin_bypass_state": (
                    "disabled" if metadata.get("can_admins_bypass") is False
                    else "enabled" if metadata.get("can_admins_bypass") is True
                    else "not_reported"
                ),
                "protected_branches": dp.get("protected_branches") is True,
                "custom_branch_policies": dp.get("custom_branch_policies") is True,
                "rule_types": kinds,
            }
            print("G3_ENV_METADATA " + json.dumps(snapshot, sort_keys=True))
            if not snapshot["name_matches_target"]:
                raise PolicyBlocked("G3_ENV_NAME_MISMATCH")
        if stage == "BRANCH_POLICIES":
            payload = evidence["BRANCH_POLICIES"]
            items = payload.get("branch_policies") if isinstance(payload, dict) else None
            names = []
            for item in items[:20] if isinstance(items, list) else []:
                name = item.get("name") if isinstance(item, dict) else None
                if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_./*-]{1,100}", name):
                    name = "<invalid>"
                names.append(name)
            count = payload.get("total_count") if isinstance(payload, dict) else None
            if type(count) is not int:
                count = -1
            print("G3_ENV_BRANCH_POLICY_READBACK " + json.dumps({
                "total_count": count, "names": names
            }, sort_keys=True))
    names = verify_g3(evidence["METADATA"], evidence["BRANCH_POLICIES"], evidence["CUSTOM_RULES"])
    print("PASS_G3_ENV_EFFECTIVE_PROTECTION " + NAME)
    print("G3_ENV_ALLOWED_REFS " + json.dumps(names, separators=(",", ":")))
    print("G3_ENV_SECRET_NAME_AND_VALUE=NOT_ATTESTED")
    print("G3_POSITIVE_GRANT_REVOKE=NOT_RUN")


def main():
    try:
        run(os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN"))
    except PolicyBlocked as exc:
        print("BLOCKED_G3_ENV_EFFECTIVE_PROTECTION " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
