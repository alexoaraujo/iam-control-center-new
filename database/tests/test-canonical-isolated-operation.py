#!/usr/bin/env python3
"""Offline negative contract for guarded Neon export/restore; synthetic credentials only."""
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "iam_operation", HERE.parent / "scripts" / "canonical-isolated-operation.py"
)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

SOURCE = ("postgresql://iam_schema_export_reader:TEST_ONLY@"
          "ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech:5432/"
          "iam_database?sslmode=verify-full&sslrootcert=system")
TARGET = ("postgresql://neondb_owner:TEST_ONLY@"
          "ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech:5432/"
          "iam_canonical_validation?sslmode=verify-full&sslrootcert=system")

class IsolatedRunnerContract(unittest.TestCase):
    def env(self, approval="", confirm=""):
        return patch.dict(os.environ, {
            "IAM_CANONICAL_SOURCE_URL": SOURCE,
            "IAM_CANONICAL_TARGET_URL": TARGET,
            "IAM_CANONICAL_OPERATOR_APPROVAL": approval,
            "IAM_CANONICAL_CONFIRMATION": confirm
        })

    def test_connection_env_does_not_put_password_in_commandline(self):
        e = module.pg_env(SOURCE)
        self.assertEqual(e["PGUSER"], "iam_schema_export_reader")
        self.assertEqual(e["PGSSLMODE"], "verify-full")
        self.assertEqual(e["PGSSLROOTCERT"], "system")
        self.assertEqual(e["PGDATABASE"], "iam_database")
        self.assertNotIn("IAM_CANONICAL_SOURCE_URL", module.no_trust_env())

    def test_no_operator_approval_blocks_before_docker(self):
        with self.env(), patch.object(module, "docker_run") as d:
            with self.assertRaises(module.GateBlocked):
                module.execute("restore_isolated")
            d.assert_not_called()

    def test_approval_without_manual_confirmation_blocks(self):
        with self.env(approval=module.APPROVAL), patch.object(module, "docker_run") as d:
            with self.assertRaises(module.GateBlocked):
                module.execute("restore_isolated")
            d.assert_not_called()

    @staticmethod
    def simulated_docker(calls):
        def execute(args, credentials, workspace):
            calls.append(args)
            if args[0] == "pg_dump":
                (workspace / "schema.dump").write_bytes(b"PGDMP" + b"Z" * 2049)
            if args[:2] == ["pg_restore", "--list"]:
                return "; valid schema only\n12; 1259 123 TABLE iam.tenants source\n"
            return ""
        return execute

    def test_export_only_never_runs_ddl(self):
        calls = []
        with self.env(), patch.object(module, "check_source"), \
             patch.object(module, "check_target"), \
             patch.object(module, "docker_run", side_effect=self.simulated_docker(calls)):
            module.execute("export_only")
        self.assertEqual([call[0] for call in calls], ["pg_dump", "pg_restore"])
        self.assertFalse(any("CREATE EXTENSION" in str(call) for call in calls))

    def test_restore_confirmation_allows_only_isolated_database(self):
        calls = []
        with self.env(approval=module.APPROVAL, confirm=module.CONFIRMATION), \
             patch.object(module, "check_source"), patch.object(module, "check_target"), \
             patch.object(module, "check_restored"), \
             patch.object(module, "check_restore_acl_principals"), \
             patch.object(module, "check_runtime_role_contract"), \
             patch.object(module, "docker_run", side_effect=self.simulated_docker(calls)):
            module.execute("restore_isolated")
        self.assertEqual(len(calls), 4)
        self.assertEqual(calls[-1][0], "pg_restore")
        self.assertIn("--dbname=iam_canonical_validation", calls[-1])
        self.assertIn("--single-transaction", calls[-1])
        self.assertNotIn("--clean", calls[-1])

    def test_export_detects_data_contamination(self):
        def contaminated(args, credentials, workspace):
            if args[0] == "pg_dump":
                (workspace / "schema.dump").write_bytes(b"PGDMP" + b"Z" * 2049)
            if args[:2] == ["pg_restore", "--list"]:
                return "TABLE DATA iam.identities\n"
            return ""
        with self.env(), patch.object(module, "check_source"), \
             patch.object(module, "check_target"), \
             patch.object(module, "docker_run", side_effect=contaminated):
            with self.assertRaises(module.GateBlocked):
                module.execute("export_only")

    def test_catalog_checks_fail_closed(self):
        with patch.object(module, "scalar", return_value=(
            "iam_database|iam_schema_export_reader|iam_schema_export_reader|t|"
            "23|41|20|f|f|t|0"
        )):
            module.check_source({}, Path("/tmp"))
        with patch.object(module, "scalar", return_value=(
            "iam_database|iam_schema_export_reader|iam_schema_export_reader|f|"
            "23|41|20|f|f|t|0"
        )):
            with self.assertRaises(module.GateBlocked):
                module.check_source({}, Path("/tmp"))
        with patch.object(module, "scalar", return_value=(
            "iam_canonical_validation|neondb_owner|neondb_owner|t|"
            "0|0|0|0|4|4|1|t"
        )):
            module.check_target({}, Path("/tmp"))
        with patch.object(module, "scalar", return_value=(
            "iam_database|neondb_owner|neondb_owner|t|0|0|0|0|4|4|1|t"
        )):
            with self.assertRaises(module.GateBlocked):
                module.check_target({}, Path("/tmp"))
        with patch.object(module, "scalar", return_value="23|41|20|23|t|0|t"):
            module.check_restored({}, Path("/tmp"))
        with patch.object(module, "scalar", return_value="23|41|20|0|t|0|t"):
            with self.assertRaises(module.GateBlocked):
                module.check_restored({}, Path("/tmp"))

    def test_source_acl_roles_missing_in_target_blocks_before_any_ddl(self):
        source_roles = "iam_app_runtime\niam_migrator\niam_owner\niam_schema_export_reader"
        target_roles = "iam_app_runtime\niam_migrator\niam_owner"
        with patch.object(module, "scalar", side_effect=[source_roles, target_roles]):
            with self.assertRaises(module.GateBlocked) as cm:
                module.check_restore_acl_principals({}, {}, Path("/tmp"))
        self.assertIn("iam_schema_export_reader", str(cm.exception))
        with patch.object(module, "scalar", side_effect=[source_roles, source_roles]):
            module.check_restore_acl_principals({}, {}, Path("/tmp"))

    def test_acl_inventory_incomplete_blocks_fail_closed(self):
        with patch.object(module, "scalar", side_effect=["", "iam_owner"]):
            with self.assertRaises(module.GateBlocked):
                module.check_restore_acl_principals({}, {}, Path("/tmp"))

    def test_role_attributes_drift_blocks_restoration(self):
        legacy = ("iam_app_runtime_login|t|f|f|f\n"
                  "iam_migrator_login|t|f|f|f\n"
                  "iam_worker_login|t|f|f|f")
        target = "iam_app_runtime_login|t|t|f|f"
        with patch.object(module, "scalar", side_effect=[legacy, target]):
            with self.assertRaisesRegex(module.GateBlocked, "BLOCKED_ROLE_ATTRIBUTES"):
                module.check_runtime_role_contract({}, {}, Path("/tmp"))
        memberships = ("iam_app_runtime_login|iam_app_runtime|f|t|t\n"
                       "iam_migrator_login|iam_migrator|f|f|t\n"
                       "iam_worker_login|iam_worker|f|t|t")
        with patch.object(module, "scalar", side_effect=[
            legacy, legacy, memberships, memberships
        ]):
            module.check_runtime_role_contract({}, {}, Path("/tmp"))

    def test_membership_set_option_drift_blocks_restoration(self):
        roles = ("iam_app_runtime_login|t|f|f|f\n"
                 "iam_migrator_login|t|f|f|f\n"
                 "iam_worker_login|t|f|f|f")
        source = ("iam_app_runtime_login|iam_app_runtime|f|t|t\n"
                  "iam_migrator_login|iam_migrator|f|f|t\n"
                  "iam_worker_login|iam_worker|f|t|t")
        wrong_set = source.replace("iam_app_runtime|f|t|t",
                                   "iam_app_runtime|f|t|f")
        with patch.object(module, "scalar", side_effect=[
            roles, roles, source, wrong_set
        ]):
            with self.assertRaisesRegex(module.GateBlocked,
                                        "BLOCKED_ROLE_MEMBERSHIPS"):
                module.check_runtime_role_contract({}, {}, Path("/tmp"))
        extra_grant = source + "\niam_worker_login|iam_owner|f|t|t"
        with patch.object(module, "scalar", side_effect=[
            roles, roles, source, extra_grant
        ]):
            with self.assertRaisesRegex(module.GateBlocked,
                                        "BLOCKED_ROLE_MEMBERSHIPS"):
                module.check_runtime_role_contract({}, {}, Path("/tmp"))
        with patch.object(module, "scalar", side_effect=[
            roles, roles, "", source
        ]):
            with self.assertRaisesRegex(module.GateBlocked,
                                        "BLOCKED_ROLE_MEMBERSHIPS"):
                module.check_runtime_role_contract({}, {}, Path("/tmp"))

    def test_expired_branch_fails_before_credential_use(self):
        from datetime import datetime, timezone
        with patch.object(module, "EXPIRES", datetime(2000, 1, 1, tzinfo=timezone.utc)), \
             patch.object(module, "docker_run") as d:
            with self.assertRaises(module.GateBlocked):
                module.execute("export_only")
            d.assert_not_called()

if __name__ == "__main__":
    unittest.main()
