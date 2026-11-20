#!/usr/bin/env python3
"""Offline negative tests; synthetic ACLs, no Neon credentials or connectivity."""
from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
from unittest import TestCase, main

SCRIPT = Path(__file__).resolve().parents[2] / "database" / "scripts" / "compare-iam-export-acl-manifests.py"
spec = importlib.util.spec_from_file_location("iam_acl_compare", SCRIPT)
assert spec and spec.loader
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def baseline():
    rows = [{
        "schema": "app_private",
        "relation": "context_keys",
        "owner": "iam_owner",
        "raw_acl": None,
        "effective_acl": [["iam_owner", "iam_owner", "SELECT", False]],
    }]
    for name, count in (("audit", 2), ("iam", 20)):
        rows.extend({
            "schema": name,
            "relation": f"fixture_{i:02d}",
            "owner": "iam_owner",
            "raw_acl": None,
            "effective_acl": [["iam_owner", "iam_owner", "SELECT", False]],
        } for i in range(count))
    return rows


class IamAclComparatorTests(TestCase):
    def test_exact_identical_manifests_pass(self):
        rows = baseline()
        self.assertEqual(
            m.compare(rows, copy.deepcopy(rows), "exact"),
            ("PASS_EXACT_TABLE_ACL_CATALOG", []),
        )

    def test_known_post_revoke_representation_is_semantic_only(self):
        a, b = baseline(), baseline()
        b[0]["raw_acl"] = m.KNOWN_EXPLICIT_OWNER_DEFAULT
        self.assertEqual(
            m.compare(a, b, "effective"),
            ("PASS_EFFECTIVE_TABLE_ACL_ONLY_EXACT_CATALOG_BLOCKED",
             ["app_private.context_keys"]),
        )
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "exact")

    def test_unexpected_raw_change_blocks_even_semantic_gate(self):
        a, b = baseline(), baseline()
        b[2]["raw_acl"] = "{iam_owner=arwdDxtm/iam_owner}"
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "effective")

    def test_reversed_implicit_explicit_drift_is_not_allowlisted(self):
        a, b = baseline(), baseline()
        a[0]["raw_acl"] = m.KNOWN_EXPLICIT_OWNER_DEFAULT
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "effective")

    def test_privilege_escalation_or_revoke_mismatch_is_blocked(self):
        a, b = baseline(), baseline()
        b[0]["effective_acl"].append(
            ["iam_owner", "iam_schema_export_reader", "MAINTAIN", False]
        )
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "effective")

    def test_owner_mismatch_is_blocked(self):
        a, b = baseline(), baseline()
        b[0]["owner"] = "neondb_owner"
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "effective")

    def test_missing_or_duplicate_relation_is_blocked(self):
        a, b = baseline(), baseline()
        b[1]["relation"] = b[2]["relation"]
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "effective")
        with self.assertRaises(m.Blocked):
            m.compare(a, b[:-1], "effective")

    def test_duplicate_effective_privilege_is_blocked(self):
        a, b = baseline(), baseline()
        b[0]["effective_acl"].append(b[0]["effective_acl"][0])
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "effective")

    def test_invalid_payload_and_non_boolean_grantable_are_blocked(self):
        a, b = baseline(), baseline()
        b[0]["effective_acl"][0][3] = "false"
        with self.assertRaises(m.Blocked):
            m.compare(a, b, "effective")
        with self.assertRaises(m.Blocked):
            m.compare(a, {"error": "truncated"}, "effective")

    def test_unsorted_acl_entries_are_canonicalized_by_comparator(self):
        a, b = baseline(), baseline()
        extra = ["iam_owner", "iam_owner", "MAINTAIN", False]
        a[0]["effective_acl"].append(extra)
        b[0]["effective_acl"].insert(0, extra)
        self.assertEqual(
            m.compare(a, b, "exact"),
            ("PASS_EXACT_TABLE_ACL_CATALOG", []),
        )

    def test_manifest_query_is_read_only_and_avoids_data_rows(self):
        sql = (SCRIPT.parent / "iam-export-acl-manifest-readonly.sql").read_text()
        self.assertIn("aclexplode", sql)
        self.assertIn("acldefault", sql)
        self.assertIn("pg_class", sql)
        self.assertNotIn("GRANT ", sql.upper())
        self.assertNotIn("REVOKE ", sql.upper())
        self.assertNotIn("UPDATE pg_class", sql.upper())
        self.assertNotIn("SELECT * FROM iam.", sql)

if __name__ == "__main__":
    main()
