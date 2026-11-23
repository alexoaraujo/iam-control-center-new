#!/usr/bin/env python3
"""PG18 disposable fixture only. No canonical SQL, no Neon, no release mode."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
URL = "postgresql://iam_migrator_login@localhost:5432/iam_schema_test"
LOCK = "187355, 17318"
# Deliberately non-numeric execution order: dependency wins over filename.
# These immutable checksums refer ONLY to the synthetic SQL files beside us.
PLAN = {
    "1001_events": ("1cb4436a0e0236df5fbd7cb0d5e3638e2dcc144451b2f5f6a3000fabca808cb8", ("1002_tenants",)),
    "1002_tenants": ("7c43dc62750e9c12b41033836afb3bdcd713e3a0b62343f7260bab6a95f6febf", ()),
    "1003_rollback": ("e2a02d6da1ba997fa68ec8908a08e98bc3bf9e6653d42b6ea0279dd06b0db0bc", ("1001_events",)),
}


def ordered(plan, selected):
    """Resolve the closed fixture DAG; refuse missing deps and cycles."""
    done, active, result = set(), set(), []

    def visit(name):
        if name in done:
            return
        if name in active or name not in plan:
            raise ValueError("BLOCKED_INVALID_DAG")
        active.add(name)
        for dep in plan[name][1]:
            visit(dep)
        active.remove(name)
        done.add(name)
        result.append(name)

    for name in selected:
        visit(name)
    return result


def load_files(directory=ROOT, plan=PLAN):
    if set(p.name for p in directory.glob("*.sql")) != {n + ".sql" for n in plan}:
        raise ValueError("BLOCKED_FIXTURE_INVENTORY")
    result = {}
    for name, (expected, _) in plan.items():
        path = directory / (name + ".sql")
        if path.is_symlink() or not path.is_file():
            raise ValueError("BLOCKED_FIXTURE_FILE")
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected:
            raise ValueError("BLOCKED_CHECKSUM")
        result[name] = raw.decode("utf-8")
    return result


PREFLIGHT = r"""
\set ON_ERROR_STOP on
\set VERBOSITY verbose
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
DO $guard$
BEGIN
  IF current_database() <> 'iam_schema_test'
     OR session_user <> 'iam_migrator_login' OR current_user <> session_user
     OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= inet '127.0.0.0/8'
             OR inet_server_addr() <<= inet '172.16.0.0/12'
             OR inet_server_addr() = inet '::1')
     OR nullif(current_setting('neon.branch_id', true), '') IS NOT NULL
     OR to_regclass('iam_runner_guard.marker') IS NULL THEN
    RAISE EXCEPTION 'PEOS_WRONG_FIXTURE';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='iam_runner_guard' AND c.relname='marker'
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
      AND n.nspowner=c.relowner
  ) OR NOT EXISTS (SELECT 1 FROM iam_runner_guard.marker WHERE token='PG18_DISPOSABLE_RUNNER_V1')
  OR has_table_privilege(session_user,'iam_runner_guard.marker','INSERT,UPDATE,DELETE,TRUNCATE')
  THEN RAISE EXCEPTION 'PEOS_WRONG_FIXTURE'; END IF;
  IF NOT pg_try_advisory_xact_lock(187355, 17318) THEN
    RAISE EXCEPTION 'PEOS_LOCK_BUSY';
  END IF;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('iam_owner','iam_migrator','iam_migrator_login','iam_app_runtime','iam_app_runtime_login')
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication
      AND rolcanlogin = (rolname IN ('iam_migrator_login','iam_app_runtime_login'))) <> 5
  OR NOT EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member
    WHERE r.rolname='iam_owner' AND u.rolname='iam_migrator'
      AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member
    WHERE r.rolname='iam_migrator' AND u.rolname='iam_migrator_login'
      AND m.set_option AND NOT m.inherit_option AND NOT m.admin_option
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid
      JOIN pg_roles u ON u.oid=m.member
    WHERE r.rolname='iam_app_runtime' AND u.rolname='iam_app_runtime_login'
      AND NOT m.set_option AND m.inherit_option AND NOT m.admin_option
  ) OR pg_has_role('iam_app_runtime_login','iam_owner','MEMBER')
     OR pg_has_role('iam_app_runtime_login','iam_migrator','MEMBER')
  THEN RAISE EXCEPTION 'PEOS_ROLE_CONTRACT'; END IF;
