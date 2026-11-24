#!/usr/bin/env python3
import copy
import importlib.util
import pathlib
import unittest
from unittest.mock import patch

path = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "iam-g2-environment-preflight.py"
spec = importlib.util.spec_from_file_location("preflight", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SHA = "a" * 40

def listing(k, items):
    return {"total_count": len(items), k: items}

def fixture():
    envs = {}
    for i, (name, (secrets, variables)) in enumerate(m.CONTRACT.items(), 1):
        envs[name] = {"environment": {"name": name, "id": i, "can_admins_bypass": False,
            "deployment_branch_policy": {"protected_branches": False, "custom_branch_policies": True},
            "protection_rules": [{"type": "branch_policy"}, {"type": "required_reviewers",
                "prevent_self_review": True, "reviewers": [{"type": "User", "reviewer": {"login": m.REVIEWER}}]}]},
            "branches": listing("branch_policies", [{"name": "main", "type": "branch"}]),
            "custom": listing("custom_deployment_protection_rules", []),
            "secrets": listing("secrets", [{"name": n} for n in sorted(secrets)]),
            "variables": listing("variables", [{"name": n, "value": SHA if n == "IAM_G2_APPROVED_SHA"
                                      else "b" * 64} for n in sorted(variables)])}
    return {"checkout_sha": SHA, "main_before": SHA, "main_after": SHA,
            "repository": {"full_name": m.REPO, "owner": {"type": "User"}, "default_branch": "main"},
            "repository_secrets": listing("secrets", [{"name": "UNRELATED"}]),
            "repository_variables": listing("variables", []), "environments": envs}

class Contract(unittest.TestCase):
    def test_metadata_only(self):
        report = m.verify(fixture(), SHA)
        self.assertEqual(report["result"], "PASS_METADATA_ONLY")
        self.assertTrue(all(v is False for k, v in report.items()
                            if k.endswith(("_verified", "_authorized"))))

    def test_sha_repository_and_inheritance(self):
        for key, value in [("checkout_sha", "c"*40), ("main_before", "c"*40),
                ("main_after", "c"*40), ("repository", {"full_name": m.REPO, "owner": {"type":"Organization"}}),
                ("repository_secrets", listing("secrets", [{"name":"IAM_G2_READER_PASSWORD"}])),
                ("repository_variables", listing("variables", [{"name":"IAM_G2_APPROVED_SHA"}]))]:
            with self.subTest(key=key):
                data = fixture()
                data[key] = value
                with self.assertRaises(m.Blocked):
                    m.verify(data, SHA)

    def test_environment_policy_rejects_drift(self):
        mutations = [
            lambda x: x["environment"].pop("can_admins_bypass"),
            lambda x: x["environment"].update(can_admins_bypass=True),
            lambda x: x["environment"]["deployment_branch_policy"].update(protected_branches=True),
            lambda x: x["environment"]["protection_rules"].pop(),
            lambda x: x["environment"]["protection_rules"][1].update(prevent_self_review=False),
            lambda x: x["environment"]["protection_rules"][1]["reviewers"][0]["reviewer"].update(login="wrong"),
            lambda x: x["branches"]["branch_policies"][0].update(name="*"),
            lambda x: x["branches"]["branch_policies"][0].update(type="tag"),
            lambda x: x["branches"].update(total_count=2),
            lambda x: x.update(custom=listing("custom_deployment_protection_rules", [{"id": 5}])),
            lambda x: x.update(secrets=listing("secrets", [{"name":"IAM_G2_NEON_ENDPOINT_READ_TOKEN"}])),
            lambda x: x["variables"]["variables"][0].update(value="c"*40),
        ]
        for i, change in enumerate(mutations):
            with self.subTest(i=i):
                data = fixture()
                change(data["environments"][m.ACQUIRE])
                with self.assertRaises(m.Blocked):
                    m.verify(data, SHA)

    def test_no_network_on_untrusted_context(self):
        with patch.dict(m.os.environ, {"GITHUB_ACTIONS":"true", "GITHUB_EVENT_NAME":"pull_request",
                 "GITHUB_REPOSITORY":m.REPO, "GITHUB_REF":"refs/pull/181/merge", "GITHUB_SHA":SHA}, clear=True):
            with patch.object(m, "get") as get:
                with self.assertRaises(m.Blocked):
                    m.live(SHA, "synthetic")
                get.assert_not_called()

    def test_duplicates_and_collision(self):
        data = fixture()
        data["environments"][m.ACQUIRE]["environment"]["id"] = 1
        with self.assertRaises(m.Blocked):
            m.verify(data, SHA)
        with self.assertRaises(m.Blocked):
            m.unique_object([("a", 1), ("a", 2)])
        with self.assertRaises(m.Blocked):
            m.names(listing("secrets", [{"name":"DUP"}, {"name":"DUP"}]), "secrets")

if __name__ == "__main__":
    unittest.main()
