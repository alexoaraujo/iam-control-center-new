#!/usr/bin/env python3
import importlib.util
import json
import unittest
from pathlib import Path

P = Path(__file__).resolve().parents[1] / "scripts/peos-environments-inventory.py"
S = importlib.util.spec_from_file_location("inventory", P)
M = importlib.util.module_from_spec(S)
S.loader.exec_module(M)

def page(key, entries):
    return [{"total_count": len(entries), key: entries}]

class InventoryTest(unittest.TestCase):
    def setUp(self):
        self.policy = json.loads(M.POLICY.read_text())
        b = "repos/" + M.REPO
        p = b + "/environments/Preview"
        self.responses = {
            b + "/environments?per_page=100": page("environments", [{"name":"Preview","id":7}]),
            b + "/actions/secrets?per_page=100": page("secrets", []),
            p: [{"name":"Preview","id":7,"can_admins_bypass":False,
                 "deployment_branch_policy":{"custom_branch_policies":True,"protected_branches":False},
                 "protection_rules":[{"type":"branch_policy"}]}],
            p + "/deployment-branch-policies?per_page=100": page("branch_policies",
                [{"type":"branch","name":"main"},{"type":"branch","name":"refs/pull/*/merge"}]),
            p + "/secrets?per_page=100": page("secrets", []),
            p + "/variables?per_page=100": page("variables", [{"name":"EXAMPLE","value":"NEVER_PRINT_ME"}]),
        }
        self.base = b
        self.path = p
    def audit(self):
        return M.audit(self.policy, self.responses.__getitem__)
    def test_no_value_and_no_wildcard_activation(self):
        r = self.audit()
        self.assertIn("PREVIEW_WILDCARD_ACTIVATION_HOLD", r["environments"][0]["findings"])
        self.assertNotIn("NEVER_PRINT_ME", json.dumps(r))
        self.assertNotIn("BRANCH_POLICY_DRIFT", r["environments"][0]["findings"])
    def test_repository_secret_scope(self):
        self.responses[self.base + "/actions/secrets?per_page=100"] = page("secrets", [{"name":"TOKEN"}])
        self.assertIn("PREVIEW_SECRET_SCOPE_REQUIRES_SEGREGATION", self.audit()["environments"][0]["findings"])
    def test_environment_secret_scope(self):
        self.responses[self.path + "/secrets?per_page=100"] = page("secrets", [{"name":"TOKEN"}])
        self.assertIn("PREVIEW_SECRET_SCOPE_REQUIRES_SEGREGATION", self.audit()["environments"][0]["findings"])
    def test_tag_and_bypass_drift(self):
        self.responses[self.path][0]["can_admins_bypass"] = True
        self.responses[self.path + "/deployment-branch-policies?per_page=100"] = page("branch_policies", [{"type":"tag","name":"main"}])
        findings = self.audit()["environments"][0]["findings"]
        self.assertIn("BRANCH_POLICY_DRIFT", findings)
        self.assertIn("ADMIN_BYPASS_NOT_DISABLED_OR_UNATTESTED", findings)
    def test_partial_list(self):
        with self.assertRaises(M.Blocked):
            M.rows([{"total_count":2,"secrets":[]}], "secrets")
    def test_duplicate_names(self):
        with self.assertRaises(M.Blocked):
            M.names([{"name":"TOKEN"},{"name":"TOKEN"}])
    def test_identity_mismatch(self):
        self.responses[self.path][0]["id"] = 8
        with self.assertRaises(M.Blocked):
            self.audit()
    def test_malformed_protections(self):
        self.responses[self.path][0]["protection_rules"] = [None]
        with self.assertRaises(M.Blocked):
            self.audit()
    def test_permission_failure_propagates(self):
        def unavailable(_):
            raise M.Blocked("GITHUB_READ_FAILED")
        with self.assertRaises(M.Blocked):
            M.audit(self.policy, unavailable)
    def test_unknown_environment_candidate_not_created(self):
        self.assertIn("Production", self.audit()["unobserved_candidates"])
        self.assertEqual(len(self.audit()["environments"]), 1)

if __name__ == "__main__":
    unittest.main()
