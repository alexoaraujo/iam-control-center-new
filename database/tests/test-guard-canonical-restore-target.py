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
