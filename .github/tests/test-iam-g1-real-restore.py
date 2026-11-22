#!/usr/bin/env python3
"""Synthetic negative-security tests for real G1 restore harness. No SQL or B2."""
from __future__ import annotations

import importlib.util
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
        g1.ensure_lease(datetime(2026, 11, 22, 1, 0, tzinfo=timezone.utc))
        for instant in [
            datetime(2026, 11, 23, 12, 0, 1, tzinfo=timezone.utc),
            datetime(2026, 11, 24, 12, 0, tzinfo=timezone.utc),
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

    def test_ddl_never_runs_before_real_authenticated_tag_and_empty_db(self):
        with tempfile.TemporaryDirectory() as tmp:
            f = Path(tmp) / "ciphertext.aesgcm"
            f.write_bytes(b"x" * 110953)
            fake = mock.Mock(
                APPROVED_SIZE=110953, SOURCE_SHA="0ee3e512bb761ce4d81202eb77a48a1ef9c77109",
                APPROVED_OBJECT="approved", APPROVED_SHA256="0"*64
            )
            events = []
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
                mock.patch.object(g1, "pg18", side_effect=lambda *_a, **_kw: events.append("DDL_RESTORE")),
                mock.patch.object(g1, "table_counts", return_value={"iam.tenants": 0}),
                mock.patch.object(g1, "sql", return_value="0"),
                mock.patch.object(g1, "rollback_drill", side_effect=lambda *_: events.append("ROLLBACK")),
                mock.patch.object(g1, "cleanup_target", side_effect=lambda *_: events.append("CLEANUP")),
            ):
                g1.restore(env(IAM_G1_RESTORE_AES256_GCM_KEY_B64="AA=="))
            self.assertLess(events.index("AEAD_AUTH"), events.index("DDL_RESTORE"))
            self.assertLess(events.index("IDENTITY"), events.index("DDL_RESTORE"))
            self.assertLess(events.index("EMPTY_CHECK"), events.index("DDL_RESTORE"))
            self.assertLess(events.index("TOC_VERIFIED"), events.index("DDL_RESTORE"))
            self.assertEqual(events[-1], "CLEANUP")
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
            "IAM-G1-B2-Full-Readback-Custody", "IAM-G1-Full-Restore-Custody",
            "IAM_G1_RESTORE_AES256_GCM_KEY_B64", "IAM_G1_RESTORE_TARGET_DATABASE_URL",
            "IAM_G1_RESTORE_APPROVED_SHA", "retention-days: 1",
            "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
            "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093",
            "RESTORE_G1_FULL_B2_TO_EXACT_DISPOSABLE_ONLY",
            "pg18-security-contracts", "g1-real-restore-offline-contract",
        ]:
            with self.subTest(required=s):
                self.assertIn(s, w)
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
    unittest.main()
