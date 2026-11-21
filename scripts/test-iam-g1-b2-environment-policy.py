#!/usr/bin/env python3
"""Offline integration tests for the IAM-G1 environment fail-closed guard.

No GitHub API calls, no Backblaze calls, and no credentials are used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("iam-g1-b2-environment.sh")
MOCK_GH = '''#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
if args[:2] == ["auth", "status"]:
    sys.exit(0)
if args and args[0] == "api":
    if "--method" in args:
        with open(os.environ["FAKE_GH_WRITE_LOG"], "a") as fh:
            fh.write("api-write\\n")
        sys.exit(90)
    if any("deployment-branch-policies?" in x for x in args):
        print(os.environ["FAKE_GH_POLICIES"])
    else:
        print(os.environ["FAKE_GH_ENV"])
    sys.exit(0)
if args[:2] == ["secret", "list"]:
    print("IAM_G1_B2_ACCESS_KEY_ID\\nIAM_G1_B2_SECRET_ACCESS_KEY")
    sys.exit(0)
if args[:2] == ["variable", "list"]:
    print(os.environ["FAKE_GH_VARIABLES"])
    sys.exit(0)
with open(os.environ["FAKE_GH_WRITE_LOG"], "a") as fh:
    fh.write("unexpected-write\\n")
sys.exit(91)
'''

BUCKET = "iam-control-center-g1-backups"
ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
REGION = "us-east-005"


@unittest.skipUnless(shutil.which("jq"), "jq is required")
class EnvironmentGateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        gh = Path(self.tmp.name, "gh")
        gh.write_text(MOCK_GH, encoding="utf-8")
        gh.chmod(0o700)
        self.log = Path(self.tmp.name, "writes.log")
        self.env_data = {
            "deployment_branch_policy": {
                "protected_branches": False,
                "custom_branch_policies": True,
            },
            "can_admins_bypass": False,
            "protection_rules": [
                {
                    "type": "required_reviewers",
                    "prevent_self_review": True,
                    "reviewers": [{"type": "User", "reviewer": {"login": "independent-reviewer"}}],
                }
            ],
        }
        self.policies = {
            "total_count": 1,
            "branch_policies": [{"name": "main", "type": "branch"}],
        }

    def run_guard(self, mode="audit"):
        env = dict(os.environ)
        env["PATH"] = self.tmp.name + os.pathsep + env.get("PATH", "")
        env["FAKE_GH_ENV"] = json.dumps(self.env_data)
        env["FAKE_GH_POLICIES"] = json.dumps(self.policies)
        env["FAKE_GH_VARIABLES"] = json.dumps([
            {"name": "IAM_G1_B2_BUCKET", "value": BUCKET},
            {"name": "IAM_G1_B2_ENDPOINT", "value": ENDPOINT},
            {"name": "IAM_G1_B2_REGION", "value": REGION},
        ])
        env["FAKE_GH_WRITE_LOG"] = str(self.log)
        return subprocess.run(["bash", str(SCRIPT), mode],
                              env=env, capture_output=True, text=True, timeout=10)

    def test_valid_environment_audits_without_network_or_secrets(self):
        result = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("PASS_ENVIRONMENT_PROTECTIONS", result.stdout)
        self.assertIn("PASS_ENV_VARIABLE: IAM_G1_B2_REGION", result.stdout)
        self.assertFalse(self.log.exists())

    def test_tag_named_main_is_not_branch_main(self):
        self.policies["branch_policies"][0]["type"] = "tag"
        result = self.run_guard("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BLOCKED_ENVIRONMENT_BRANCH_POLICY", result.stderr)
        self.assertFalse(self.log.exists())

    def test_admin_bypass_cannot_be_enabled(self):
        self.env_data["can_admins_bypass"] = True
        result = self.run_guard("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BLOCKED_ADMIN_BYPASS", result.stderr)
        self.assertFalse(self.log.exists())

    def test_missing_admin_bypass_field_is_rejected(self):
        del self.env_data["can_admins_bypass"]
        result = self.run_guard("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BLOCKED_ADMIN_BYPASS", result.stderr)
        self.assertFalse(self.log.exists())

    def test_self_review_is_rejected(self):
        self.env_data["protection_rules"][0]["prevent_self_review"] = False
        result = self.run_guard("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BLOCKED_INDEPENDENT_REVIEW", result.stderr)
        self.assertFalse(self.log.exists())

    def test_second_branch_policy_is_rejected(self):
        self.policies["total_count"] = 2
        self.policies["branch_policies"].append({"name": "release/*", "type": "branch"})
        result = self.run_guard("apply")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("BLOCKED_ENVIRONMENT_BRANCH_POLICY", result.stderr)
        self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
