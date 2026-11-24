#!/usr/bin/env python3
"""G2 protection metadata only. No environment job, secret values, DB or write API."""
import json
import os
import re
import subprocess
import sys
from urllib import request, error

REPO = "alexoaraujo/iam-control-center-new"
ROOT = "https://api.github.com/repos/" + REPO
REVIEWER = "alexoaraujo83"
ATTEST = "IAM-G2-Neon-Endpoint-Attestation"
ACQUIRE = "IAM-G2-Development-Evidence-Acquisition"
CONTRACT = {
    ATTEST: ({"IAM_G2_NEON_ENDPOINT_READ_TOKEN"}, {"IAM_G2_APPROVED_SHA"}),
    ACQUIRE: ({"IAM_G2_READER_PASSWORD"}, {"IAM_G2_APPROVED_SHA", "IAM_G2_RECIPIENT_CERT_SHA256"}),
}
SHA = re.compile(r"[0-9a-f]{40}\Z")
HEX = re.compile(r"[0-9a-f]{64}\Z")
LIMIT = 1024 * 1024

class Blocked(RuntimeError):
    pass

def require(ok, code):
    if not ok:
        raise Blocked(code)

def rows(payload, key):
    require(isinstance(payload, dict), "INVALID_LIST")
    items = payload.get(key)
    n = payload.get("total_count")
    require(type(n) is int and isinstance(items, list) and
            0 <= n <= 100 and n == len(items) and
            all(isinstance(x, dict) for x in items), "INCOMPLETE_LIST")
    return items

def names(payload, key):
    result = {}
    for row in rows(payload, key):
        name = row.get("name")
        require(isinstance(name, str) and re.fullmatch(r"[A-Z_][A-Z0-9_]*", name)
                and name not in result, "INVALID_OR_DUPLICATE_NAME")
        result[name] = row
    return result

def verify_environment(name, bundle, approved_sha):
    require(name in CONTRACT and isinstance(bundle, dict), "INVALID_TARGET")
    env = bundle.get("environment")
    require(isinstance(env, dict) and env.get("name") == name and
            type(env.get("id")) is int and env["id"] > 0, "ENVIRONMENT_ID_MISMATCH")
    require(env.get("can_admins_bypass") is False, "ADMIN_BYPASS_NOT_DISABLED")
    require(env.get("deployment_branch_policy") ==
            {"protected_branches": False, "custom_branch_policies": True}, "BRANCH_POLICY_NOT_EXCLUSIVE")
    rules = env.get("protection_rules")
    require(isinstance(rules, list) and all(isinstance(r, dict) for r in rules),
            "PROTECTION_RULES_UNVERIFIED")
    types = [r.get("type") for r in rules]
    require(types.count("branch_policy") == 1 and types.count("required_reviewers") == 1 and
            types.count("wait_timer") <= 1 and all(x in
            ("branch_policy", "required_reviewers", "wait_timer") for x in types),
            "PROTECTION_RULE_SET_MISMATCH")
    review = next(r for r in rules if r["type"] == "required_reviewers")
    people = review.get("reviewers")
    require(review.get("prevent_self_review") is True and isinstance(people, list) and
            len(people) == 1 and isinstance(people[0], dict) and people[0].get("type") == "User" and
            isinstance(people[0].get("reviewer"), dict) and
            people[0]["reviewer"].get("login") == REVIEWER, "INDEPENDENT_REVIEW_REQUIRED")
    require(all(r.get("wait_timer") == 0 for r in rules if r["type"] == "wait_timer"),
            "UNEXPECTED_TIMER")
    policies = rows(bundle.get("branches"), "branch_policies")
    require(len(policies) == 1 and policies[0].get("type") == "branch" and
            policies[0].get("name") == "main", "EXACT_MAIN_ONLY_REQUIRED")
    require(rows(bundle.get("custom"), "custom_deployment_protection_rules") == [],
            "CUSTOM_PROTECTION_UNREVIEWED")
    expected_secrets, expected_vars = CONTRACT[name]
    secrets = names(bundle.get("secrets"), "secrets")
    variables = names(bundle.get("variables"), "variables")
    require(set(secrets) == expected_secrets and set(variables) == expected_vars,
            "CREDENTIAL_SCOPE_MISMATCH")
    require(variables["IAM_G2_APPROVED_SHA"].get("value") == approved_sha,
            "ENVIRONMENT_SHA_MISMATCH")
    if name == ACQUIRE:
        fp = variables["IAM_G2_RECIPIENT_CERT_SHA256"].get("value")
        require(isinstance(fp, str) and HEX.fullmatch(fp) is not None,
                "RECIPIENT_PIN_MISSING")
    return env["id"]

