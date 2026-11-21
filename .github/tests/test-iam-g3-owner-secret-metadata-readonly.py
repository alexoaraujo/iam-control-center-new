#!/usr/bin/env python3
"""Offline checks. Real GitHub metadata is only read in a local admin terminal."""
import contextlib
import importlib.util
import io
import os
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

p = Path(__file__).resolve().parents[1] / "scripts/iam-g3-owner-secret-metadata-readonly.py"
spec = importlib.util.spec_from_file_location("g3_owner_metadata", p)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
SHA = "26ab7ef917141531b7b9d496d07066ddfa3bb625"


def valid():
    actor = {"login": mod.MAINTAINER}
    perm = {"permission": "admin"}
    pr = {"number": 128, "state": "open",
          "head": {"sha": SHA, "ref": mod.PR_BRANCH, "repo": {"full_name": mod.REPO}},
          "base": {"ref": "main"}}
    env = {"name": mod.ENV, "can_admins_bypass": False,
           "deployment_branch_policy": {
               "protected_branches": False, "custom_branch_policies": True},
           "protection_rules": [{"type": "branch_policy"}]}
    policies = {"total_count": 1,
                "branch_policies": [{"name": mod.EXACT_REF, "type": "branch"}]}
    custom = {"total_count": 0, "custom_deployment_protection_rules": []}
    metadata = {"total_count": 1, "secrets": [{"name": mod.SECRET, "value": "NO_VALUES"}]}
    var = {"name": mod.SHA_VAR, "value": SHA}
    return actor, perm, pr, env, policies, custom, metadata, var


class G3OwnerMetadataContracts(TestCase):
    def test_passes_only_for_exact_environment_secret_name_and_head_sha(self):
        self.assertEqual(mod.inspect(*valid()), (SHA, 1))

    def test_blocks_missing_owner_secret(self):
        data = list(valid())
        data[6] = {"total_count": 0, "secrets": []}
        with self.assertRaisesRegex(mod.Blocked, "NAME_NOT_FOUND"):
            mod.inspect(*data)

    def test_blocks_wrong_approved_sha_or_missing_variable(self):
        for var in ({"name": mod.SHA_VAR, "value": "a" * 40},
                    {"name": mod.SHA_VAR, "value": "not-a-sha"}, {},
                    {"name": "other", "value": SHA}):
            data = list(valid())
            data[7] = var
            with self.subTest(var=var), self.assertRaises(mod.Blocked):
                mod.inspect(*data)

    def test_blocks_bypass_wildcards_bad_sources_and_reviewers(self):
        for index, patch_value in (
            (0, {"login": "attacker"}),
            (1, {"permission": "write"}),
            (2, {**valid()[2], "state": "closed"}),
            (3, {**valid()[3], "can_admins_bypass": True}),
            (3, {**valid()[3], "protection_rules": [{"type": "required_reviewers"}]}),
            (4, {"total_count": 1, "branch_policies": [
                {"name": "refs/pull/*/merge", "type": "branch"}]}),
            (5, {"total_count": 1, "custom_deployment_protection_rules": [{}]}),
        ):
            data = list(valid())
            data[index] = patch_value
            with self.subTest(index=index), self.assertRaises(mod.Blocked):
                mod.inspect(*data)

    def test_blocks_unbounded_secret_list_and_bad_pr_head(self):
        for count, names in ((101, []), (2, [{"name": mod.SECRET}])):
            data = list(valid())
            data[6] = {"total_count": count, "secrets": names}
            with self.assertRaises(mod.Blocked):
                mod.inspect(*data)
        data = list(valid())
        data[2]["head"]["sha"] = "b" * 40
        with self.assertRaisesRegex(mod.Blocked, "APPROVED_SHA_NOT_EXACT_PR_HEAD"):
            mod.inspect(*data)

    def test_ci_never_calls_admin_api(self):
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}), \\
             patch.object(mod, "gh_api") as q, self.assertRaisesRegex(
                 mod.Blocked, "LOCAL_ADMIN_TERMINAL"):
            mod.run()
        q.assert_not_called()

    def test_local_mock_prints_no_secret_values_or_false_operational_pass(self):
        output = io.StringIO()
        with patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), \\
             patch.object(mod, "gh_api", side_effect=valid()) as call, \\
             contextlib.redirect_stdout(output):
            mod.run()
        self.assertEqual(call.call_count, 8)
        for word in ("NO_VALUES", "neondb_owner", "postgresql://"):
            self.assertNotIn(word, output.getvalue())
        self.assertIn("G3_OWNER_SECRET_VALUE_AND_NEON_ROLE_NOT_VERIFIED", output.getvalue())
        self.assertIn("G3_WORKFLOW_SOURCE_TRUST=NOT_ATTESTED", output.getvalue())


if __name__ == "__main__":
    main(verbosity=2)
