#!/usr/bin/env python3
"""Offline fail-closed contract for secure local environment provisioning."""
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

def protected(review_id=325264810, *, allow=("main",), self_review=True):
    return {
        "name": config.ENVIRONMENT,
        "deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": True
        },
        "protection_rules": [{
            "type": "required_reviewers",
            "prevent_self_review": self_review,
            "reviewers": [{
                "type": "User", "reviewer": {"id": review_id}
            }]
        }],
    }

class SecureConfigTests(unittest.TestCase):
    def test_protected_environment_requires_exact_reviewer_main_and_no_self_review(self):
        review_id = 654321
        def okay(*args, **kwargs):
            if "deployment-branch-policies" in args[1]:
                return {"branch_policies": [{"name": "main", "type": "branch"}]}
            return protected(review_id)
        with patch.object(config, "gh_json", side_effect=okay):
            config.verify_environment(review_id)
        def badextra(*args, **kwargs):
            if "deployment-branch-policies" in args[1]:
                return {"branch_policies": [{"name": "main", "type": "branch"},
                                           {"name": "staging", "type": "branch"}]}
            return protected(review_id)
        with patch.object(config, "gh_json", side_effect=badextra):
            with self.assertRaisesRegex(RuntimeError, "main"):
                config.verify_environment(review_id)
        with patch.object(config, "gh_json", return_value=protected(review_id, self_review=False)):
            with self.assertRaisesRegex(RuntimeError, "self-review"):
                config.verify_environment(review_id)
        with patch.object(config, "gh_json", return_value=protected(111)):
            with self.assertRaises(RuntimeError):
                config.verify_environment(review_id)

    def test_configure_policy_uses_exact_required_reviewer_and_only_main(self):
        calls = []
        def reply(*args, input_value=None):
            calls.append((args, input_value))
            if "deployment-branch-policies" in args[1]:
                return {"branch_policies": [{"name": "main", "type": "branch"}]}
            return protected(77)
        with patch.object(config, "gh_json", side_effect=reply):
            config.ensure_protected_environment(77)
        payloads = [json.loads(value) for _, value in calls if value is not None]
        self.assertEqual(payloads[0]["reviewers"], [{"type":"User","id":77}])
        self.assertTrue(payloads[0]["prevent_self_review"])
        self.assertTrue(payloads[0]["deployment_branch_policy"]["custom_branch_policies"])

    def test_configure_secret_streams_value_only_via_stdin(self):
        value = "synthetic_secret_NOT_FOR_LOGS"
        with patch.object(config, "gh") as mock:
            config.set_environment_secret("IAM_CANONICAL_TARGET_URL", value)
        args, kwargs = mock.call_args
        self.assertEqual(kwargs, {"input_value": value})
        self.assertNotIn(value, str(args))
        self.assertEqual(args[0], "secret")
        self.assertEqual(args[1], "set")
        self.assertIn("--env", args)

    def test_unknown_secret_name_is_rejected(self):
        with patch.object(config, "gh") as mock:
            with self.assertRaises(RuntimeError):
                config.set_environment_secret("DATABASE_URL", "synthetic")
            mock.assert_not_called()

    def test_only_metadata_is_used_to_verify_secret_presence(self):
        with patch.object(config, "gh_json", return_value={"secrets": [
            {"name": name, "updated_at": "2026-11-13"} for name in config.SECRET_NAMES
        ]}):
            config.verify_secret_metadata()
        with patch.object(config, "gh_json", return_value={"secrets": []}):
            with self.assertRaisesRegex(RuntimeError, "secrets"):
                config.verify_secret_metadata()

if __name__ == "__main__":
    unittest.main()
