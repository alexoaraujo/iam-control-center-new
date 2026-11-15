#!/usr/bin/env python3
"""Offline contract tests: no real PostgreSQL, Neon secrets, or DDL."""
import importlib.util
from pathlib import Path
import subprocess
import unittest

P = Path(__file__).resolve().parents[1] / "scripts/iam-g1-disposable-emergency-revoke.py"
s = importlib.util.spec_from_file_location("g1_disposable_revoke", P)
rev = importlib.util.module_from_spec(s)
s.loader.exec_module(rev)

GOOD_URL = (
    "postgresql://neondb_owner:FAKE%21ONLY@"
    "ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech:5432/"
    "iam_database?sslmode=verify-full&sslrootcert=system"
)
ZERO = "G1_STATE|1|3|23|1|3|20|0|0|0|0|0"
LEASED = "G1_STATE|1|3|23|1|3|20|3|24|0|0|0"
PARTIAL = "G1_STATE|1|3|23|1|3|20|3|23|0|0|0"
UNSAFE = "G1_STATE|1|3|23|1|3|20|0|0|1|0|0"

def config():
    return {
        "IAM_G1_DISPOSABLE_PROJECT_ID": rev.PROJECT,
        "IAM_G1_DISPOSABLE_BRANCH_ID": rev.BRANCH,
        "IAM_G1_DISPOSABLE_REVOKER_URL": GOOD_URL,
        "IAM_G1_DISPOSABLE_REVOKER_APPROVAL": rev.LATCH,
    }

class Runner:
    def __init__(self, states):
        self.states = iter(states)
        self.statements = []
    def __call__(self, args, **kwargs):
        assert args == ["psql", "-X", "-w", "-At", "-v", "ON_ERROR_STOP=1"]
        assert "PGPASSWORD" in kwargs["env"]
        statement = kwargs["input"]
        self.statements.append(statement)
        if statement == rev.INVENTORY:
            return subprocess.CompletedProcess(args, 0, next(self.states) + "\n", "")
        if statement == rev.REVOKE_SQL:
            return subprocess.CompletedProcess(args, 0, "", "")
        raise AssertionError("unexpected SQL")

class Contracts(unittest.TestCase):
    def test_exact_branch_and_tls(self):
        p = rev.connect_env(GOOD_URL)
        self.assertEqual((p["PGHOST"],p["PGUSER"],p["PGSSLMODE"],p["PGSSLROOTCERT"]),
                         (rev.HOST, rev.ADMIN, "verify-full", "system"))
        for bad in (
            GOOD_URL.replace(rev.HOST, "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"),
            GOOD_URL.replace("neondb_owner", "iam_schema_export_reader"),
            GOOD_URL.replace("verify-full", "require"),
            GOOD_URL.replace("sslrootcert=system", "sslrootcert=/tmp/ca"),
            GOOD_URL.replace("iam_database", "neondb"),
            GOOD_URL.replace(":5432/", ":6432/"),
            GOOD_URL + "&application_name=override",
            "",
        ):
            with self.subTest(bad=bad[:20]), self.assertRaises(rev.Blocked):
                rev.connect_env(bad)

    def test_missing_or_incorrect_branch_id_blocks_before_psql(self):
        for key, value in (("IAM_G1_DISPOSABLE_PROJECT_ID","wrong"),
                           ("IAM_G1_DISPOSABLE_BRANCH_ID","br-ancient-term-b6mmx5ol")):
            c = config()
            c[key] = value
            with self.assertRaises(rev.Blocked):
                rev.execute("preflight","",c,Runner([]))

    def test_preflight_zero_and_full_lease_without_mutation(self):
        for state in (ZERO,LEASED):
            runner = Runner([state])
            self.assertIn("PREFLIGHT",rev.execute("preflight","",config(),runner))
            self.assertEqual(runner.statements, [rev.INVENTORY])

    def test_partial_lease_and_select_fail_closed(self):
        for state in (PARTIAL,UNSAFE):
            with self.assertRaises(rev.Blocked):
                rev.execute("preflight","",config(),Runner([state]))

    def test_revoke_requires_two_independent_approvals(self):
        with self.assertRaises(rev.Blocked):
            rev.execute("revoke","wrong",config(),Runner([LEASED]))
        c = config()
        c.pop("IAM_G1_DISPOSABLE_REVOKER_APPROVAL")
        with self.assertRaises(rev.Blocked):
            rev.execute("revoke",rev.LATCH,c,Runner([LEASED]))

    def test_revoke_different_connection_and_full_postcommit_parity(self):
        runner = Runner([LEASED,ZERO])
        proof = rev.execute("revoke",rev.LATCH,config(),runner)
        self.assertEqual(proof,"PASS_G1_DISPOSABLE_REVOKER_COMMITTED_AND_VERIFIED")
        self.assertEqual(runner.statements,[rev.INVENTORY,rev.REVOKE_SQL,rev.INVENTORY])

    def test_revoke_incomplete_never_returns_pass(self):
        with self.assertRaisesRegex(rev.Blocked,"REVOCATION_NOT_EFFECTIVE"):
            rev.execute("revoke",rev.LATCH,config(),Runner([LEASED,PARTIAL]))

    def test_static_sql_is_revoke_only_and_includes_views(self):
        sql = rev.REVOKE_SQL.upper()
        self.assertIn("REVOKE MAINTAIN ON TABLE",sql)
        self.assertIn("REVOKE USAGE ON SCHEMA",sql)
        self.assertIn("'V'",sql)
        self.assertNotIn("GRANT ",sql)
        self.assertNotIn("DROP ROLE",sql)
        self.assertNotIn("ALTER ROLE",sql)
        self.assertNotIn("BYPASSRLS",sql)
        self.assertTrue(sql.rstrip().endswith("COMMIT;"))

if __name__ == "__main__":
    unittest.main(verbosity=2)