END
$guard$;
SET LOCAL ROLE iam_migrator;
SET LOCAL ROLE iam_owner;
DO $owner$
BEGIN
  IF session_user <> 'iam_migrator_login' OR current_user <> 'iam_owner' THEN
    RAISE EXCEPTION 'PEOS_OWNER_CONTRACT';
  END IF;
END
$owner$;
SELECT to_regnamespace('iam_runner_fixture') IS NULL AS initialize \gset
\if :initialize
CREATE SCHEMA iam_runner_fixture AUTHORIZATION iam_owner;
REVOKE ALL ON SCHEMA iam_runner_fixture FROM PUBLIC;
GRANT USAGE ON SCHEMA iam_runner_fixture TO iam_app_runtime;
CREATE TABLE iam_runner_fixture.schema_migrations (
  migration_id text PRIMARY KEY,
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applied_by name NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON TABLE iam_runner_fixture.schema_migrations FROM PUBLIC;
\endif
DO $ledger$
BEGIN
  IF to_regclass('iam_runner_fixture.schema_migrations') IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='iam_runner_fixture' AND c.relname='schema_migrations'
      AND n.nspowner=(SELECT oid FROM pg_roles WHERE rolname='iam_owner')
      AND c.relowner=n.nspowner AND c.relkind='r'
  )
  OR has_schema_privilege('iam_app_runtime_login','iam_runner_fixture','CREATE')
  OR NOT has_schema_privilege('iam_app_runtime_login','iam_runner_fixture','USAGE')
  OR has_table_privilege('iam_app_runtime_login','iam_runner_fixture.schema_migrations',
                         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
  THEN RAISE EXCEPTION 'PEOS_LEDGER_CONTRACT'; END IF;
END
$ledger$;
"""


def transaction(files, probe):
    sequence = ordered(PLAN, ["1003_rollback" if probe else "1001_events"])
    sql = [PREFLIGHT]
    allowed = ", ".join("'" + n + "'" for n in PLAN if n != "1003_rollback")
    sql.append(f"""
DO $history$
BEGIN
  IF EXISTS (SELECT 1 FROM iam_runner_fixture.schema_migrations WHERE migration_id NOT IN ({allowed}))
    OR EXISTS (SELECT 1 FROM iam_runner_fixture.schema_migrations
      WHERE applied_by <> 'iam_migrator_login')
    OR (EXISTS (SELECT 1 FROM iam_runner_fixture.schema_migrations WHERE migration_id='1001_events')
        AND NOT EXISTS (SELECT 1 FROM iam_runner_fixture.schema_migrations WHERE migration_id='1002_tenants'))
  THEN RAISE EXCEPTION 'PEOS_UNKNOWN_OR_ORPHAN_LEDGER'; END IF;
END
$history$;
""")
    for name in sequence:
        checksum, deps = PLAN[name]
        sql.append(f"""
DO $checksum$
BEGIN
  IF EXISTS (SELECT 1 FROM iam_runner_fixture.schema_migrations
      WHERE migration_id='{name}' AND checksum_sha256 <> '{checksum}')
  THEN RAISE EXCEPTION 'PEOS_LEDGER_CHECKSUM'; END IF;
END
$checksum$;
""")
        for dep in deps:
            sql.append(f"""
DO $dependency$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM iam_runner_fixture.schema_migrations
       WHERE migration_id='{dep}' AND checksum_sha256='{PLAN[dep][0]}')
  THEN RAISE EXCEPTION 'PEOS_DEPENDENCY'; END IF;
END
$dependency$;
""")
        sql.append(f"""
SELECT NOT EXISTS (SELECT 1 FROM iam_runner_fixture.schema_migrations
  WHERE migration_id='{name}') AS pending \\gset
