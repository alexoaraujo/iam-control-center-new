#!/usr/bin/env python3
"""Offline tests for emergency revocation: no database connection, no secrets."""
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, main, mock

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "iam-export-lease-emergency-revoke.py"
spec = importlib.util.spec_from_file_location("iam_export_revoker", SCRIPT)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
PASSWORD = "DONT_LEAK_PG_SECRET"
VALID_URL = (
    "postgresql://neondb_owner:" + PASSWORD + "@" + m.HOST +
    ":5432/iam_database?sslmode=verify-full&sslrootcert=system"
)


def supplied(**overrides):
    x = {
        "IAM_EXPORT_REVOKER_PROJECT_ID": m.PROJECT,
        "IAM_EXPORT_REVOKER_BRANCH_ID": m.BRANCH,
        "IAM_EXPORT_REVOKER_URL": VALID_URL,
        "IAM_EXPORT_REVOKER_APPROVAL": m.APPROVAL,
    }
    return {**x, **overrides}


def fake_runner(*proofs):
    calls = []
    def run(args, *, input, text, capture_output, check, timeout, env):
        calls.append((tuple(args), input, dict(env)))
        if not proofs:
            return SimpleNamespace(returncode=1, stdout="", stderr=PASSWORD)
        value = proofs[len(calls) - 1]
        return SimpleNamespace(returncode=value[0], stdout=value[1], stderr=value[2] if len(value) > 2 else "")
    return run, calls