def verify(snapshot, approved_sha):
    require(isinstance(approved_sha, str) and SHA.fullmatch(approved_sha) is not None,
            "INVALID_APPROVED_SHA")
    require(isinstance(snapshot, dict) and snapshot.get("checkout_sha") == approved_sha and
            snapshot.get("main_before") == approved_sha and snapshot.get("main_after") == approved_sha,
            "CHECKOUT_OR_MAIN_SHA_MISMATCH")
    repo = snapshot.get("repository")
    require(isinstance(repo, dict) and repo.get("full_name") == REPO and
            isinstance(repo.get("owner"), dict) and repo["owner"].get("type") == "User",
            "REPOSITORY_SCOPE_UNATTESTED")
    # Personal repository: no organization-level inherited credentials.
    # Fail closed if ownership changes or inventories are incomplete.
    require(repo.get("default_branch") == "main", "DEFAULT_BRANCH_MISMATCH")
    repo_secrets = names(snapshot.get("repository_secrets"), "secrets")
    repo_vars = names(snapshot.get("repository_variables"), "variables")
    require(not any(n.startswith("IAM_G2_") for n in set(repo_secrets) | set(repo_vars)),
            "INHERITED_G2_CREDENTIAL_OR_VARIABLE")
    envs = snapshot.get("environments")
    require(isinstance(envs, dict) and set(envs) == set(CONTRACT), "ENVIRONMENT_SET_MISMATCH")
    ids = [verify_environment(name, envs[name], approved_sha) for name in CONTRACT]
    require(len(set(ids)) == len(ids), "ENVIRONMENT_ID_COLLISION")
    return {"format": "iam-g2-environment-preflight/v1",
            "result": "PASS_METADATA_ONLY", "sha": approved_sha,
            "environment_ids": dict(zip(CONTRACT, ids)),
            "secret_values_verified": False, "credential_scope_at_provider_verified": False,
            "operational_approval_verified": False, "acquisition_authorized": False,
            "g3_authorized": False, "production_authorized": False}

class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def unique_object(pairs):
    obj = {}
    for k, v in pairs:
        require(k not in obj, "DUPLICATE_JSON_KEY")
        obj[k] = v
    return obj

def get(path, token):
    # Only fixed callers supply paths; GET only, no redirects and no raw response logs.
    req = request.Request(ROOT + path, method="GET", headers={
        "Authorization": "Bearer " + token, "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "iam-g2-metadata-only"})
    try:
        with request.build_opener(NoRedirect()).open(req, timeout=15) as resp:
            require(resp.status == 200 and not resp.headers.get("Link"), "API_RESPONSE_INCOMPLETE")
            raw = resp.read(LIMIT + 1)
            require(len(raw) <= LIMIT, "API_RESPONSE_TOO_LARGE")
            obj = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object)
            require(isinstance(obj, dict), "API_RESPONSE_INVALID")
            return obj
    except error.HTTPError as exc:
        raise Blocked("API_READ_HTTP_" + str(exc.code)) from None
    except (OSError, ValueError, UnicodeError):
        raise Blocked("API_READ_UNAVAILABLE") from None

def main_ref(token):
    ref = get("/git/ref/heads/main", token)
    require(ref.get("ref") == "refs/heads/main" and isinstance(ref.get("object"), dict) and
            ref["object"].get("type") == "commit", "MAIN_REF_UNATTESTED")
    return ref["object"].get("sha")

def live(approved_sha, token):
    require(os.environ.get("GITHUB_ACTIONS") == "true" and
            os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch" and
            os.environ.get("GITHUB_REPOSITORY") == REPO and
            os.environ.get("GITHUB_REF") == "refs/heads/main" and
            os.environ.get("GITHUB_SHA") == approved_sha and
            isinstance(approved_sha, str) and SHA.fullmatch(approved_sha) is not None,
            "TRUSTED_MAIN_DISPATCH_REQUIRED")
    require(bool(token), "METADATA_READ_TOKEN_MISSING")
    head = subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True,
                          text=True, timeout=5).stdout.strip()
    require(head == approved_sha, "CHECKOUT_SHA_MISMATCH")
    before = main_ref(token)
    require(before == approved_sha, "MAIN_SHA_CHANGED")
    snapshot = {"checkout_sha": head, "main_before": before, "repository": get("", token),
                "repository_secrets": get("/actions/secrets?per_page=100", token),
                "repository_variables": get("/actions/variables?per_page=100", token),
                "environments": {}}
    for name in CONTRACT:
        path = "/environments/" + name
        snapshot["environments"][name] = {
            "environment": get(path, token),
            "branches": get(path + "/deployment-branch-policies?per_page=100", token),
            "custom": get(path + "/deployment_protection_rules?per_page=100", token),
            "secrets": get(path + "/secrets?per_page=100", token),
            "variables": get(path + "/variables?per_page=100", token),
        }
    snapshot["main_after"] = main_ref(token)
    return verify(snapshot, approved_sha)

if __name__ == "__main__":
    try:
        require(len(sys.argv) == 2, "INVALID_USAGE")
        print(json.dumps(live(sys.argv[1], os.environ.get("GITHUB_TOKEN")), sort_keys=True))
    except Blocked as exc:
        print("BLOCKED_G2_ENVIRONMENT_PREFLIGHT " + str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("BLOCKED_G2_ENVIRONMENT_PREFLIGHT_UNVERIFIED", file=sys.stderr)
        sys.exit(2)
