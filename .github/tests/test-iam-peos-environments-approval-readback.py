#!/usr/bin/env python3
"""No-secrets PEOS seven-environment synthetic policy checks."""
import importlib.util
import json
from pathlib import Path
from unittest import TestCase, main

p = Path(__file__).resolve().parents[1] / "scripts/iam-peos-environments-approval-readback.py"
spec = importlib.util.spec_from_file_location("peos_env", p)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def env(name):
    return {"name": name, "can_admins_bypass": False,
            "deployment_branch_policy": {
                "protected_branches": False, "custom_branch_policies": True
            }, "protection_rules": [{"type": "branch_policy"}]}

def custom():
    return {"total_count": 0, "custom_deployment_protection_rules": []}


def policies(name):
    names = (["main", "refs/pull/128/merge"] if name == "Preview"
             else [mod.EXACT_BRANCHES[name]])
    return {"total_count": len(names),
            "branch_policies": [{"name": n, "type": "branch"} for n in names]}

class Contracts(TestCase):
    def test_all_seven_names_pass_when_no_reviewers(self):
        self.assertEqual(len(mod.ENVIRONMENTS), 7)
        for name in mod.ENVIRONMENTS:
            mod.verify(name, env(name), custom(), policies(name))

    def test_required_reviewers_are_blocked_even_if_no_users_listed(self):
        for name in mod.ENVIRONMENTS:
            x = env(name)
            x["protection_rules"].append({"type": "required_reviewers", "reviewers": []})
            with self.assertRaisesRegex(mod.Blocked, "REQUIRED_HUMAN"):
                mod.verify(name, x, custom(), policies(name))

    def test_branch_and_bypass_cannot_be_disabled(self):
        for name in mod.ENVIRONMENTS:
            for case in ("bypass", "open_branch"):
                x = env(name)
                if case == "bypass":
                    x["can_admins_bypass"] = True
                else:
                    x["deployment_branch_policy"] = {}
                with self.assertRaises(mod.Blocked):
                    mod.verify(name, x, custom(), policies(name))

    def test_custom_rules_and_wait_timer_fail_closed(self):
        for name in mod.ENVIRONMENTS:
            with self.assertRaises(mod.Blocked):
                mod.verify(name, env(name), {"total_count": 1,
                            "custom_deployment_protection_rules": [{"id": 1}]}, policies(name))
            x = env(name)
            x["protection_rules"].append({"type": "wait_timer", "wait_timer": 10})
            with self.assertRaisesRegex(mod.Blocked, "WAIT_TIMER"):
                mod.verify(name, x, custom(), policies(name))

    def test_missing_metadata_is_not_pass(self):
        for name in mod.ENVIRONMENTS:
            with self.assertRaises(mod.Blocked):
                mod.verify(name, {}, custom(), policies(name))
            with self.assertRaises(mod.Blocked):
                mod.verify(name, env(name), {}, policies(name))


    def test_live_branch_policies_must_be_read_and_counted(self):
        for name in mod.ENVIRONMENTS:
            for payload in ({}, {"total_count": 0, "branch_policies": []},
                            {"total_count": 3, "branch_policies": policies(name)["branch_policies"]},
                            {"total_count": 101, "branch_policies": policies(name)["branch_policies"]}):
                with self.subTest(name=name, payload=payload), self.assertRaises(mod.Blocked):
                    mod.verify(name, env(name), custom(), payload)

    def test_privileged_environments_allow_only_the_exact_branch(self):
        self.assertEqual(set(mod.EXACT_BRANCHES), set(mod.ENVIRONMENTS) - {"Preview"})
        for name, expected in mod.EXACT_BRANCHES.items():
            for wrong in ("main" if expected != "main" else "develop",
                          "refs/pull/*/merge", "feature/*", "refs/pull/128/merge"):
                if wrong == expected:
                    continue
                with self.subTest(name=name, wrong=wrong), self.assertRaisesRegex(mod.Blocked, "NOT_ALLOWLISTED"):
                    mod.verify(name, env(name), custom(), {"total_count": 1,
                        "branch_policies": [{"name": wrong, "type": "branch"}]})
            data = policies(name)
            data["branch_policies"].append({"name": expected, "type": "branch"})
            data["total_count"] = 2
            with self.assertRaises(mod.Blocked):
                mod.verify(name, env(name), custom(), data)

    def test_preview_requires_specific_branch_refs_not_wildcards(self):
        for bad in ("refs/pull/*/merge", "*/merge", "refs/pull/*",
                    "refs/pull/45/merge,refs/pull/46/merge", "feature/*",
                    "refs/pull/128/head", "refs/pull/0/merge"):
            data = {"total_count": 2, "branch_policies": [
                {"name": "main", "type": "branch"}, {"name": bad, "type": "branch"}]}
            with self.subTest(bad=bad), self.assertRaisesRegex(mod.Blocked, "NOT_ALLOWLISTED"):
                mod.verify("Preview", env("Preview"), custom(), data)
        with self.assertRaisesRegex(mod.Blocked, "MAIN_BRANCH_NOT_PRESENT"):
            mod.verify("Preview", env("Preview"), custom(), {"total_count": 1,
                "branch_policies": [{"name": "refs/pull/128/merge", "type": "branch"}]})

    def test_tag_unknown_type_and_duplicates_are_blocked(self):
        for name in mod.ENVIRONMENTS:
            data = policies(name)
            data["branch_policies"][0]["type"] = "tag"
            with self.subTest(name=name, kind="tag"), self.assertRaisesRegex(mod.Blocked, "TYPE_INVALID"):
                mod.verify(name, env(name), custom(), data)
            data = policies(name)
            data["branch_policies"].append(dict(data["branch_policies"][0]))
            data["total_count"] += 1
            with self.subTest(name=name, kind="duplicate"), self.assertRaises(mod.Blocked):
                mod.verify(name, env(name), custom(), data)

    def test_nonsecret_policy_diagnostic_is_bounded_and_explicit(self):
        payload = {"total_count": 2, "applicationKey": "never-log-this",
                   "branch_policies": [
                       {"name": "refs/pull/*/merge", "type": "branch", "token": "never-log-this"},
                       {"name": "develop", "type": "branch"}]}
        snapshot = mod.branch_policy_diagnostic(payload)
        self.assertEqual(snapshot["total_count"], 2)
        self.assertEqual(snapshot["listed_count"], 2)
        self.assertEqual(snapshot["branch_policies"][0]["name"], "refs/pull/*/merge")
        self.assertEqual(snapshot["branch_policies"][1]["name"], "develop")
        self.assertNotIn("never-log-this", json.dumps(snapshot))

    def test_malformed_branch_names_never_inject_log_commands(self):
        snapshot = mod.branch_policy_diagnostic({"total_count": 101,
            "branch_policies": [{"name": "good", "type": "branch"}] * 100 +
                               [{"name": "evil" + chr(10) + "::error::inject", "type": "branch"}]})
        self.assertEqual(len(snapshot["branch_policies"]), 100)
        self.assertEqual(snapshot["listed_count"], 101)
        self.assertNotIn("inject", json.dumps(snapshot))
        for payload in (None, [], "bad"):
            self.assertEqual(mod.branch_policy_diagnostic(payload), {"status": "invalid_response"})
        snapshot = mod.branch_policy_diagnostic({"total_count": "secret",
            "branch_policies": [{"name": "name" + chr(10) + "::error::bad", "type": "unknown"}]})
        self.assertEqual(snapshot["total_count"], "<invalid>")
        self.assertEqual(snapshot["branch_policies"], [{"name": "<invalid>", "type": "<invalid>"}])

    def test_auth0_m2m_audit_is_manual_and_main_only(self):
        workflow = (Path(__file__).resolve().parents[1] /
                    "workflows/auth0-management-m2m-audit.yml").read_text(encoding="utf-8")
        self.assertEqual(mod.EXACT_BRANCHES["IAM-Audit-Development"], "main")
        self.assertIn("  workflow_dispatch:", workflow)
        self.assertNotIn("  push:", workflow)
        self.assertNotIn("  pull_request:", workflow)
        self.assertIn("github.ref == 'refs/heads/main'", workflow)
        self.assertIn("environment: IAM-Audit-Development", workflow)
        self.assertIn("scope: 'read:users'", workflow)
        self.assertIn("contents: read", workflow)

    def test_protected_branch_mode_cannot_skip_custom_policy_readback(self):
        for name in mod.ENVIRONMENTS:
            data = env(name)
            data["deployment_branch_policy"]["protected_branches"] = True
            with self.assertRaisesRegex(mod.Blocked, "CUSTOM_BRANCH"):
                mod.verify(name, data, custom(), policies(name))

if __name__ == "__main__":
    main(verbosity=2)