\\if :pending
{files[name]}
INSERT INTO iam_runner_fixture.schema_migrations(migration_id,checksum_sha256,applied_by)
VALUES ('{name}','{checksum}',session_user);
SELECT 'APPLIED:{name}';
\\else
SELECT 'SKIPPED:{name}';
\\endif
""")
    # Check effective ACLs (including PUBLIC/inherited grants) and forced RLS
    # even on replay, rather than trusting an existing checksum as proof.
    sql.append(r"""
DO $post$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenants','events'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='iam_runner_fixture' AND c.relname=t AND c.relkind='r'
      AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='iam_owner')
      AND c.relrowsecurity AND c.relforcerowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)
      AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee=0)
    ) OR NOT has_table_privilege('iam_app_runtime_login','iam_runner_fixture.'||t,'SELECT')
      OR has_table_privilege('iam_app_runtime_login','iam_runner_fixture.'||t,
         'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    THEN RAISE EXCEPTION 'PEOS_RLS_OR_ACL_DRIFT'; END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE contype='f'
      AND conrelid='iam_runner_fixture.events'::regclass
      AND confrelid='iam_runner_fixture.tenants'::regclass
  ) THEN RAISE EXCEPTION 'PEOS_DEPENDENCY_SCHEMA'; END IF;
END
$post$;
""")
    if probe:
        # Fail after both fixture DDL and ledger insertion. psql exits, closes
        # the transaction, and the database rolls back all its effects.
        sql.append("DO $$ BEGIN RAISE EXCEPTION 'PEOS_INTENTIONAL_ROLLBACK'; END $$;\n")
    sql.append("COMMIT;\n")
    return "\n".join(sql)


def main():
    args = sys.argv[1:]
    if args not in (["apply"], ["rollback-probe"]):
        print("BLOCKED_USAGE", file=sys.stderr)
        return 2
    if (os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("PEOS_FIXTURE_RUNNER") != "PG18_DISPOSABLE_ONLY"
        or os.environ.get("MIGRATOR_DATABASE_URL") != URL
        or not os.environ.get("MIGRATOR_TEST_PASSWORD")):
        print("BLOCKED_NON_FIXTURE_TARGET", file=sys.stderr)
        return 2
    try:
        files = load_files()
        # No inherited PGHOST/PGOPTIONS/PGSERVICE/PGPASSFILE, production URL,
        # dotenv or arbitrary SQL argument; only the fixture login password.
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
               "LC_ALL": "C", "PGCONNECT_TIMEOUT": "5",
               "PGPASSWORD": os.environ["MIGRATOR_TEST_PASSWORD"]}
        result = subprocess.run(
            ["psql", "-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1", URL],
            input=transaction(files, args == ["rollback-probe"]), text=True,
            capture_output=True, env=env, timeout=25, check=False)
        if result.returncode:
            for code in ("PEOS_LOCK_BUSY", "PEOS_INTENTIONAL_ROLLBACK", "PEOS_LEDGER_CHECKSUM",
                         "PEOS_ROLE_CONTRACT", "PEOS_RLS_OR_ACL_DRIFT", "PEOS_WRONG_FIXTURE",
                         "PEOS_LEDGER_CONTRACT", "PEOS_UNKNOWN_OR_ORPHAN_LEDGER"):
                if code in result.stderr:
                    print("BLOCKED_" + code, file=sys.stderr)
                    return 1
            print("BLOCKED_TRANSACTION", file=sys.stderr)
            return 1
        # Only success markers emitted by the fixed SQL, after COMMIT.
        if args == ["rollback-probe"]:
            print("BLOCKED_UNEXPECTED_PROBE_COMMIT", file=sys.stderr)
            return 1
        for line in result.stdout.splitlines():
            if line in {f"{s}:{n}" for n in PLAN for s in ("APPLIED", "SKIPPED")}:
                print(line)
        print("PASS_FIXTURE_TRANSACTION_COMMITTED")
        return 0
    except (OSError, ValueError, subprocess.TimeoutExpired):
        print("BLOCKED_FIXTURE_PREFLIGHT", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
