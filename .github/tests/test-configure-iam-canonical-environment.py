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
        "can_admins_bypass": False,
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
        self.assertIs(payloads[0]["can_admins_bypass"], False)
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

    def test_target_only_writes_only_missing_target_and_preserves_source_approval(self):
        from unittest.mock import MagicMock
        url = ("postgresql://neondb_owner:synthetic_password"
               "@ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech:5432"
               "/iam_canonical_validation?sslmode=verify-full&sslrootcert=system")
        before = {"IAM_CANONICAL_SOURCE_URL", "IAM_CANONICAL_OPERATOR_APPROVAL"}
        with patch.object(config, "verify_environment") as gate, \
             patch.object(config, "present_secret_names",
                          side_effect=[before, {*before, "IAM_CANONICAL_TARGET_URL"}]), \
             patch.object(config, "set_environment_secret") as write, \
             patch.object(config.getpass, "getpass", return_value=url), \
             patch.object(config.sys, "stdin", MagicMock(isatty=lambda: True)):
            config.sync_target_only(77)
        write.assert_called_once_with("IAM_CANONICAL_TARGET_URL", url)
        self.assertEqual(gate.call_count, 2)

    def test_target_only_never_overwrites_existing_secret_even_if_value_unknown(self):
        before = set(config.SECRET_NAMES)
        with patch.object(config, "verify_environment"), \
             patch.object(config, "present_secret_names", return_value=before), \
             patch.object(config, "set_environment_secret") as write, \
             patch.object(config.getpass, "getpass") as prompt:
            config.sync_target_only(77)
        write.assert_not_called()
        prompt.assert_not_called()

    def test_target_only_blocks_missing_source_or_approval_metadata(self):
        for present in [
            {"IAM_CANONICAL_SOURCE_URL"},
            {"IAM_CANONICAL_OPERATOR_APPROVAL"},
            set(),
        ]:
            with self.subTest(present=present), \
                 patch.object(config, "verify_environment"), \
                 patch.object(config, "present_secret_names", return_value=present), \
                 patch.object(config, "set_environment_secret") as write, \
                 patch.object(config.getpass, "getpass") as prompt:
                with self.assertRaisesRegex(RuntimeError, "source/approval"):
                    config.sync_target_only(77)
                write.assert_not_called()
                prompt.assert_not_called()

    def test_target_only_rejects_wrong_db_role_tls_and_pooler_before_secret_write(self):
        from unittest.mock import MagicMock
        base = ("postgresql://neondb_owner:synthetic_password"
                "@ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech:5432"
                "/iam_canonical_validation?sslmode=verify-full&sslrootcert=system")
        candidates = [
            base.replace("iam_canonical_validation", "iam_database"),
            base.replace("neondb_owner:", "iam_app_runtime_login:"),
            base.replace("verify-full", "require"),
            base.replace("ep-crimson-smoke-", "ep-crimson-smoke-pooler-"),
        ]
        before = {"IAM_CANONICAL_SOURCE_URL", "IAM_CANONICAL_OPERATOR_APPROVAL"}
        for value in candidates:
            with self.subTest(value=value.replace("synthetic_password", "***")), \
                 patch.object(config, "verify_environment"), \
                 patch.object(config, "present_secret_names", return_value=before), \
                 patch.object(config, "set_environment_secret") as write, \
                 patch.object(config.getpass, "getpass", return_value=value), \
                 patch.object(config.sys, "stdin", MagicMock(isatty=lambda: True)):
                with self.assertRaisesRegex(RuntimeError, "target URL allowlist"):
                    config.sync_target_only(77)
                write.assert_not_called()

    def test_target_only_rejects_noninteractive_invocations(self):
        from unittest.mock import MagicMock
        before = {"IAM_CANONICAL_SOURCE_URL", "IAM_CANONICAL_OPERATOR_APPROVAL"}
        with patch.object(config, "verify_environment"), \
             patch.object(config, "present_secret_names", return_value=before), \
             patch.object(config, "set_environment_secret") as write, \
             patch.object(config.getpass, "getpass") as prompt, \
             patch.object(config.sys, "stdin", MagicMock(isatty=lambda: False)):
            with self.assertRaisesRegex(RuntimeError, "interactive"):
                config.sync_target_only(77)
            write.assert_not_called()
            prompt.assert_not_called()

    def test_verify_only_does_not_mutate_environment_or_secrets(self):
        with patch.object(config.sys, "argv", ["script.py", "--verify-only"]), \
             patch.object(config, "verify_account_and_repo", return_value=77), \
             patch.object(config, "verify_environment") as gate, \
             patch.object(config, "verify_secret_metadata") as metadata, \
             patch.object(config, "ensure_protected_environment") as mutate, \
             patch.object(config, "set_environment_secret") as write:
            self.assertEqual(config.main(), 0)
        gate.assert_called_once_with(77)
        metadata.assert_called_once()
        mutate.assert_not_called()
        write.assert_not_called()

    def test_environment_admin_bypass_is_explicitly_forbidden(self):
        compromised = protected(77)
        compromised["can_admins_bypass"] = True
        with patch.object(config, "gh_json", return_value=compromised):
            with self.assertRaisesRegex(RuntimeError, "administrator bypass"):
                config.verify_environment(77)

    def test_protect_only_updates_policy_not_existing_secrets(self):
        with patch.object(config.sys, "argv", ["script.py", "--protect-only"]), \
             patch.object(config, "verify_account_and_repo", return_value=77), \
             patch.object(config, "ensure_protected_environment") as protect, \
             patch.object(config, "verify_secret_metadata") as metadata, \
             patch.object(config, "set_environment_secret") as write, \
             patch.object(config.getpass, "getpass") as prompt:
            self.assertEqual(config.main(), 0)
        protect.assert_called_once_with(77)
        metadata.assert_called_once()
        write.assert_not_called()
        prompt.assert_not_called()

if __name__ == "__main__":
    unittest.main()
