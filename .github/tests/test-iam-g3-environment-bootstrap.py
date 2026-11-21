#!/usr/bin/env python3
"""Offline G3 admin Environment policy contracts: only trusted main is allowed."""
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
    return {"total_count": 1, "branch_policies": [
        {"name": "main", "type": "branch"}]}


def custom():
    return {"total_count": 0, "custom_deployment_protection_rules": []}


class MainOnlyG3EnvironmentContracts(TestCase):
    def test_only_main_branch_is_accepted(self):
        self.assertEqual(mod.PR_REF, "main")
        self.assertTrue(mod.policies_exact(exact()))
        self.assertTrue(mod.assert_environment(protected(), exact(), custom()))
        for bad in (
            {}, {"total_count": 0, "branch_policies": []},
            {"total_count": 1, "branch_policies": [
                {"name": "refs/heads/main", "type": "branch"}]},
            {"total_count": 1, "branch_policies": [
                {"name": "refs/pull/128/merge", "type": "branch"}]},
            {"total_count": 1, "branch_policies": [
                {"name": "refs/pull/*/merge", "type": "branch"}]},
            {"total_count": 2, "branch_policies": exact()["branch_policies"] * 2},
            {"total_count": 1, "branch_policies": [
                {"name": "main", "type": "tag"}]},
        ):
            with self.subTest(bad=str(bad)[:110]):
                self.assertFalse(mod.policies_exact(bad))
                with self.assertRaises(mod.GateBlocked):
                    mod.assert_environment(protected(), bad, custom())

    def test_admin_bypass_and_unknown_rules_fail_closed(self):
        for bad in (
            {**protected(), "can_admins_bypass": True},
            {**protected(), "can_admins_bypass": None},
            {**protected(), "protection_rules": []},
            {**protected(), "protection_rules": [{"type": "required_reviewers"}]},
            {**protected(), "protection_rules": [
                {"type": "branch_policy"}, {"type": "wait_timer", "wait_timer": 15}]},
            {**protected(), "deployment_branch_policy": {
                "protected_branches": True, "custom_branch_policies": True}},
        ):
            with self.subTest(bad=str(bad)[:110]), self.assertRaises(mod.GateBlocked):
                mod.assert_environment(bad, exact(), custom())
        with self.assertRaises(mod.GateBlocked):
            mod.assert_environment(protected(), exact(), {
                "total_count": 1, "custom_deployment_protection_rules": [{}]})

    def test_apply_never_mutates_or_reads_admin_or_secrets(self):
        for actions in ("true", "false"):
            with patch.dict(os.environ, {"GITHUB_ACTIONS": actions}), \
                 patch.object(mod, "gh_json") as gh, \
                 patch.object(mod.sys, "stdin", Mock(isatty=lambda: True)), \
                 self.assertRaisesRegex(mod.GateBlocked, "ADMIN_UI_AND_READBACK"):
                mod.apply()
            gh.assert_not_called()

    def test_verify_is_metadata_only_and_never_exposes_secrets(self):
        with patch.object(mod, "gh_json", side_effect=[
            protected(), exact(), custom()]) as gh, \
             contextlib.redirect_stdout(io.StringIO()) as output:
            mod.verify()
        self.assertEqual([c.args for c in gh.call_args_list],
                         [(mod.BASE,), (mod.POLICY_PATH,), (mod.CUSTOM_PATH,)])
        self.assertIn("PASS_G3_ADMIN_BYPASS_DISABLED_AND_MAIN_ONLY_REF",
                      output.getvalue())
        self.assertIn("G3_OWNER_SECRET=NOT_READ_NOT_PROVISIONED", output.getvalue())

    def test_approval_latch_cannot_override_safe_no_write_policy(self):
        with patch.object(sys, "argv", ["g3-bootstrap", "--mode", "apply",
                "--confirm", mod.CONFIRMATION]), \
             patch.object(mod, "gh_json") as gh, \
             contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(mod.main(), 2)
        gh.assert_not_called()


if __name__ == "__main__":
    main(verbosity=2)
