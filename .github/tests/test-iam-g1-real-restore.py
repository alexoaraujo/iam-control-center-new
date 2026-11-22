#!/usr/bin/env python3
"""Synthetic negative-security tests for real G1 restore harness. No SQL or B2."""
from __future__ import annotations

import importlib.util
import contextlib
import io
import re
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
EXECUTOR = ROOT / "scripts/iam-g1-full-restore.py"
WORKFLOW = ROOT / ".github/workflows/iam-g1-b2-isolated-full-restore.yml"
spec = importlib.util.spec_from_file_location("iam_g1_real_restore", EXECUTOR)
g1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g1)

SHA = "a" * 40
HOST = g1.TARGET_HOST
TARGET = "postgresql://neondb_owner:p%40ss@" + HOST + "/" + g1.TARGET_DATABASE + "?sslmode=verify-full&sslrootcert=system&channel_binding=require"


def env(**kwargs):
    data = {
        "GITHUB_REPOSITORY": g1.REPOSITORY, "GITHUB_REF": "refs/heads/main",
        "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_SHA": SHA,
        "IAM_G1_RESTORE_APPROVED_SHA": SHA,
        "IAM_G1_RESTORE_CONFIRMATION": g1.CONFIRM,
        "IAM_G1_RESTORE_OPERATOR_APPROVAL": "DISPOSABLE_ONLY_APPROVED",
        "IAM_G1_RESTORE_PRIVATE_ESCROW": "PRIVATE_ESCROW_CONFIRMED",
        "IAM_G1_RESTORE_AES256_GCM_KEY_B64": "AA==" * 0,
        "IAM_G1_RESTORE_TARGET_DATABASE_URL": TARGET,
    }
    data.update(kwargs)
    return data


