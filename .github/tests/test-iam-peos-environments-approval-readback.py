#!/usr/bin/env python3
"""No-secrets PEOS seven-environment synthetic policy checks."""
import importlib.util
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

class Contracts(TestCase):
    def test_all_seven_names_pass_when_no_reviewers(self):
        self.assertEqual(len(mod.ENVIRONMENTS), 7)
        for name in mod.ENVIRONMENTS:
            mod.verify(name, env(name), custom())

    def test_required_reviewers_are_blocked_even_if_no_users_listed(self):
        for name in mod.ENVIRONMENTS:
            x = env(name)
            x["protection_rules"].append({"type": "required_reviewers", "reviewers": []})
            with self.assertRaisesRegex(mod.Blocked, "REQUIRED_HUMAN"):
                mod.verify(name, x, custom())

    def test_branch_and_bypass_cannot_be_disabled(self):
        for name in mod.ENVIRONMENTS:
            for case in ("bypass", "open_branch"):
                x = env(name)
                if case == "bypass":
                    x["can_admins_bypass"] = True
                else:
                    x["deployment_branch_policy"] = {}
                with self.assertRaises(mod.Blocked):
                    mod.verify(name, x, custom())

    def test_custom_rules_and_wait_timer_fail_closed(self):
        for name in mod.ENVIRONMENTS:
            with self.assertRaises(mod.Blocked):
                mod.verify(name, env(name), {"total_count": 1,
                            "custom_deployment_protection_rules": [{"id": 1}]})
            x = env(name)
            x["protection_rules"].append({"type": "wait_timer", "wait_timer": 10})
            with self.assertRaisesRegex(mod.Blocked, "WAIT_TIMER"):
                mod.verify(name, x, custom())

    def test_missing_metadata_is_not_pass(self):
        for name in mod.ENVIRONMENTS:
            with self.assertRaises(mod.Blocked):
                mod.verify(name, {}, custom())
            with self.assertRaises(mod.Blocked):
                mod.verify(name, env(name), {})

if __name__ == "__main__":
    main(verbosity=2)
