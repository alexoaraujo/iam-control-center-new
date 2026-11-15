#!/usr/bin/env python3
"""Contract tests for metadata-only IAM G1 GitHub environment attestation."""
import importlib.util
from pathlib import Path
from unittest import TestCase, main

file = Path(__file__).resolve().parents[1] / "scripts/iam-g1-environment-readonly-attestation.py"
spec = importlib.util.spec_from_file_location("g1_env_readonly", file)
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)


def env(name):
    return {
        "name": name,
        "can_admins_bypass": False,
        "deployment_branch_policy": {
            "protected_branches": False,
            "custom_branch_policies": True,
        },
        "protection_rules": [
            {"type": "required_reviewers", "prevent_self_review": True,
             "reviewers": [{"type": "User", "reviewer": {"login": target.REVIEWER}}]},
            {"type": "branch_policy"},
        ],
    }


def policies(name):
    return {"total_count": 1, "branch_policies": [
        {"name": target.ENVS[name], "type": "branch"}
    ]}


class Contracts(TestCase):
    def test_both_envs_pass(self):
        for name in target.ENVS:
            target.verify_configuration(name, env(name), policies(name))

    def test_enabled_or_missing_admin_bypass_fails(self):
        for name in target.ENVS:
            for value in (True, None):
                data = env(name)
                if value is None:
                    data.pop("can_admins_bypass")
                else:
                    data["can_admins_bypass"] = value
                with self.assertRaisesRegex(target.GateBlocked, "ADMIN_BYPASS"):
                    target.verify_configuration(name, data, policies(name))

    def test_reviewers_and_self_review_mismatch_fail(self):
        for name in target.ENVS:
            for defect in ("no_review", "wrong_review", "self_review"):
                data = env(name)
                rule = data["protection_rules"][0]
                if defect == "no_review":
                    data["protection_rules"].pop(0)
                elif defect == "wrong_review":
                    rule["reviewers"][0]["reviewer"]["login"] = "alexoaraujo"
                else:
                    rule["prevent_self_review"] = False
                with self.assertRaises(target.GateBlocked):
                    target.verify_configuration(name, data, policies(name))

    def test_custom_rule_and_wait_timer_fail(self):
        for name in target.ENVS:
            for rule in ({"type": "integration_protection_rule"},
                         {"type": "wait_timer", "wait_timer": 2}):
                data = env(name)
                data["protection_rules"].append(rule)
                with self.assertRaises(target.GateBlocked):
                    target.verify_configuration(name, data, policies(name))

    def test_branch_pattern_or_type_drift_fails(self):
        for name in target.ENVS:
            for invalid in ("*", "main", "audit/*", target.ENVS[name] + "X"):
                if invalid == target.ENVS[name]:
                    continue
                x = policies(name)
                x["branch_policies"][0]["name"] = invalid
                with self.assertRaises(target.GateBlocked):
                    target.verify_configuration(name, env(name), x)
            x = policies(name)
            x["branch_policies"][0]["type"] = "tag"
            with self.assertRaises(target.GateBlocked):
                target.verify_configuration(name, env(name), x)
            x = policies(name)
            x["total_count"] = 2
            with self.assertRaises(target.GateBlocked):
                target.verify_configuration(name, env(name), x)

    def test_missing_custom_branch_mode_fails(self):
        for name in target.ENVS:
            data = env(name)
            data["deployment_branch_policy"]["custom_branch_policies"] = False
            with self.assertRaises(target.GateBlocked):
                target.verify_configuration(name, data, policies(name))


if __name__ == "__main__":
    main(verbosity=2)
