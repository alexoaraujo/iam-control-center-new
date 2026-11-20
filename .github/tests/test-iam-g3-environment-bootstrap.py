#!/usr/bin/env python3
"""Offline, non-secret contracts for the local GitHub G3 Environment hardener."""
import contextlib
import importlib.util
import io
import os
import sys
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import Mock, patch

source = Path(__file__).resolve().parents[1] / "scripts/iam-g3-environment-bootstrap.py"
spec = importlib.util.spec_from_file_location("g3_env_bootstrap", source)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def unprotected():
    return {
        "name": mod.ENVIRONMENT,
        "can_admins_bypass": True,
        "deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": False,
        },
        "protection_rules": [],
    }

def protected():
    return {
        "name": mod.ENVIRONMENT,
        "can_admins_bypass": False,
        "deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": True,
        },
        "protection_rules": [{"type": "branch_policy"}],
    }

def exact():
    return {
        "total_count": 1,
        "branch_policies": [{"name": mod.PR_REF, "type": "branch"}],
    }

def empty():
    return {"total_count": 0, "branch_policies": []}

def custom():
    return {"total_count": 0, "custom_deployment_protection_rules": []}

class G3EnvironmentBootstrapContracts(TestCase):
    def test_exclusive_pr128_branch_rule_and_reject_all_other_refs(self):
        self.assertTrue(mod.policies_exact(exact()))
        for bad in (empty(), {}, None, {"total_count": 1,
                     "branch_policies": [{"name": "main", "type": "branch"}]},
                    {"total_count": 1,
                     "branch_policies": [{"name": "refs/pull/*/merge", "type": "branch"}]},
                    {"total_count": 2,
                     "branch_policies": exact()["branch_policies"] * 2}):
            with self.subTest(bad=str(bad)[:100]):
                self.assertFalse(mod.policies_exact(bad))

    def test_requires_real_admin_bypass_disabled_custom_ref_and_no_untrusted_rules(self):
        self.assertTrue(mod.assert_environment(protected(), exact(), custom()))
        for broken in (
            unprotected(),
            {**protected(), "can_admins_bypass": None},
            {**protected(), "protection_rules": []},
            {**protected(), "protection_rules": [{"type": "required_reviewers"}]},
            {**protected(), "protection_rules": [
                {"type": "branch_policy"}, {"type": "wait_timer", "wait_timer": 15}]},
            {**protected(), "deployment_branch_policy": {
                "protected_branches": True, "custom_branch_policies": True}},
        ):
            with self.subTest(bad=str(broken)[:130]), self.assertRaises(mod.GateBlocked):
                mod.assert_environment(broken, exact(), custom())
        with self.assertRaises(mod.GateBlocked):
            mod.assert_environment(protected(), exact(), {
                "total_count": 1, "custom_deployment_protection_rules": [{}]})

    def test_never_mutates_in_ci_or_noninteractive_context(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), \
             patch.object(mod, "gh_json") as call, self.assertRaisesRegex(
                 mod.GateBlocked, "LOCAL_INTERACTIVE"):
            mod.apply()
        call.assert_not_called()
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), \
             patch.object(mod.sys, "stdin", Mock(isatty=lambda: False)), \
             patch.object(mod, "gh_json") as call, self.assertRaisesRegex(
                 mod.GateBlocked, "LOCAL_INTERACTIVE"):
            mod.apply()
        call.assert_not_called()

    def test_existing_only_apply_sets_policy_without_secrets_or_workflow_dispatch(self):
        answers = [
            {"full_name": mod.REPOSITORY, "default_branch": "main"},
            {"login": mod.MAINTAINER},
            {"permission": "admin"},
            unprotected(),
            {"name": mod.ENVIRONMENT},
            empty(),
            {"name": mod.PR_REF},
            protected(),
            exact(),
            custom(),
        ]
        output = io.StringIO()
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), \
             patch.object(mod.sys, "stdin", Mock(isatty=lambda: True)), \
             patch.object(mod, "gh_json", side_effect=answers) as called, \
             contextlib.redirect_stdout(output):
            mod.apply()
        args = [c.args for c in called.call_args_list]
        self.assertEqual(len(args), 10)
        self.assertEqual(args[3], (mod.BASE,))
        self.assertEqual(args[4][:3], ("-X", "PUT", mod.BASE))
        self.assertEqual(args[5], (mod.POLICY_PATH,))
        self.assertEqual(args[6][:3], ("-X", "POST",
                                       mod.BASE + "/deployment-branch-policies"))
        self.assertEqual(called.call_args_list[4].kwargs["payload"][
            "deployment_branch_policy"]["custom_branch_policies"], True)
        self.assertIs(called.call_args_list[4].kwargs["payload"]["can_admins_bypass"], False)
        self.assertEqual(called.call_args_list[6].kwargs["payload"],
                         {"name": mod.PR_REF, "type": "branch"})
        self.assertTrue(all("/secrets" not in str(x).lower()
                            and "/variables" not in str(x).lower()
                            for x in args))
        self.assertIn("PASS_G3_ADMIN_READBACK_EXISTING_ENV_ONLY", output.getvalue())
        self.assertIn("G3_OWNER_SECRET=NOT_READ_NOT_PROVISIONED", output.getvalue())

    def test_does_not_replace_existing_unexpected_branch_rules(self):
        existing = protected()
        conflicting = {"total_count": 1, "branch_policies": [
            {"name": "refs/pull/132/merge", "type": "branch"}]}
        answers = [
            {"full_name": mod.REPOSITORY, "default_branch": "main"},
            {"login": mod.MAINTAINER},
            {"permission": "admin"},
            existing,
            conflicting,
        ]
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), \
             patch.object(mod.sys, "stdin", Mock(isatty=lambda: True)), \
             patch.object(mod, "gh_json", side_effect=answers) as call, \
             self.assertRaisesRegex(mod.GateBlocked, "NOT_SAFE_TO_REPLACE"):
            mod.apply()
        self.assertFalse(any(c.args[:2] == ("-X", "PUT") for c in call.call_args_list))

    def test_does_not_create_if_environment_not_present(self):
        answers = [
            {"full_name": mod.REPOSITORY, "default_branch": "main"},
            {"login": mod.MAINTAINER},
            {"permission": "admin"},
            {"name": "different-environment"},
        ]
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), \
             patch.object(mod.sys, "stdin", Mock(isatty=lambda: True)), \
             patch.object(mod, "gh_json", side_effect=answers) as call, \
             self.assertRaisesRegex(mod.GateBlocked, "EXISTING_G3_ENVIRONMENT_NOT_FOUND"):
            mod.apply()
        self.assertFalse(any(c.args[:2] == ("-X", "PUT") for c in call.call_args_list))

    def test_approval_latch_blocks_apply_before_any_api_call(self):
        with patch.object(sys, "argv", ["g3-bootstrap", "--mode", "apply"]), \
             patch.object(mod, "gh_json") as call, \
             contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mod.main(), 2)
        call.assert_not_called()

if __name__ == "__main__":
    main(verbosity=2)