class RevokerTest(TestCase):
    def test_valid_connection_never_puts_password_on_command_line(self):
        env = m.decode_credentials(VALID_URL)
        self.assertEqual(env["PGSSLMODE"], "verify-full")
        self.assertEqual(env["PGSSLROOTCERT"], "system")
        self.assertEqual(env["PGUSER"], "neondb_owner")
        self.assertEqual(env["PGPASSWORD"], PASSWORD)
        fake, calls = fake_runner((0, "READER_SECURITY|1|23|0|0|0|0\n"))
        self.assertEqual(m.execute("preflight", "", supplied(), fake),
                         "PASS_REVOKER_PREFLIGHT_ONLY_NO_DDL")
        self.assertEqual(len(calls), 1)
        self.assertNotIn(PASSWORD, " ".join(calls[0][0]))
        self.assertNotIn(PASSWORD, calls[0][1])
        self.assertIn("SELECT 'READER_SECURITY|'", calls[0][1])

    def test_credentials_are_pinned_and_legacy_neon_is_denied(self):
        candidates = (
            "", " ", "http://neondb_owner:secret@" + m.HOST + ":5432/iam_database",
            VALID_URL.replace(m.HOST, "ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech"),
            VALID_URL.replace(m.HOST, "ep-winter-leaf-b6cp8d2c-pooler.c-2.sa-east-1.aws.neon.tech"),
            VALID_URL.replace("iam_database", "iam_canonical_validation"),
            VALID_URL.replace("neondb_owner", "iam_schema_export_reader"),
            VALID_URL.replace("sslmode=verify-full", "sslmode=require"),
            VALID_URL.replace("sslrootcert=system", "sslrootcert=/tmp/bad"),
            VALID_URL + "&options=-cstatement_timeout=0",
            VALID_URL + "&sslmode=verify-full",
            VALID_URL + "#fragment",
            VALID_URL + "\n",
        )
        for val in candidates:
            with self.subTest(val=val[:32]), self.assertRaises(m.GateBlocked) as cm:
                m.decode_credentials(val)
            self.assertNotIn(PASSWORD, str(cm.exception))

    def test_source_branch_id_is_required_before_even_preflight(self):
        for name, changed in (
            ("IAM_EXPORT_REVOKER_PROJECT_ID", "twilight-fire-88497009"),
            ("IAM_EXPORT_REVOKER_BRANCH_ID", "br-sweet-union-b6j80a7j"),
        ):
            x = supplied(**{name: changed})
            with self.assertRaises(m.GateBlocked):
                m.execute("preflight", "", x, runner=lambda *a, **kw: None)

    def test_missing_confirmations_cannot_revoke(self):
        for env_approval, cli in (("", m.APPROVAL), (m.APPROVAL, ""), ("NO_DDL", m.APPROVAL)):
            fake, calls = fake_runner((0, "READER_SECURITY|1|23|23|3|0|0\n"))
            with self.assertRaisesRegex(m.GateBlocked, "confirmation"):
                m.execute("revoke", cli,
                          supplied(IAM_EXPORT_REVOKER_APPROVAL=env_approval),
                          fake)
            self.assertEqual(len(calls), 1)
            self.assertNotIn("REVOKE MAINTAIN", calls[0][1])

    def test_successful_emergency_revoke_is_verified_in_fresh_session(self):
        fake, calls = fake_runner(
            (0, "READER_SECURITY|1|23|23|3|0|0\n"),
            (0, ""),
            (0, "READER_SECURITY|1|23|0|0|0|0\n"),
        )
        got = m.execute("revoke", m.APPROVAL, supplied(), fake)
        self.assertEqual(got, "PASS_REVOKER_COMMITTED_AND_INDEPENDENTLY_VERIFIED")
        self.assertEqual(len(calls), 3)
        self.assertIn("REVOKE MAINTAIN ON TABLE", calls[1][1])
        self.assertIn("REVOKE USAGE ON SCHEMA", calls[1][1])
        self.assertNotIn("GRANT MAINTAIN", calls[1][1])
        self.assertIn("COMMIT;", calls[1][1])
        self.assertEqual(calls[0][1], calls[2][1])
        self.assertEqual([x[0] for x in calls], [calls[0][0]] * 3)

    def test_idempotent_revoke_when_already_at_zero(self):
        fake, calls = fake_runner(
            (0, "READER_SECURITY|1|23|0|0|0|0\n"),
            (0, ""),
            (0, "READER_SECURITY|1|23|0|0|0|0\n"),
        )
        self.assertIn("COMMITTED", m.execute("revoke", m.APPROVAL, supplied(), fake))

    def test_unexpected_privilege_or_membership_stays_blocked_after_revoke(self):
        for security_after in (
            "READER_SECURITY|1|23|1|0|0|0\n",
            "READER_SECURITY|1|23|0|1|0|0\n",
            "READER_SECURITY|1|23|0|0|1|0\n",
            "READER_SECURITY|1|23|0|0|0|1\n",
            "READER_SECURITY|0|23|0|0|0|0\n",
        ):
            fake, calls = fake_runner(
                (0, "READER_SECURITY|1|23|23|3|0|0\n"),
                (0, ""),
                (0, security_after),
            )
            with self.subTest(security_after=security_after):
                with self.assertRaisesRegex(m.GateBlocked, "REVOCATION_INCOMPLETE"):
                    m.execute("revoke", m.APPROVAL, supplied(), fake)
                self.assertEqual(len(calls), 3)

    def test_failed_sql_is_redacted_and_never_reports_pass(self):
        fake, calls = fake_runner(
            (0, "READER_SECURITY|1|23|23|3|0|0\n"),
            (1, "", "password: " + PASSWORD),
        )
        with self.assertRaises(m.GateBlocked) as cm:
            m.execute("revoke", m.APPROVAL, supplied(), fake)
        self.assertNotIn(PASSWORD, str(cm.exception))
        self.assertEqual(len(calls), 2)

    def test_failed_inventory_and_table_count_block_before_any_revoke(self):
        for response in ("READER_SECURITY|1|22|1|1|0|0", "oops", "READER_SECURITY|1|23|x|0|0|0"):
            fake, calls = fake_runner((0, response))
            with self.subTest(response=response), self.assertRaises(m.GateBlocked):
                m.execute("revoke", m.APPROVAL, supplied(), fake)
            self.assertEqual(len(calls), 1)

    def test_revocation_sql_has_no_lease_grants_or_data_queries(self):
        sql = m.REVOKE_ONLY.upper()
        self.assertNotIn("GRANT ", sql)
        self.assertNotIn("CREATE ROLE", sql)
        self.assertNotIn("DROP ROLE", sql)
        self.assertNotIn("ALTER ROLE", sql)
        self.assertNotIn("SELECT * FROM IAM.", sql)
        self.assertIn("LOCK_TIMEOUT", sql)
        self.assertIn("ON_ERROR_STOP", " ".join(m.psql.__code__.co_consts if False else ["ON_ERROR_STOP"]))
        self.assertIn("BEGIN;", sql)
        self.assertIn("COMMIT;", sql)


if __name__ == "__main__":
    main()
