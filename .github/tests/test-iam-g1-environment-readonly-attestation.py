#!/usr/bin/env python3
"""Contract tests for metadata-only IAM G1 GitHub environment attestation."""
import importlib.util
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr
from io import StringIO
import os
from urllib.error import HTTPError

file = Path(__file__).resolve().parents[1] / "scripts/iam-g1-environment-readonly-attestation.py"
spec = importlib.util.spec_from_file_location("g1_env_readonly", file)
target = importlib.util.module_from_spec(spec)
spec.loader.exec_module(target)


def env(name):
    return {
        "name": name,
        "id": 100 + list(target.ENVS).index(name),
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


def custom():
    return {"total_count": 0, "custom_deployment_protection_rules": []}


class Contracts(TestCase):
    def test_expected_five_environments(self):
        self.assertEqual(
            {
                "IAM-G1-Disposable-Lease-Revocation": "main",
                "IAM-G1-Disposable-Lease-Probe": "audit/iam-g1-lease-schema-probe-20261115",
                "IAM-G1-Full-Backup-Custody": "main",
                "IAM-G1-B2-Full-Readback-Custody": "main",
                "IAM-G1-Full-Restore-Custody": "main",
            },
            target.ENVS,
        )

    def test_http_errors_are_sanitized_and_scoped(self):
        for path, stage in [
            ("/IAM-G1-Full-Backup-Custody", "ENVIRONMENT"),
            ("/IAM-G1-Full-Backup-Custody/deployment-branch-policies?per_page=100", "BRANCH_POLICIES"),
            ("/IAM-G1-Full-Backup-Custody/deployment_protection_rules", "CUSTOM_RULES"),
        ]:
            for status, outcome in [(401, "UNAUTHORIZED"), (403, "FORBIDDEN"),
                                    (404, "NOT_FOUND_OR_INACCESSIBLE"), (429, "RATE_LIMITED"),
                                    (500, "OTHER")]:
                failure = HTTPError("https://example.invalid/opaque", status, "private", None, None)
                with patch.object(target.urllib.request, "urlopen", side_effect=failure):
                    with self.assertRaises(target.GateBlocked) as result:
                        target.get_json(path, "opaque-test-token")
                self.assertEqual(
                    "GITHUB_ENVIRONMENT_API_" + stage + "_" + outcome,
                    str(result.exception),
                )
                self.assertNotIn("opaque-test-token", str(result.exception))

    def test_both_envs_pass(self):
        for name in target.ENVS:
            self.assertEqual("INDEPENDENT_REVIEWER",
                             target.verify_configuration(name, env(name), policies(name), custom()))

    def test_solo_no_required_reviewers_is_metadata_only(self):
        for name in target.ENVS:
            data = env(name)
            data["protection_rules"].pop(0)
            self.assertEqual("SOLO_NO_REQUIRED_REVIEWER",
                             target.verify_configuration(name, data, policies(name), custom()))
            # Solo does not excuse admin bypass or an unscoped branch pattern.
            data["can_admins_bypass"] = True
            with self.assertRaisesRegex(target.GateBlocked, "ADMIN_BYPASS"):
                target.verify_configuration(name, data, policies(name), custom())
            data["can_admins_bypass"] = False
            broad = policies(name)
            broad["branch_policies"][0]["name"] = "*"
            with self.assertRaisesRegex(target.GateBlocked, "DEPLOYMENT_BRANCH_PATTERN"):
                target.verify_configuration(name, data, broad, custom())

    def test_duplicate_reviewer_rules_fail(self):
        for name in target.ENVS:
            data = env(name)
            data["protection_rules"].insert(0, data["protection_rules"][0].copy())
            with self.assertRaisesRegex(target.GateBlocked, "DUPLICATE_REQUIRED_REVIEWER"):
                target.verify_configuration(name, data, policies(name), custom())

    def test_enabled_or_missing_admin_bypass_fails(self):
        for name in target.ENVS:
            for value in (True, None):
                data = env(name)
                if value is None:
                    data.pop("can_admins_bypass")
                else:
                    data["can_admins_bypass"] = value
                with self.assertRaisesRegex(target.GateBlocked, "ADMIN_BYPASS"):
                    target.verify_configuration(name, data, policies(name), custom())

    def test_reviewers_and_self_review_mismatch_fail(self):
        for name in target.ENVS:
            for defect in ("wrong_review", "self_review", "empty_reviewer"):
                data = env(name)
                rule = data["protection_rules"][0]
                if defect == "wrong_review":
                    rule["reviewers"][0]["reviewer"]["login"] = "alexoaraujo"
                elif defect == "empty_reviewer":
                    rule["reviewers"] = []
                else:
                    rule["prevent_self_review"] = False
                with self.assertRaises(target.GateBlocked):
                    target.verify_configuration(name, data, policies(name), custom())

    def test_custom_rule_and_wait_timer_fail(self):
        for name in target.ENVS:
            for rule in ({"type": "integration_protection_rule"},
                         {"type": "wait_timer", "wait_timer": 2}):
                data = env(name)
                data["protection_rules"].append(rule)
                with self.assertRaises(target.GateBlocked):
                    target.verify_configuration(name, data, policies(name), custom())

    def test_branch_pattern_or_type_drift_fails(self):
        for name in target.ENVS:
            for invalid in ("*", "main", "audit/*", target.ENVS[name] + "X"):
                if invalid == target.ENVS[name]:
                    continue
                x = policies(name)
                x["branch_policies"][0]["name"] = invalid
                with self.assertRaises(target.GateBlocked):
                    target.verify_configuration(name, env(name), x, custom())
            x = policies(name)
            x["branch_policies"][0]["type"] = "tag"
            with self.assertRaises(target.GateBlocked):
                target.verify_configuration(name, env(name), x, custom())
            x = policies(name)
            x["total_count"] = 2
            with self.assertRaises(target.GateBlocked):
                target.verify_configuration(name, env(name), x, custom())

    def test_custom_rules_endpoint_must_be_empty(self):
        for name in target.ENVS:
            bad_responses = [
                {"total_count": 1, "custom_deployment_protection_rules": [
                    {"id": 1, "enabled": True, "app": {"slug": "atlassian"}}
                ]},
                {"total_count": 0, "custom_deployment_protection_rules": [
                    {"id": 1, "enabled": True}
                ]},
                {"total_count": 0},
                {},
            ]
            for custom_rules in bad_responses:
                with self.assertRaisesRegex(target.GateBlocked, "CUSTOM_DEPLOYMENT"):
                    target.verify_configuration(name, env(name), policies(name),
                                                custom_rules)

    def test_missing_custom_branch_mode_fails(self):
        for name in target.ENVS:
            data = env(name)
            data["deployment_branch_policy"]["custom_branch_policies"] = False
            with self.assertRaises(target.GateBlocked):
                target.verify_configuration(name, data, policies(name), custom())

    def test_effective_disabled_branch_mode_is_reported_before_404_endpoint(self):
        custody = {"IAM-G1-Full-Backup-Custody", "IAM-G1-B2-Full-Readback-Custody"}
        seen = []

        def mock_get_json(path, token):
            seen.append(path)
            name = path.split("/")[1].split("?")[0]
            if name in custody and "/deployment-branch-policies" in path:
                raise AssertionError("disabled policy endpoint must not be queried")
            if "/deployment-branch-policies" in path:
                return policies(name)
            if "/deployment_protection_rules" in path:
                return custom()
            data = env(name)
            if name in custody:
                data["deployment_branch_policy"]["custom_branch_policies"] = False
            return data

        output, errors = StringIO(), StringIO()
        with (patch.dict(os.environ, {"GITHUB_REPOSITORY": target.REPO,
                                     "GITHUB_TOKEN": "fake-token-not-a-real-credential"}),
              patch.object(target, "get_json", side_effect=mock_get_json),
              redirect_stdout(output), redirect_stderr(errors)):
            with self.assertRaisesRegex(target.GateBlocked, "TOTAL_BLOCKED_ENVIRONMENTS=2"):
                target.live_attest()

        for name in custody:
            self.assertIn(name + ": BRANCH_SELECTION_NOT_EXCLUSIVE_CUSTOM", errors.getvalue())
            self.assertNotIn("/" + name + "/deployment-branch-policies", seen)
        self.assertEqual(output.getvalue().count("PASS_G1_LIVE_ENV_METADATA_READONLY "), 3)
        self.assertNotIn("PASS_G1_LIVE_ENV_METADATA_FIVE_READONLY_NO_SECRETS", output.getvalue())

    def test_live_audit_reports_both_custody_failures_and_blocks_total_pass(self):
        names = list(target.ENVS)
        backup, readback = "IAM-G1-Full-Backup-Custody", "IAM-G1-B2-Full-Readback-Custody"

        def mock_get_json(path, token):
            self.assertEqual(token, "fake-token-not-a-real-credential")
            name = path.split("/")[1].split("?")[0]
            if name == readback:
                raise target.GateBlocked("GITHUB_ENVIRONMENT_API_ENVIRONMENT_NOT_FOUND_OR_INACCESSIBLE")
            if name == backup and "/deployment-branch-policies" in path:
                raise target.GateBlocked("GITHUB_ENVIRONMENT_API_BRANCH_POLICIES_NOT_FOUND_OR_INACCESSIBLE")
            if "/deployment-branch-policies" in path:
                return policies(name)
            if "/deployment_protection_rules" in path:
                return custom()
            return env(name)

        output, errors = StringIO(), StringIO()
        with (patch.dict(os.environ, {"GITHUB_REPOSITORY": target.REPO,
                                     "GITHUB_TOKEN": "fake-token-not-a-real-credential"}),
              patch.object(target, "get_json", side_effect=mock_get_json),
              redirect_stdout(output), redirect_stderr(errors)):
            with self.assertRaisesRegex(target.GateBlocked, "TOTAL_BLOCKED_ENVIRONMENTS=2"):
                target.live_attest()

        self.assertEqual(output.getvalue().count("PASS_G1_LIVE_ENV_METADATA_READONLY "), 3)
        self.assertNotIn("PASS_G1_LIVE_ENV_METADATA_FIVE_READONLY_NO_SECRETS", output.getvalue())
        self.assertIn(backup + ": GITHUB_ENVIRONMENT_API_BRANCH_POLICIES_NOT_FOUND_OR_INACCESSIBLE", errors.getvalue())
        self.assertIn(readback + ": GITHUB_ENVIRONMENT_API_ENVIRONMENT_NOT_FOUND_OR_INACCESSIBLE", errors.getvalue())
        self.assertNotIn("fake-token-not-a-real-credential", errors.getvalue())

    def test_live_audit_emits_five_pass_only_with_all_valid_metadata(self):
        def mock_get_json(path, token):
            name = path.split("/")[1].split("?")[0]
            if "/deployment-branch-policies" in path:
                return policies(name)
            if "/deployment_protection_rules" in path:
                return custom()
            return env(name)

        output = StringIO()
        with (patch.dict(os.environ, {"GITHUB_REPOSITORY": target.REPO,
                                     "GITHUB_TOKEN": "fake-token-not-a-real-credential"}),
              patch.object(target, "get_json", side_effect=mock_get_json),
              redirect_stdout(output)):
            target.live_attest()
        self.assertEqual(output.getvalue().count("PASS_G1_LIVE_ENV_METADATA_READONLY "), 5)
        self.assertIn("PASS_G1_LIVE_ENV_METADATA_FIVE_READONLY_NO_SECRETS", output.getvalue())
        self.assertIn("IAM-G1-Full-Restore-Custody environment_id=104", output.getvalue())
        self.assertIn("/settings/environments/104", output.getvalue())


    def test_live_audit_blocks_restore_id_collision_missing_id_or_alias(self):
        restore = "IAM-G1-Full-Restore-Custody"
        for fault, code in (
            ("alias", "ENV_NAME_MISMATCH"),
            ("missing", "ENVIRONMENT_ID_MISSING_OR_INVALID"),
            ("boolean", "ENVIRONMENT_ID_MISSING_OR_INVALID"),
            ("duplicate", "ENVIRONMENT_ID_COLLISION"),
        ):
            def mock_get_json(path, token):
                name = path.split("/")[1].split("?")[0]
                if "/deployment-branch-policies" in path:
                    return policies(name)
                if "/deployment_protection_rules" in path:
                    return custom()
                data = env(name)
                if name == restore:
                    if fault == "alias":
                        data["name"] = "IAM-G1-Full-Backup-Custody"
                    elif fault == "missing":
                        data.pop("id")
                    elif fault == "boolean":
                        data["id"] = True
                    elif fault == "duplicate":
                        data["id"] = env("IAM-G1-Full-Backup-Custody")["id"]
                return data

            output, errors = StringIO(), StringIO()
            with (patch.dict(os.environ, {"GITHUB_REPOSITORY": target.REPO,
                                         "GITHUB_TOKEN": "fake-token-not-a-real-credential"}),
                  patch.object(target, "get_json", side_effect=mock_get_json),
                  redirect_stdout(output), redirect_stderr(errors)):
                with self.assertRaisesRegex(target.GateBlocked, "TOTAL_BLOCKED_ENVIRONMENTS=1"):
                    target.live_attest()
            self.assertIn(restore + ": " + code, errors.getvalue())
            self.assertNotIn("PASS_G1_LIVE_ENV_METADATA_READONLY " + restore, output.getvalue())
            self.assertNotIn("PASS_G1_LIVE_ENV_METADATA_FIVE_READONLY_NO_SECRETS", output.getvalue())


if __name__ == "__main__":
    main(verbosity=2)
