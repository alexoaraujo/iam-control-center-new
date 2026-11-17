#!/usr/bin/env python3
"""Synthetic fail-closed contracts for PEOS single-maintainer environment setup."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

module_path = (Path(__file__).resolve().parents[2] / ".github" / "scripts"
               / "configure-iam-canonical-environment.py")
spec = importlib.util.spec_from_file_location("iam_env_config", module_path)
assert spec and spec.loader
config = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = config
spec.loader.exec_module(config)


def protected(*, reviewer=False, bypass=False, branch=True):
    return {
        "name": config.ENVIRONMENT,
        "can_admins_bypass": bypass,
        "deployment_branch_policy": {
            "protected_branches": not branch, "custom_branch_policies": branch,
        },
        "protection_rules": [{
            "type": "required_reviewers",
            "prevent_self_review": True,
            "reviewers": [{"type": "User", "reviewer": {"id": 123}}],
        }] if reviewer else [],
    }


class SingleMaintainerConfigTests(unittest.TestCase):
    def policies(self, *args, **kwargs):
        if "deployment-branch-policies" in args[1]:
            return {"branch_policies": [{"name": "main", "type": "branch"}]}
        return protected()

    def test_environment_accepts_no_reviewers_and_main_only(self):
        with patch.object(config, "gh_json", side_effect=self.policies):
            config.verify_environment()

    def test_environment_rejects_old_independent_reviewer_rule_and_admin_bypass(self):
        for settings in (protected(reviewer=True), protected(bypass=True),
                         protected(branch=False)):
            def reply(*args, **kwargs):
                if "deployment-branch-policies" in args[1]:
                    return {"branch_policies": [{"name": "main", "type": "branch"}]}
                return settings
            with patch.object(config, "gh_json", side_effect=reply):
                with self.assertRaises(RuntimeError):
                    config.verify_environment()

    def test_environment_rejects_extra_branch(self):
        def reply(*args, **kwargs):
            if "deployment-branch-policies" in args[1]:
                return {"branch_policies": [
                    {"name": "main", "type": "branch"},
                    {"name": "feature/*", "type": "branch"},
                ]}
            return protected()
        with patch.object(config, "gh_json", side_effect=reply):
            with self.assertRaisesRegex(RuntimeError, "main"):
                config.verify_environment()

    def test_maintainer_identity_and_admin_permission(self):
        def response(*args, **kwargs):
            endpoint = args[1]
            if endpoint.endswith("/permission"):
                return {"permission": "admin"}
            if endpoint == "user":
                return {"login": config.MAINTAINER, "id": 123}
            return {"default_branch": "main", "private": False}
        with patch.object(config, "gh_json", side_effect=response):
            config.verify_account_and_repo()
        for bad in (
            {"login": "other-person", "id": 123},
            {"login": config.MAINTAINER},
        ):
            with patch.object(config, "gh_json", side_effect=lambda *a, **k:
                              bad if a[1] == "user" else response(*a, **k)):
                with self.assertRaisesRegex(RuntimeError, "identity"):
                    config.verify_account_and_repo()
        with patch.object(config, "gh_json", side_effect=lambda *a, **k:
                          {"permission": "write"} if a[1].endswith("/permission")
                          else response(*a, **k)):
            with self.assertRaisesRegex(RuntimeError, "admin"):
                config.verify_account_and_repo()

    def test_put_policy_uses_no_required_reviewers_and_restricts_branches(self):
        calls = []
        def reply(*args, input_value=None):
            calls.append((args, input_value))
            return self.policies(*args, input_value=input_value)
        with patch.object(config, "gh_json", side_effect=reply):
            config.ensure_protected_environment()
        payloads = [json.loads(value) for _, value in calls if value is not None]
        self.assertEqual(payloads[0]["reviewers"], [])
        self.assertFalse(payloads[0]["prevent_self_review"])
        self.assertFalse(payloads[0]["can_admins_bypass"])
        self.assertTrue(payloads[0]["deployment_branch_policy"]["custom_branch_policies"])

    def test_configure_secret_streams_value_only_via_stdin(self):
        value = "synthetic_secret_NOT_FOR_LOGS"
        with patch.object(config, "gh") as mocked:
            config.set_environment_secret("IAM_CANONICAL_TARGET_URL", value)
        args, kwargs = mocked.call_args
        self.assertEqual(kwargs, {"input_value": value})
        self.assertNotIn(value, str(args))
        self.assertEqual(args[:2], ("secret", "set"))

    def test_unknown_secret_name_is_rejected(self):
        with patch.object(config, "gh") as mocked:
            with self.assertRaises(RuntimeError):
                config.set_environment_secret("DATABASE_URL", "synthetic")
            mocked.assert_not_called()

    def test_only_metadata_is_used_to_verify_secret_presence(self):
        with patch.object(config, "gh_json", return_value={"secrets": [
            {"name": name, "updated_at": "2026-11-17"} for name in config.SECRET_NAMES
        ]}):
            config.verify_secret_metadata()
        with patch.object(config, "gh_json", return_value={"secrets": []}):
            with self.assertRaisesRegex(RuntimeError, "secrets"):
                config.verify_secret_metadata()


if __name__ == "__main__":
    unittest.main()
