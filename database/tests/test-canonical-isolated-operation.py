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

    def test_pg18_client_build_installs_trusted_ca_bundle_without_tls_downgrade(self):
        dockerfile = (HERE / "fixtures" / "pg18-system-ca.Dockerfile").read_text(encoding="utf8")
        workflow = (HERE.parent.parent / ".github" / "workflows" /
                    "iam-canonical-isolated-restore.yml").read_text(encoding="utf8")
        auth = workflow.split("\n  authenticated-export-and-optional-restore:", 1)[1]
        self.assertIn("FROM postgres:18-bookworm", dockerfile)
        self.assertIn("apt-get install -y --no-install-recommends ca-certificates", dockerfile)
        self.assertIn("update-ca-certificates", dockerfile)
        self.assertIn("test -s /etc/ssl/certs/ca-certificates.crt", dockerfile)
        self.assertIn("ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt", dockerfile)
        self.assertEqual(workflow.count("docker build --pull --file database/tests/fixtures/pg18-system-ca.Dockerfile"), 2)
        self.assertIn("PG18_CLIENT_IMAGE = \"iam-pg18-system-ca:local\"", (HERE.parent / "scripts" / "canonical-isolated-operation.py").read_text(encoding="utf8"))
        self.assertLess(auth.index("python3 database/scripts/guard-canonical-restore-target.py"),
                        auth.index("docker build --pull --file"))
        self.assertLess(auth.index("docker build --pull --file"),
                        auth.index("python3 database/scripts/canonical-isolated-operation.py"))
        self.assertEqual(module.pg_env(SOURCE)["PGSSLMODE"], "verify-full")
        self.assertEqual(module.pg_env(SOURCE)["PGSSLROOTCERT"], "system")
        self.assertNotIn("sslmode=require", dockerfile + workflow)
        self.assertNotIn("sslmode=disable", dockerfile + workflow)
        self.assertNotIn("PGSSLROOTCERT=none", dockerfile + workflow)

    def test_safe_failure_stage_and_category_without_stderr_leakage(self):
        import subprocess
        import tempfile
        failures = [
            (["psql", "-c", "SELECT 1"], "iam_schema_export_reader",
             "FATAL: password authentication failed for user SECRET_USER",
             "PG18_SOURCE_PREFLIGHT_AUTH_REJECTED"),
            (["psql", "-c", "SELECT 1"], "neondb_owner",
             "could not translate host name SECRET_HOST",
             "PG18_TARGET_PREFLIGHT_NETWORK"),
            (["psql", "-c", "SELECT 1"], "iam_schema_export_reader",
             "fe_sendauth: no password supplied PRIVATE HOST",
             "PG18_SOURCE_PREFLIGHT_AUTH_NO_PASSWORD"),
            (["psql", "-c", "SELECT 1"], "iam_schema_export_reader",
             "FATAL: password has expired SECRET_USER",
             "PG18_SOURCE_PREFLIGHT_AUTH_EXPIRED"),
            (["psql", "-c", "SELECT 1"], "iam_schema_export_reader",
             "FATAL: role SECRET_USER does not exist",
             "PG18_SOURCE_PREFLIGHT_AUTH_ROLE_MISSING"),
            (["pg_dump", "--schema-only"], "iam_schema_export_reader",
             "ERROR: permission denied for table secret_table",
             "PG18_SCHEMA_EXPORT_PRIVILEGE"),
            (["pg_restore", "--list"], "neondb_owner",
             "SSL error SECRET",
             "PG18_ARCHIVE_INSPECTION_TLS_HANDSHAKE"),
            (["psql", "-c", "SELECT 1"], "iam_schema_export_reader",
             "SSL error: certificate verify failed PRIVATE HOST",
             "PG18_SOURCE_PREFLIGHT_TLS_CERT_VERIFY"),
            (["psql", "-c", "SELECT 1"], "iam_schema_export_reader",
             "root certificate file PRIVATE PATH is missing",
             "PG18_SOURCE_PREFLIGHT_TLS_TRUST_STORE"),
            (["pg_restore", "--single-transaction"], "neondb_owner",
             "sensitive SQL statement here",
             "PG18_SCHEMA_RESTORE_UNCLASSIFIED"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            for args, role, stderr, expected in failures:
                completed = subprocess.CompletedProcess(args, 1, "", stderr)
                with (
                    self.subTest(expected=expected),
                    patch.object(module.subprocess, "run", return_value=completed),
                ):
                    with self.assertRaises(module.GateBlocked) as exc:
                        module.docker_run(args, {"PGUSER": role}, Path(tmp))
                    message = str(exc.exception)
                    self.assertIn(expected, message)
                    self.assertNotIn("SECRET", message)
                    self.assertNotIn("secret_table", message)
                    self.assertNotIn("sensitive SQL", message)

    def test_tls_probe_is_credential_free_and_not_restoration(self):
        workflow = (HERE.parent.parent / ".github" / "workflows" /
                    "iam-canonical-isolated-restore.yml").read_text(encoding="utf8")
        self.assertIn("          - tls_probe_only", workflow)
        self.assertIn("inputs.operation == 'tls_probe_only'", workflow)
        public = workflow.split("\n  public-tls-probe:", 1)[1].split(
            "\n  authenticated-export-and-optional-restore:", 1
        )[0]
        self.assertIn("needs: preflight-offline", public)
        # Jobs are isolated; preflight checkout does not persist into this job.
        checkout = "uses: actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09"
        self.assertIn(checkout, public)
        self.assertIn("persist-credentials: false", public)
        self.assertLess(public.index(checkout), public.index("docker build --pull --file"))
        self.assertLess(public.index(checkout), public.index("-starttls postgres"))
        self.assertIn("-starttls postgres", public)
        self.assertIn("-verify_hostname", public)
        self.assertIn("-verify_return_error", public)
        self.assertIn("ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech", public)
        self.assertIn("ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech", public)
        self.assertNotIn("secrets.", public)
        self.assertNotIn("environment:", public)
        self.assertNotIn("IAM_CANONICAL_SOURCE_URL", public)
        self.assertNotIn("IAM_CANONICAL_TARGET_URL", public)
        self.assertNotIn("pg_dump", public)
        self.assertNotIn("pg_restore", public)
        self.assertIn("iam-pg18-system-ca:local psql -X -w -q -f /dev/null", public)
        self.assertIn("docker build --pull --file database/tests/fixtures/pg18-system-ca.Dockerfile", public)
        self.assertTrue(public.index("docker build --pull --file") < public.index("iam-pg18-system-ca:local psql"))
        self.assertIn("PGSSLMODE=verify-full", public)
        self.assertIn("PGSSLROOTCERT=system", public)
        self.assertIn("iam_tls_probe_nonexistent_noauth", public)
        self.assertIn("PASS_PG18_LIBPQ_TLS_", public)
        self.assertIn("BLOCKED_PG18_LIBPQ_TLS_", public)
        self.assertIn("no password supplied|password authentication failed", public)
        self.assertIn("authentication refused as expected", public)
        self.assertNotIn("PGPASSWORD=", public)
        self.assertNotIn("IAM_CANONICAL_OPERATOR_APPROVAL", public)

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
             patch.object(module, "check_schema_export_lock_permissions"), \
             patch.object(module, "docker_run", side_effect=self.simulated_docker(calls)):
            module.execute("export_only")
        self.assertEqual([call[0] for call in calls], ["pg_dump", "pg_restore"])
        self.assertFalse(any("CREATE EXTENSION" in str(call) for call in calls))

    def test_restore_confirmation_allows_only_isolated_database(self):
        calls = []
        with self.env(approval=module.APPROVAL, confirm=module.CONFIRMATION), \
             patch.object(module, "check_source"), patch.object(module, "check_target"), \
             patch.object(module, "check_schema_export_lock_permissions"), \
             patch.object(module, "check_restored"), \
             patch.object(module, "check_restore_acl_principals"), \
             patch.object(module, "check_runtime_role_contract"), \
             patch.object(module, "check_migrator_owner_membership"), \
             patch.object(module, "check_pgcrypto_availability"), \
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
             patch.object(module, "check_schema_export_lock_permissions"), \
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

    def test_schema_lock_guard_fails_before_any_dump(self):
        for value in ("23|0", "23|22", ""):
            with self.subTest(value=value), patch.object(module, "scalar", return_value=value):
                with self.assertRaisesRegex(module.GateBlocked, "BLOCKED_SOURCE_SCHEMA_LOCK_PRIVILEGES"):
                    module.check_schema_export_lock_permissions({}, Path("/tmp"))
        with patch.object(module, "scalar", return_value="23|23"):
            module.check_schema_export_lock_permissions({}, Path("/tmp"))

    def test_migrator_owner_set_membership_must_match_on_both_branches(self):
        with patch.object(module, "scalar", side_effect=["f|f|t", "f|f|t"]):
            module.check_migrator_owner_membership({}, {}, Path("/tmp"))
        for target in ("", "f|t|t", "t|f|t", "f|f|f"):
            with self.subTest(target=target), patch.object(
                module, "scalar", side_effect=["f|f|t", target]
            ):
                with self.assertRaisesRegex(module.GateBlocked, "BLOCKED_MIGRATOR_OWNER_MEMBERSHIP"):
                    module.check_migrator_owner_membership({}, {}, Path("/tmp"))

    def test_pgcrypto_requirement_is_source_installed_target_available(self):
        with patch.object(module, "scalar", side_effect=["1", "1"]):
            module.check_pgcrypto_availability({}, {}, Path("/tmp"))
        with patch.object(module, "scalar", side_effect=["1", "0"]):
            with self.assertRaisesRegex(module.GateBlocked, "BLOCKED_PGCRYPTO"):
                module.check_pgcrypto_availability({}, {}, Path("/tmp"))

    def test_auth_only_pinned_source_target_identity_and_tls(self):
        cases = [
            ("iam_database|iam_schema_export_reader|iam_schema_export_reader|t", True),
            ("iam_database|iam_schema_export_reader|iam_schema_export_reader|f", False),
            ("iam_database|neondb_owner|neondb_owner|t", False),
            ("iam_canonical_validation|neondb_owner|neondb_owner|t", False),
        ]
        for result, good in cases:
            with self.subTest(result=result), patch.object(module, "scalar", return_value=result):
                if good:
                    module.check_authentication_only({}, module.mod.SOURCE_DATABASE,
                                                     module.mod.SOURCE_ROLE, Path("/tmp"))
                else:
                    with self.assertRaisesRegex(module.GateBlocked, "BLOCKED_AUTH_IDENTITY"):
                        module.check_authentication_only({}, module.mod.SOURCE_DATABASE,
                                                         module.mod.SOURCE_ROLE, Path("/tmp"))

    def test_auth_only_never_queries_iam_rows_or_runs_dump_restore(self):
        calls = []
        def fake_auth(creds, database, role, workspace):
            calls.append((database, role))
        with (
            self.env(confirm="NO_DDL"),
            patch.object(module, "check_authentication_only", side_effect=fake_auth),
            patch.object(module, "check_source") as check_source,
            patch.object(module, "check_target") as check_target,
            patch.object(module, "docker_run") as docker,
        ):
            module.execute("auth_only")
            check_source.assert_not_called()
            check_target.assert_not_called()
            docker.assert_not_called()
        self.assertEqual(calls, [
            ("iam_database", "iam_schema_export_reader"),
            ("iam_canonical_validation", "neondb_owner"),
        ])
        with self.env(confirm="RESTORE_BR_SWEET_UNION_ONLY"), patch.object(
            module, "docker_run"
        ) as docker:
            with self.assertRaisesRegex(module.GateBlocked, "read-only operation requires NO_DDL"):
                module.execute("auth_only")
            docker.assert_not_called()

    def test_auth_only_checks_target_even_when_source_auth_is_rejected(self):
        attempts = []
        def simulate(creds, db, role, workspace):
            attempts.append(db)
            if db == "iam_database":
                raise module.GateBlocked("PG18_SOURCE_PREFLIGHT_AUTH_REJECTED")
        with (
            self.env(confirm="NO_DDL"),
            patch.object(module, "check_authentication_only", side_effect=simulate),
            patch.object(module, "check_source") as check_source,
            patch.object(module, "check_target") as check_target,
            patch.object(module, "docker_run") as docker,
        ):
            with self.assertRaisesRegex(module.GateBlocked, "BLOCKED_AUTH_ONLY") as exc:
                module.execute("auth_only")
            self.assertIn("SOURCE: PG18_SOURCE_PREFLIGHT_AUTH_REJECTED", str(exc.exception))
            self.assertEqual(attempts, ["iam_database", "iam_canonical_validation"])
            check_source.assert_not_called()
            check_target.assert_not_called()
            docker.assert_not_called()

    def test_auth_only_workflow_is_protected_and_no_ddl(self):
        workflow = (HERE.parent.parent / ".github" / "workflows" /
                    "iam-canonical-isolated-restore.yml").read_text(encoding="utf8")
        self.assertIn("          - auth_only", workflow)
        self.assertIn("inputs.operation == 'auth_only'", workflow)
        auth = workflow.split("\n  authenticated-export-and-optional-restore:", 1)[1]
        self.assertIn("name: IAM-Canonical-Isolated-Restore", auth)
        self.assertIn("IAM_CANONICAL_CONFIRMATION: ${{ inputs.confirm_isolated_ddl }}", auth)
        self.assertIn("IAM_CANONICAL_OPERATION: ${{ inputs.operation }}", auth)
        self.assertIn("python3 database/scripts/guard-canonical-restore-target.py", auth)

    def test_readiness_reports_multiple_blockers_with_no_dump_or_ddl(self):
        with (
            self.env(confirm="NO_DDL"),
            patch.object(module, "check_source"),
            patch.object(module, "check_target"),
            patch.object(module, "check_restore_acl_principals"),
            patch.object(module, "check_runtime_role_contract"),
            patch.object(module, "check_pgcrypto_availability"),
            patch.object(module, "check_migrator_owner_membership",
                         side_effect=module.GateBlocked("BLOCKED_MIGRATOR_OWNER_MEMBERSHIP")),
            patch.object(module, "check_schema_export_lock_permissions",
                         side_effect=module.GateBlocked("BLOCKED_SOURCE_SCHEMA_LOCK_PRIVILEGES")),
            patch.object(module, "docker_run") as d,
        ):
            with self.assertRaises(module.GateBlocked) as exc:
                module.execute("readiness_only")
            self.assertIn("BLOCKED_MIGRATOR_OWNER_MEMBERSHIP", str(exc.exception))
            self.assertIn("BLOCKED_SOURCE_SCHEMA_LOCK_PRIVILEGES", str(exc.exception))
            d.assert_not_called()

    def test_readiness_pass_is_catalog_only_and_must_confirm_no_ddl(self):
        with (
            self.env(confirm="NO_DDL"),
            patch.object(module, "check_source"),
            patch.object(module, "check_target"),
            patch.object(module, "check_authenticated_readiness"),
            patch.object(module, "docker_run") as d,
        ):
            module.execute("readiness_only")
            d.assert_not_called()
        with self.env(confirm="RESTORE_BR_SWEET_UNION_ONLY"), patch.object(
            module, "docker_run"
        ) as d:
            with self.assertRaisesRegex(module.GateBlocked, "read-only operation requires NO_DDL"):
                module.execute("readiness_only")
            d.assert_not_called()

    def test_workflow_requires_protected_environment_for_readiness(self):
        workflow = (HERE.parent.parent / ".github" / "workflows" /
                    "iam-canonical-isolated-restore.yml").read_text(encoding="utf8")
        self.assertIn("          - readiness_only", workflow)
        self.assertIn("inputs.operation == 'readiness_only'", workflow)
        auth = workflow.split("\n  authenticated-export-and-optional-restore:", 1)[1]
        self.assertIn("environment:\n      name: IAM-Canonical-Isolated-Restore", auth)
        self.assertIn("IAM_CANONICAL_CONFIRMATION: ${{ inputs.confirm_isolated_ddl }}", auth)
        self.assertIn("IAM_CANONICAL_OPERATION: ${{ inputs.operation }}", auth)

    def test_expired_branch_fails_before_credential_use(self):
        from datetime import datetime, timezone
        with patch.object(module, "EXPIRES", datetime(2000, 1, 1, tzinfo=timezone.utc)), \
             patch.object(module, "docker_run") as d:
            with self.assertRaises(module.GateBlocked):
                module.execute("export_only")
            d.assert_not_called()

if __name__ == "__main__":
    unittest.main()
