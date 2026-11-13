#!/usr/bin/env python3
"""Offline positive/negative contract; all passwords are synthetic."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import sys
import unittest
from urllib.parse import quote

file = Path(__file__).resolve().parents[1] / "scripts" / "guard-canonical-restore-target.py"
spec = importlib.util.spec_from_file_location("iam_guard", file)
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

def uri(host, db, role, password="TEST_ONLY", suffix="sslmode=verify-full&sslrootcert=system"):
    return f"postgresql://{quote(role)}:{quote(password)}@{host}:5432/{db}?{suffix}"

def source(**kw):
    return uri(mod.SOURCE_HOST, mod.SOURCE_DATABASE, mod.SOURCE_ROLE, **kw)

def target(**kw):
    return uri(mod.TARGET_HOST, mod.TARGET_DATABASE, mod.TARGET_ROLE, **kw)

class GuardContract(unittest.TestCase):
    def test_valid_pinned_endpoints_pass_preflight_only(self):
        a, b = mod.verify_connections(source(), target())
        self.assertNotEqual(a.hostname, b.hostname)
        self.assertEqual(b.database, "iam_canonical_validation")

    def test_only_authorized_neon_organization_and_branch_are_pinned(self):
        self.assertEqual(mod.EXPECTED_SOURCE_PROJECT, "tiny-rice-70320263")
        self.assertEqual(mod.EXPECTED_TARGET_PROJECT, "tiny-rice-70320263")
        self.assertEqual(mod.EXPECTED_SOURCE_BRANCH, "br-ancient-term-b6mmx5ol")
        self.assertEqual(mod.EXPECTED_TARGET_BRANCH, "br-sweet-union-b6j80a7j")
        self.assertEqual(mod.SOURCE_HOST, "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech")
        self.assertNotEqual(mod.EXPECTED_SOURCE_BRANCH, mod.EXPECTED_TARGET_BRANCH)
        self.assertNotEqual(mod.SOURCE_HOST, mod.TARGET_HOST)

    def test_old_cross_organization_and_production_hosts_are_blocked(self):
        forbidden = [
            "ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech",
            "ep-odd-fog-b643wfck.c-2.sa-east-1.aws.neon.tech",
            "ep-winter-leaf-b6cp8d2c-pooler.c-2.sa-east-1.aws.neon.tech",
        ]
        for host in forbidden:
            with self.subTest(host=host), self.assertRaises(mod.GateBlocked):
                mod.verify_connections(uri(host, mod.SOURCE_DATABASE, mod.SOURCE_ROLE), target())

    def test_legacy_schema_export_workflow_is_quarantined(self):
        workflow = (file.parents[2] / ".github" / "workflows" /
                    "neon-schema-export.yml").read_text(encoding="utf8")
        self.assertIn("QUARANTINED", workflow)
        job = workflow.split("\n  export-schema:", 1)[1]
        self.assertIn("    if: false", job)
        self.assertIn("The previous Neon source project belongs to a different organization.", job)

    def test_pinned_tls_probe_is_for_authorized_development_only(self):
        workflow = (file.parents[2] / ".github" / "workflows" /
                    "iam-canonical-isolated-restore.yml").read_text(encoding="utf8")
        self.assertIn("ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech", workflow)
        self.assertNotIn("ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech", workflow)
        self.assertIn("br-ancient-term-b6mmx5ol", workflow)
        self.assertIn("tiny-rice-70320263 / development", workflow)
        self.assertIn("ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech", workflow)

    def test_target_negative_paths(self):
        bad = [
            "", source(),
            uri(mod.SOURCE_HOST, mod.TARGET_DATABASE, mod.TARGET_ROLE),
            uri(mod.TARGET_HOST.replace(".c-2.", "-pooler.c-2."), mod.TARGET_DATABASE, mod.TARGET_ROLE),
            uri(mod.TARGET_HOST, "iam_database", mod.TARGET_ROLE),
            uri(mod.TARGET_HOST, mod.TARGET_DATABASE, "iam_app_runtime_login"),
            target(suffix="sslmode=require&sslrootcert=system"),
            target(suffix="sslmode=disable&sslrootcert=system"),
            target(suffix="sslmode=verify-full"),
            target(suffix="sslmode=verify-full&sslrootcert=system&options=-cstatement_timeout=0"),
            target(suffix="sslmode=verify-full&sslrootcert=system&sslrootcert=wrong"),
            target() + "\n",
        ]
        for candidate in bad:
            with self.subTest(index=bad.index(candidate)):
                with self.assertRaises(mod.GateBlocked):
                    mod.verify_connections(source(), candidate)

    def test_source_negative_paths(self):
        for candidate in [
            "", uri(mod.SOURCE_HOST, mod.SOURCE_DATABASE, "neondb_owner"),
            source(suffix="sslmode=require&sslrootcert=system"),
            uri(mod.TARGET_HOST, mod.SOURCE_DATABASE, mod.SOURCE_ROLE),
        ]:
            with self.assertRaises(mod.GateBlocked):
                mod.verify_connections(candidate, target())

    def test_secret_is_never_in_error(self):
        secret = "DO_NOT_LOG_THIS_SECRET"
        candidate = uri(mod.TARGET_HOST, "wrong_database", mod.TARGET_ROLE, password=secret)
        with self.assertRaises(mod.GateBlocked) as x:
            mod.verify_connections(source(), candidate)
        self.assertNotIn(secret, str(x.exception))

if __name__ == "__main__":
    unittest.main()
