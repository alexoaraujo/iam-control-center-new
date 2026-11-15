#!/usr/bin/env python3
"""Offline positive/negative tests for the actual disposable-branch PG18 probe."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "iam-g1-lease-schema-probe.py"
spec = importlib.util.spec_from_file_location("lease_pg18_probe", SCRIPT)
assert spec is not None and spec.loader is not None
probe = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = probe
spec.loader.exec_module(probe)

HOST = probe.EXPECTED_HOST
URL = ("postgresql://iam_schema_export_reader:SYNTHETIC_TEST_PASSWORD@"
       + HOST + ":5432/iam_database?sslmode=verify-full&sslrootcert=system")


class LeaseProbeContract(unittest.TestCase):
    def test_pin_exact_branch_direct_host_role_and_verified_tls(self):
        e = probe.validate_url(URL)
        self.assertEqual(e["PGHOST"], HOST)
        self.assertEqual(e["PGUSER"], "iam_schema_export_reader")
        self.assertEqual(e["PGDATABASE"], "iam_database")
        self.assertEqual(e["PGSSLMODE"], "verify-full")
        self.assertEqual(e["PGSSLROOTCERT"], "system")
        self.assertEqual(e["PGPASSWORD"], "SYNTHETIC_TEST_PASSWORD")
        self.assertEqual(e["SSL_CERT_FILE"], "/etc/ssl/certs/ca-certificates.crt")

    def test_missing_secret_or_forbidden_parameters_fail_closed(self):
        bad = [
            "",
            URL.replace(HOST, "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"),
            URL.replace(HOST, HOST.replace(".c-2", "-pooler.c-2")),
            URL.replace("iam_database", "neondb"),
            URL.replace("iam_schema_export_reader", "neondb_owner"),
            URL.replace("5432/", "5433/"),
            URL.replace("sslmode=verify-full", "sslmode=require"),
            URL.replace("sslrootcert=system", "sslrootcert=none"),
            URL + "&options=-c%20search_path%3Dpublic",
            URL + "#fragment",
            URL.replace("SYNTHETIC_TEST_PASSWORD", ""),
            URL + "\nDANGEROUS",
        ]
        for value in bad:
            with self.subTest(url=value[-48:]):
                with self.assertRaises(probe.Blocked):
                    probe.validate_url(value)

    def test_real_command_contract_positive_schema_only_and_no_upload(self):
        calls = []

        def fake(args, env, folder):
            calls.append(args)
            if args[0] == "pg_dump":
                (folder / "schema-only.dump").write_bytes(b"PGDMP" + b"0" * 3000)
            if args[0] == "psql" and len([c for c in calls if c[0] == "psql"]) == 1:
                return "iam_database|iam_schema_export_reader|iam_schema_export_reader"
            if args[0] == "psql":
                return "23|0|0|0|f"
            if args[0] == "pg_restore":
                return "42; 1259 456 TABLE iam tenants iam_owner"
            return ""

        with tempfile.TemporaryDirectory() as tmp, patch.object(probe, "run_pg", side_effect=fake):
            result = probe.run_probe(probe.validate_url(URL), Path(tmp))
        self.assertGreater(result["archive_bytes"], 2048)
        self.assertEqual(len(result["sha256"]), 64)
        self.assertEqual([x[0] for x in calls], ["psql", "psql", "pg_dump", "pg_restore"])
        dump_args = calls[2]
        self.assertIn("--schema-only", dump_args)
        self.assertIn("--format=custom", dump_args)
        self.assertIn("--schema=iam", dump_args)
        self.assertIn("--schema=audit", dump_args)
        self.assertIn("--schema=app_private", dump_args)
        self.assertIn("--lock-wait-timeout=5s", dump_args)
        self.assertNotIn("--data-only", dump_args)
        self.assertNotIn("--clean", dump_args)
        self.assertNotIn("--create", dump_args)
        self.assertNotIn("--enable-row-security", dump_args)
        self.assertFalse(any("pg_restore" in x[0] and "--dbname" in str(x) for x in calls))

    def test_negative_privilege_denial_is_not_success(self):
        def denied(args, env, folder):
            if args[0] == "psql":
                return ("iam_database|iam_schema_export_reader|iam_schema_export_reader"
                        if args[3:4] == ["-A"] and "current_database()" in str(args)
                        else "23|0|0|0|f")
            raise probe.Blocked("PG_DUMP_PRIVILEGE_DENIED")

        with tempfile.TemporaryDirectory() as tmp, patch.object(probe, "run_pg", side_effect=denied):
            with self.assertRaisesRegex(probe.Blocked, "PG_DUMP_PRIVILEGE_DENIED"):
                probe.run_probe(probe.validate_url(URL), Path(tmp))

    def test_unexpected_grants_fail_before_dump(self):
        calls = []
        def bad_acl(args, env, folder):
            calls.append(args)
            return ("iam_database|iam_schema_export_reader|iam_schema_export_reader"
                    if len(calls) == 1 else "23|1|0|0|f")
        with tempfile.TemporaryDirectory() as tmp, patch.object(probe, "run_pg", side_effect=bad_acl):
            with self.assertRaisesRegex(probe.Blocked, "UNEXPECTED_GRANTS"):
                probe.run_probe(probe.validate_url(URL), Path(tmp))
        self.assertEqual([a[0] for a in calls], ["psql", "psql"])

    def test_schema_archive_data_contamination_is_rejected(self):
        counter = [0]
        def contaminated(args, env, folder):
            if args[0] == "psql":
                counter[0] += 1
                return ("iam_database|iam_schema_export_reader|iam_schema_export_reader"
                        if counter[0] == 1 else "23|0|0|0|f")
            if args[0] == "pg_dump":
                (folder / "schema-only.dump").write_bytes(b"PGDMP" + b"0" * 3000)
                return ""
            return "21; 0 0 TABLE DATA iam identities iam_owner"
        with tempfile.TemporaryDirectory() as tmp, patch.object(probe, "run_pg", side_effect=contaminated):
            with self.assertRaisesRegex(probe.Blocked, "ARCHIVE_CONTAINS_DATA"):
                probe.run_probe(probe.validate_url(URL), Path(tmp))

    def test_command_failure_masks_raw_stderr_and_password(self):
        secret = "DO_NOT_LOG_PASSWORD"
        err = "ERROR: permission denied on table " + secret
        completion = subprocess.CompletedProcess(["pg_dump"], 1, "", err)
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            probe.subprocess, "run", return_value=completion
        ):
            with self.assertRaises(probe.Blocked) as exc:
                probe.run_pg(["pg_dump", "-w"], {**probe.validate_url(URL), "PGPASSWORD": secret}, Path(tmp))
            self.assertEqual(str(exc.exception), "PG_DUMP_PRIVILEGE_DENIED")
            self.assertNotIn(secret, str(exc.exception))
            self.assertFalse((Path(tmp) / "pg-secret.env").exists())

    def test_role_audit_rejects_replication_enabled_iam_roles(self):
        audit = (SCRIPT.parent / "iam-g1-role-parity-readonly.sql").read_text(encoding="utf8")
        for enforced in (
            "r.rolreplication IS DISTINCT FROM false",
            "r.rolbypassrls IS DISTINCT FROM false",
            "r.rolsuper IS DISTINCT FROM false",
            "r.rolcreaterole IS DISTINCT FROM false",
            "r.rolcreatedb IS DISTINCT FROM false",
            "r.rolinherit IS DISTINCT FROM e.can_inherit",
            "r.rolcanlogin IS DISTINCT FROM e.can_login",
            "m.admin_option", "m.inherit_option", "m.set_option",
        ):
            self.assertIn(enforced, audit)
        self.assertIn("canonical_role_graph_pass", audit)
        self.assertNotIn("ALTER ROLE", audit.split("WITH expected_roles", 1)[1])
        self.assertNotIn("GRANT ", audit.split("WITH expected_roles", 1)[1])

    def test_credentialed_workflow_does_not_reuse_development_url(self):
        content = (SCRIPT.parents[2] / ".github" / "workflows" /
                   "iam-g1-lease-schema-probe.yml").read_text(encoding="utf8")
        self.assertIn("IAM_EXPORT_LEASE_DATABASE_URL: ${{ secrets.IAM_EXPORT_LEASE_DATABASE_URL }}", content)
        self.assertNotIn("secrets.IAM_CANONICAL_SOURCE_URL", content)
        self.assertIn("IAM-Canonical-Isolated-Restore", content)
        self.assertIn("audit/iam-g1-lease-schema-probe-20261115", content)
        self.assertIn("persist-credentials: false", content)
        self.assertIn("pg18-system-ca.Dockerfile", content)
        self.assertNotIn("permissions: write-all", content)
        self.assertNotIn("pull_request_target", content)
        self.assertNotIn("sudo -u postgres", content)


if __name__ == "__main__":
    unittest.main(verbosity=2)