class Scope(unittest.TestCase):
    def test_trusted_main_exact_sha_confirmation(self):
        g1.assert_trusted_main(env(), confirm=True)
        for change in [
            {"GITHUB_REPOSITORY": "other/repo"},
            {"GITHUB_REF": "refs/pull/154/merge"},
            {"GITHUB_EVENT_NAME": "pull_request_target"},
            {"GITHUB_SHA": "invalid"},
            {"IAM_G1_RESTORE_APPROVED_SHA": "b" * 40},
            {"IAM_G1_RESTORE_OPERATOR_APPROVAL": "NOT_APPROVED"},
            {"IAM_G1_RESTORE_CONFIRMATION": "NO_DDL"},
        ]:
            with self.subTest(change=change), self.assertRaises(g1.Blocked):
                g1.assert_trusted_main(env(**change), confirm=True)

    def test_ttl_must_preserve_24h(self):
        # Independent operator approval: Neon disposable branch expires
        # 2026-11-27T12:00:00Z; the executor must fail closed below 24h.
        self.assertEqual(g1.EXPIRY.isoformat(), "2026-11-27T12:00:00+00:00")
        self.assertEqual(g1.HEADROOM.total_seconds(), 24 * 60 * 60)
        for instant in [
            datetime(2026, 11, 22, 1, 0, tzinfo=timezone.utc),
            datetime(2026, 11, 24, 12, 0, 1, tzinfo=timezone.utc),
            datetime(2026, 11, 26, 12, 0, 0, tzinfo=timezone.utc),
        ]:
            with self.subTest(at=instant):
                g1.ensure_lease(instant)
        for instant in [
            datetime(2026, 11, 26, 12, 0, 1, tzinfo=timezone.utc),
            datetime(2026, 11, 27, 12, 0, 0, tzinfo=timezone.utc),
        ]:
            with self.subTest(at=instant), self.assertRaisesRegex(g1.Blocked, "HEADROOM"):
                g1.ensure_lease(instant)

    def test_url_requires_exact_disposable_direct_tls_and_role(self):
        self.assertEqual(g1.parse_target(TARGET), "p@ss")
        failures = [
            TARGET.replace(g1.TARGET_DATABASE, "iam_database"),
            TARGET.replace(g1.TARGET_DATABASE, "neondb"),
            TARGET.replace(g1.TARGET_HOST, "ep-production.c-2.sa-east-1.aws.neon.tech"),
            TARGET.replace(g1.TARGET_HOST, g1.TARGET_HOST.replace(".c-2", "-pooler.c-2")),
            TARGET.replace("neondb_owner:", "iam_app_runtime:"),
            TARGET.replace(HOST, HOST + ":5433"),
            TARGET.replace("sslmode=verify-full", "sslmode=require"),
            TARGET.replace("sslrootcert=system", "sslrootcert=unsafe"),
            TARGET + "&options=-c+role%3Dneondb_owner",
            TARGET + "#fragment",
            TARGET + "\n",
        ]
        for bad in failures:
            with self.subTest(uri="sanitized"), self.assertRaises(g1.Blocked):
                g1.parse_target(bad)

    def test_pg_allowlist_prevents_prod_or_source_db(self):
        for name in ("postgres", "iam_canonical_validation", "production", "other"):
            with self.subTest(name=name), self.assertRaisesRegex(g1.Blocked, "ALLOWLIST"):
                g1.pg_environment("synthetic", database=name)
        e = g1.pg_environment("synthetic")
        self.assertEqual(e["PGHOST"], HOST)
        self.assertEqual(e["PGDATABASE"], g1.TARGET_DATABASE)
        self.assertEqual(e["PGSSLMODE"], "verify-full")
        self.assertEqual(e["PGSSLROOTCERT"], "system")

    def test_pg18_subprocess_never_emits_url_or_password_to_argv(self):
        pg_env = g1.pg_environment("not-a-real-secret")
        with mock.patch.object(g1.subprocess, "run") as runner:
            runner.return_value = mock.Mock(returncode=0, stdout=b"PASS")
            self.assertEqual(g1.pg18(["psql", "-X", "-c", "SELECT 1"], pg_env), b"PASS")
            arguments = runner.call_args.args[0]
            self.assertEqual(arguments[-4:], ["psql", "-X", "-c", "SELECT 1"])
            self.assertNotIn("not-a-real-secret", str(arguments))
            self.assertIn("--read-only", arguments)
            self.assertIn("--cap-drop=ALL", arguments)

    def test_failed_pg18_step_has_only_fixed_redacted_phase_code(self):
        # Synthetic failures only: no network, B2, real SQL or custody secrets.
        pg_env = g1.pg_environment("SYNTHETIC_PRIVATE_PASSWORD")
        for phase in ("REFERENCE_IDENTITY", "REFERENCE_CATALOG",
                      "ARCHIVE_TOC", "RESTORE_APPLY", "CLEANUP"):
            with self.subTest(phase=phase):
                with mock.patch.object(g1.subprocess, "run") as runner:
                    runner.return_value = mock.Mock(
                        returncode=1, stdout=b"",
                        stderr=b"SYNTHETIC_PRIVATE_PASSWORD SQL SAMPLE"
                    )
                    with self.assertRaises(g1.Blocked) as caught:
                        g1.pg18_phase(phase, lambda: g1.pg18(
                            ["psql", "-X", "-c", "SELECT 1"], pg_env))
                    self.assertEqual(
                        str(caught.exception),
                        "BLOCKED_G1_RESTORE_PG18_" + phase + "_FAILED",
                    )
                    self.assertNotIn("SYNTHETIC_PRIVATE_PASSWORD",
                                     str(caught.exception))
                    self.assertEqual(runner.call_args.kwargs["stderr"],
                                     g1.subprocess.DEVNULL)

    def test_pg18_apply_failure_reports_fixed_category_never_raw_stderr(self):
        # A simulated server error may echo SQL, row data or role identifiers.
        # Only a closed category may ever escape to GitHub Actions logs.
        examples = {
            "ROLE_MISSING": b'pg_restore: error: ERROR: role "PRIVATE_ROLE" does not exist; SELECT PRIVATE_ROW',
            "ROLE_MEMBERSHIP": b'ERROR: must be member of role PRIVATE_ROLE; SQL PRIVATE_ROW',
            "OWNER_PRIVILEGES": b'ERROR: must be owner of table PRIVATE_TABLE; PRIVATE_ROW',
            "PERMISSION_DENIED": b'ERROR: permission denied for schema PRIVATE_SCHEMA; PRIVATE_ROW',
            "EXTENSION_UNAVAILABLE": b'ERROR: extension "PRIVATE_EXT" is not available',
            "OBJECT_ALREADY_EXISTS": b'ERROR: relation "PRIVATE_TABLE" already exists',
            "TRANSACTION_RESTRICTION": b'ERROR: cannot run inside a transaction block',
            "INVALID_PARAMETER": b'ERROR: unrecognized configuration parameter "PRIVATE_KEY"',
            "ROW_CONSTRAINT": b'ERROR: violates foreign key constraint PRIVATE_ROW',
            "DUPLICATE_KEY": b'ERROR: duplicate key value violates unique constraint PRIVATE_ROW',
            "RLS_DENIED": b'ERROR: new row violates row-level security policy PRIVATE_ROW',
            "CONNECTIVITY": b'ERROR: connection to server was lost and server closed the connection',
            "UNCLASSIFIED": b'ERROR: unexpected PRIVATE_ROW and PRIVATE_PASSWORD',
        }
        for expected, raw in examples.items():
            with self.subTest(expected=expected):
                pg_env = g1.pg_environment("PRIVATE_PASSWORD")
                with mock.patch.object(g1.subprocess, "run") as runner:
                    runner.return_value = mock.Mock(returncode=1, stdout=b"", stderr=raw)
                    with self.assertRaises(g1.Blocked) as caught:
                        g1.pg18_phase("RESTORE_APPLY", lambda: g1.pg18(
                            ["pg_restore", "--single-transaction", "--exit-on-error",
                             "--dbname=" + g1.TARGET_DATABASE],
                            pg_env, data=b"PGDMP" + b"\x00" * 100))
                    self.assertEqual(
                        str(caught.exception),
                        "BLOCKED_G1_RESTORE_PG18_RESTORE_APPLY_" + expected)
                    self.assertNotIn("PRIVATE_", str(caught.exception))
                    self.assertEqual(runner.call_args.kwargs["stderr"],
                                     g1.subprocess.PIPE)
        self.assertEqual(g1.classify_restore_apply_error(b"PRIVATE_ROW" * 20000),
                         "UNCLASSIFIED")
        self.assertEqual(g1.classify_restore_apply_error(None), "UNCLASSIFIED")
        # Do not infer role/privilege errors from raw SQL echoed after
        # pg_restore's "Command was:" diagnostic.
        echoed = (
            b"pg_restore: error: could not execute query: ERROR: unexpected failure"
            + bytes([10]) + b'Command was: role "PRIVATE_ROLE" does not exist;'
        )
        self.assertEqual(g1.classify_restore_apply_error(echoed), "UNCLASSIFIED")
        self.assertEqual(g1.classify_restore_apply_error(
            b'Command was: role "PRIVATE_ROLE" does not exist;'
        ), "UNCLASSIFIED")
        # Do not collect database errors in unrelated PG commands.
        with mock.patch.object(g1.subprocess, "run") as runner:
            runner.return_value = mock.Mock(returncode=1, stdout=b"", stderr=None)
            with self.assertRaisesRegex(g1.Blocked, "PG18_STEP_FAILED"):
                g1.pg18(["psql", "-X", "-c", "SELECT 1"],
                        g1.pg_environment("PRIVATE_PASSWORD"))
            self.assertEqual(runner.call_args.kwargs["stderr"], g1.subprocess.DEVNULL)

    def test_pg18_custom_archive_toc_reads_stdin_without_dash_filename(self):
        # Offline synthetic TOC; never decrypts B2 ciphertext or contacts Neon.
        toc_lines = [
            f"{i}; 0 0 TABLE iam t{i} neondb_owner" for i in range(1, 24)
        ]
        toc_lines += ["24; 0 0 TABLE DATA iam t1 neondb_owner"]
        toc_lines += [
            f"{25+i}; 0 0 POLICY iam t1 p{i} neondb_owner"
            for i in range(41)
        ]
        toc_lines += ["66; 0 0 EXTENSION - pgcrypto neondb_owner"]
        archive = b"PGDMP" + (b"\x00" * 260)
        with mock.patch.object(g1, "pg18", return_value=(
                "\n".join(toc_lines) + "\n").encode("utf-8")) as reader:
            g1.verify_archive_toc(archive, {"PGDATABASE": g1.TARGET_DATABASE})
            reader.assert_called_once()
            self.assertEqual(reader.call_args.args[0], ["pg_restore", "--list"])
            self.assertEqual(reader.call_args.kwargs["data"], archive)
            # Removing one TABLE definition must fail, even if TABLE DATA
            # remains. Never let data entries satisfy table-definition count.
            reader.return_value = ("\n".join(toc_lines[1:]) + "\n").encode("utf-8")
            with self.assertRaisesRegex(g1.Blocked, "ARCHIVE_TOC_PARITY"):
                g1.verify_archive_toc(archive, {"PGDATABASE": g1.TARGET_DATABASE})

    def test_neon_managed_default_acl_filter_is_exact_and_fail_closed(self):
        toc = ("1; 826 16607 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES cloud_admin\n"
               "2; 826 16608 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES cloud_admin\n"
               "3; 826 16609 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES neondb_owner\n"
               "4; 826 16610 DEFAULT ACL iam DEFAULT PRIVILEGES FOR TABLES iam_owner\n")
        filtered = g1.filtered_cloud_admin_toc(toc.encode()).decode()
        self.assertIn(";1; 826 16607 DEFAULT ACL public", filtered)
        self.assertIn(";2; 826 16608 DEFAULT ACL public", filtered)
        self.assertIn("\n3; 826 16609 DEFAULT ACL public", filtered)
        self.assertIn("\n4; 826 16610 DEFAULT ACL iam", filtered)
        variations = [
            toc.replace("FOR TABLES cloud_admin", "FOR FUNCTIONS cloud_admin", 1),
            toc.replace("FOR SEQUENCES cloud_admin", "FOR TABLES cloud_admin", 1),
            toc.replace("public DEFAULT PRIVILEGES FOR TABLES cloud_admin",
                        "iam DEFAULT PRIVILEGES FOR TABLES cloud_admin", 1),
            toc + "5; 826 16611 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES cloud_admin\n",
        ]
        for bad in variations:
            with self.subTest(invalid="redacted"), self.assertRaises(g1.Blocked):
                g1.filtered_cloud_admin_toc(bad.encode())

    def test_filtered_toc_file_never_contains_plaintext_and_is_erased(self):
        with tempfile.TemporaryDirectory() as temp:
            content = b";1; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES cloud_admin\n"
            archive = b"PGDMP" + b"PRIVATE_PLAINTEXT"
            def check_mount(args, pg_env, **kw):
                p = kw["toc_file"]
                self.assertEqual(p.read_bytes(), content)
                self.assertNotIn(archive, p.read_bytes())
                self.assertIn("--use-list=/tmp/iam-g1-filtered-toc.list", args)
                self.assertEqual(kw["data"], archive)
                return b""
            with mock.patch.dict(g1.os.environ, {"RUNNER_TEMP":temp}), \
                 mock.patch.object(g1, "pg18", side_effect=check_mount):
                g1.apply_filtered_restore(archive, {}, content)
            self.assertFalse((Path(temp) / "iam-g1-filtered-toc.list").exists())

    def test_pg18_phase_cannot_be_controlled_or_mask_non_pg_block(self):
        with self.assertRaisesRegex(g1.Blocked, "UNTRUSTED_DIAGNOSTIC_PHASE"):
            g1.pg18_phase("SECRETS_IN_LOG", lambda: None)
        with self.assertRaisesRegex(g1.Blocked, "TARGET_NOT_EMPTY"):
            g1.pg18_phase("TARGET_EMPTY", lambda: (_ for _ in ()).throw(
                g1.Blocked("BLOCKED_G1_RESTORE_TARGET_NOT_EMPTY")))

    def test_ddl_never_runs_before_real_authenticated_tag_and_empty_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "ciphertext.aesgcm"
            f.write_bytes(b"x" * 110953)
            fake = mock.Mock(
                APPROVED_SIZE=110953, SOURCE_SHA="0ee3e512bb761ce4d81202eb77a48a1ef9c77109",
                APPROVED_OBJECT="approved", APPROVED_SHA256="0"*64
            )
            events = []
            pg_restore_calls = []

            def capture_pg_restore(args, _pg_env, **kwargs):
                events.append("DDL_RESTORE")
                pg_restore_calls.append((args, kwargs))
                return b""

            def auth(*a, **kw):
                events.append("AEAD_AUTH")
                return b"PGDMP" + b"\x00" * 600
            fake.authenticate_envelope.side_effect = auth
            fake.approved_identity.return_value = None
            with (
                mock.patch.object(g1, "ensure_lease"),
                mock.patch.object(g1, "attest_restore_environment"),
                mock.patch.object(g1, "parse_target", return_value="synthetic"),
                mock.patch.object(g1, "aead", return_value=fake),
                mock.patch.object(g1, "stage_path", return_value=f),
                mock.patch("base64.b64decode", return_value=bytes(range(32))),
                mock.patch.object(g1, "pg_environment", side_effect=lambda _p, database=g1.TARGET_DATABASE: {"PGDATABASE": database}),
                mock.patch.object(g1, "identity", side_effect=lambda *_: events.append("IDENTITY")),
                mock.patch.object(g1, "assert_empty", side_effect=lambda *_: events.append("EMPTY_CHECK")),
                mock.patch.object(g1, "catalog", return_value=("23", "41", "20", "1", "0") + ("x",)*4),
                mock.patch.object(g1, "verify_archive_toc", side_effect=lambda *_: events.append("TOC_VERIFIED")),
                mock.patch.object(g1, "cloud_admin_defaults", return_value="2|synthetic"),
                mock.patch.object(g1, "filtered_cloud_admin_toc", return_value=b"filtered-toc"),
                mock.patch.object(g1, "apply_filtered_restore", side_effect=lambda archive, pe, toc:
                                  capture_pg_restore(["pg_restore", "--single-transaction",
                                                      "--exit-on-error",
                                                      "--dbname=" + g1.TARGET_DATABASE],
                                                     pe, data=archive)),

                mock.patch.object(g1, "table_counts", return_value={"iam.tenants": 0}),
                mock.patch.object(g1, "sql", return_value="0"),
                mock.patch.object(g1, "rollback_drill", side_effect=lambda *_: events.append("ROLLBACK")),
                mock.patch.object(g1, "cleanup_target", side_effect=lambda *_: events.append("CLEANUP")),
            ):
                # Real-restore PASS markers emitted by the mocked executor are
                # INTERNAL test data, never operational audit evidence.
                with contextlib.redirect_stdout(io.StringIO()) as synthetic_log:
                    g1.restore(env(IAM_G1_RESTORE_AES256_GCM_KEY_B64="AA=="))
            self.assertIn("PASS_G1_RESTORE_ACTUAL_AES256_GCM_TAG_VERIFIED_BEFORE_DDL",
                          synthetic_log.getvalue())
            self.assertIn("PASS_G1_FULL_B2_ARCHIVE_RESTORED_AUDITED_AND_REMOVED_ISOLATED",
                          synthetic_log.getvalue())
            self.assertLess(events.index("AEAD_AUTH"), events.index("DDL_RESTORE"))
            self.assertLess(events.index("IDENTITY"), events.index("DDL_RESTORE"))
            self.assertLess(events.index("EMPTY_CHECK"), events.index("DDL_RESTORE"))
            self.assertLess(events.index("TOC_VERIFIED"), events.index("DDL_RESTORE"))
            self.assertEqual(events[-1], "CLEANUP")
            self.assertEqual(len(pg_restore_calls), 1)
            self.assertEqual(pg_restore_calls[0][0], [
                "pg_restore", "--single-transaction", "--exit-on-error",
                "--dbname=" + g1.TARGET_DATABASE,
            ])
            self.assertEqual(pg_restore_calls[0][1]["data"],
                             b"PGDMP" + b"\x00" * 600)
            self.assertFalse(f.exists())

    def test_failed_cryptographic_auth_does_no_ddl(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "ciphertext.aesgcm"
            f.write_bytes(b"x" * 110953)
            fake = mock.Mock(APPROVED_SIZE=110953, SOURCE_SHA="a"*40,
                             APPROVED_OBJECT="x", APPROVED_SHA256="0"*64)
            fake.authenticate_envelope.side_effect = g1.Blocked("BLOCKED_G1_ARCHIVE_AEAD_AUTHENTICATION")
            with (
                mock.patch.object(g1, "ensure_lease"),
                mock.patch.object(g1, "attest_restore_environment"),
                mock.patch.object(g1, "parse_target", return_value="synthetic"),
                mock.patch.object(g1, "aead", return_value=fake),
                mock.patch.object(g1, "stage_path", return_value=f),
                mock.patch("base64.b64decode", return_value=bytes(range(32))),
                mock.patch.object(g1, "pg18") as pg,
                mock.patch.object(g1, "cleanup_target") as cleanup,
            ):
                with self.assertRaisesRegex(g1.Blocked, "AEAD_AUTHENTICATION"):
                    g1.restore(env(IAM_G1_RESTORE_AES256_GCM_KEY_B64="AA=="))
                pg.assert_not_called()
                cleanup.assert_not_called()

    def test_workflow_privileged_main_only_separate_custody(self):
        w = WORKFLOW.read_text()
        for s in [
            "workflow_dispatch:", "refs/heads/main", "preflight-no-secrets:",
            "--attest-env", "Attest restore Environment policy before B2 or secret access",
            "IAM-G1-B2-Full-Readback-Custody", "IAM-G1-Full-Restore-Custody",
            "IAM_G1_RESTORE_AES256_GCM_KEY_B64", "IAM_G1_RESTORE_TARGET_DATABASE_URL",
            "IAM_G1_RESTORE_APPROVED_SHA", "retention-days: 1",
            "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
            'gh run download "$GITHUB_RUN_ID"',
            '--name "iam-g1-ciphertext-${GITHUB_RUN_ID}"',
            'GH_TOKEN: ${{ github.token }}',
            "PASS_G1_RESTORE_SAME_RUN_CIPHERTEXT_STAGED",
            "RESTORE_G1_FULL_B2_TO_EXACT_DISPOSABLE_ONLY",
            "iam-g1-verify-main-checks.py", "gh api --paginate --slurp",
        ]:
            with self.subTest(required=s):
                self.assertIn(s, w)
        # Do not expand the GitHub Allowed actions allowlist to a new SHA or
        # allow selection of artifacts from a different workflow run.
        self.assertNotIn("actions/download-artifact@", w)
        self.assertNotIn("gh run download --name", w)
        self.assertIn('gh run download "$GITHUB_RUN_ID"', w)
        self.assertIn('GH_TOKEN: ${{ github.token }}', w)
        self.assertIn("    needs: stage-encrypted-ciphertext", w)
        self.assertIn("      actions: read", w)
        self.assertLess(w.index("Download same-run encrypted artifact using trusted GitHub CLI"),
                        w.index("Build PostgreSQL 18 libpq client with system CA"))
        # Required check names intentionally moved to the trusted, tested
        # all-pages verifier. Verify they are still mandatory there.
        verifier = (ROOT / ".github/scripts/iam-g1-verify-main-checks.py").read_text()
        for name in ("quality", "pg18-security-contracts",
                     "g1-real-restore-offline-contract"):
            with self.subTest(main_check=name):
                self.assertIn('"' + name + '"', verifier)
        self.assertLess(
            w.index("Attest restore Environment policy before B2 or secret access"),
            w.index("stage-encrypted-ciphertext:"),
        )
        # GitHub expressions must be fully closed, e.g. ${{ github.sha }}.
        self.assertNotRegex(w, r"\$\{\{[^}]*\}(?!\})")
        self.assertGreaterEqual(len(re.findall(r"\$\{\{[^}]*\}\}", w)), 15)
        for prohibited in ["pull_request_target:", "secrets.IAM_G1_B2_FULL_WRITER_ACCESS_KEY_ID"]:
            self.assertNotIn(prohibited, w)

    def test_executor_no_production_host_or_automatic_dispatch(self):
        script = EXECUTOR.read_text()
        self.assertNotIn("br-little-fire-b6adup9f", script)
        self.assertNotIn("br-muddy-snow-b63cepcv", script)
        self.assertNotIn("iam-control-center-new.vercel.app", script)
        self.assertNotIn("subprocess.Popen(", script)
        self.assertIn("DROP DATABASE ", script)
        self.assertIn("pg_restore", script)
        self.assertIn("authenticate_envelope", script)


if __name__ == "__main__":
    # Suppress all test stdout from successful cases as an additional safety net.
    unittest.main(buffer=True)
