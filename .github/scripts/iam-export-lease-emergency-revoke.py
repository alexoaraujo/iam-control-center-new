#!/usr/bin/env python3
"""Independent, revoke-only emergency tool for the IAM canonical export lease.

No GRANT, CREATE ROLE, ALTER ROLE, DROP, schema dump or restore. This script
requires a separate administrative URL; NEVER reuse the export reader login.
Review main SHA, GitHub Environment and Neon control-plane branch before use.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

PROJECT = "tiny-rice-70320263"
BRANCH = "br-ancient-term-b6mmx5ol"
HOST = "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"
DATABASE = "iam_database"
ADMIN_ROLE = "neondb_owner"
EXPORT_ROLE = "iam_schema_export_reader"
APPROVAL = "REVOKE_ONLY_IAM_DEV_EXPORT_READER"
SCHEMAS = ("iam", "audit", "app_private")


class GateBlocked(RuntimeError):
    pass


def decode_credentials(raw: str) -> dict[str, str]:
    """Pin libpq connection parameters; never echo a secret or input URI."""
    try:
        if not raw or raw != raw.strip() or any(ord(c) < 32 for c in raw):
            raise GateBlocked("missing or malformed protected revoker URL")
        p = urlsplit(raw)
        query = parse_qsl(p.query, keep_blank_values=True)
        if (p.scheme not in ("postgresql", "postgres") or p.hostname != HOST
                or p.port != 5432 or p.path != "/" + DATABASE
                or p.fragment or unquote(p.username or "") != ADMIN_ROLE
                or not p.password or len(query) != 2
                or sorted(query) != [
                    ("sslmode", "verify-full"), ("sslrootcert", "system")
                ]):
            raise GateBlocked("revoker URL is not exact direct Neon Development endpoint")
        secret = unquote(p.password)
        if not secret or "\x00" in secret:
            raise GateBlocked("missing revoker credential")
    except (ValueError, TypeError) as exc:
        raise GateBlocked("invalid revoker URL") from exc
    return {
        "PGHOST": HOST,
        "PGPORT": "5432",
        "PGDATABASE": DATABASE,
        "PGUSER": ADMIN_ROLE,
        "PGPASSWORD": secret,
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": "system",
        "PGCONNECT_TIMEOUT": "8",
        "PGAPPNAME": "iam-export-emergency-revoke",
    }


# The SQL is entirely constant; no caller-supplied table or role identifiers.
INVENTORY = r"""
SELECT 'READER_SECURITY|' ||
 (SELECT count(*) FROM pg_roles
  WHERE rolname='iam_schema_export_reader' AND rolcanlogin
    AND NOT rolbypassrls AND NOT rolsuper) || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')) || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')
    AND has_table_privilege('iam_schema_export_reader',c.oid,'MAINTAIN')) || '|' ||
 (SELECT count(*) FROM pg_namespace n
  WHERE n.nspname IN ('iam','audit','app_private')
    AND has_schema_privilege('iam_schema_export_reader',n.oid,'USAGE')) || '|' ||
 (SELECT count(*) FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
  WHERE member.rolname='iam_schema_export_reader') || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')
    AND (has_table_privilege('iam_schema_export_reader',c.oid,'SELECT') OR
         has_table_privilege('iam_schema_export_reader',c.oid,'UPDATE') OR
         has_table_privilege('iam_schema_export_reader',c.oid,'DELETE') OR
         has_table_privilege('iam_schema_export_reader',c.oid,'TRUNCATE')));
"""

REVOKE_ONLY = r"""
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '3s';
DO $guard$
DECLARE rel_count integer;
BEGIN
  IF current_database() <> 'iam_database'
     OR current_user <> 'neondb_owner' OR session_user <> current_user
     OR current_setting('server_version_num')::integer < 180000
     OR current_setting('server_version_num')::integer >= 190000
     OR NOT EXISTS (SELECT 1 FROM pg_roles
                    WHERE rolname='iam_schema_export_reader')
     OR (SELECT count(*) FROM pg_namespace
         WHERE nspname IN ('iam','audit','app_private')) <> 3
  THEN
    RAISE EXCEPTION 'BLOCKED_REVOKE_IDENTITY_OR_SCHEMA';
  END IF;
  SELECT count(*) INTO rel_count FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p');
  IF rel_count < 1 OR rel_count > 100 THEN
    RAISE EXCEPTION 'BLOCKED_REVOKE_RELATION_BOUND';
  END IF;
END $guard$;
DO $revoke$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('iam','audit','app_private')
       AND c.relkind IN ('r','p')
     ORDER BY n.nspname, c.relname
  LOOP
    EXECUTE format(
      'REVOKE MAINTAIN ON TABLE %I.%I FROM iam_schema_export_reader',
      rec.nspname, rec.relname);
  END LOOP;
END $revoke$;
REVOKE USAGE ON SCHEMA iam, audit, app_private FROM iam_schema_export_reader;
COMMIT;
"""

def psql(sql: str, env: dict[str, str], runner=subprocess.run) -> str:
    try:
        result = runner(
            ["psql", "-X", "-w", "-At", "-v", "ON_ERROR_STOP=1"],
            input=sql, text=True, capture_output=True, check=False,
            timeout=45, env={
                "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                "HOME": os.environ.get("HOME", "/tmp"),
                **env,
            },
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise GateBlocked("PostgreSQL 18 client unavailable or timed out") from exc
    if result.returncode != 0:
        # PostgreSQL may include raw connection parameters in diagnostics.
        # Do not log stdout/stderr from any failed or successful psql command.
        raise GateBlocked("database refused guarded revocation; no PASS confirmed")
    return result.stdout.strip()


def inventory(env: dict[str, str], runner=subprocess.run) -> tuple[int, ...]:
    result = psql(INVENTORY, env, runner)
    lines = [x for x in result.splitlines() if x.startswith("READER_SECURITY|")]
    if len(lines) != 1:
        raise GateBlocked("ambiguous inventory proof")
    try:
        values = tuple(int(x) for x in lines[0].split("|")[1:])
    except ValueError as exc:
        raise GateBlocked("invalid inventory proof") from exc
    if len(values) != 6 or any(x < 0 for x in values):
        raise GateBlocked("incomplete inventory proof")
    return values


def execute(mode: str, confirm: str, environ: dict[str, str],
            runner=subprocess.run) -> str:
    if (environ.get("IAM_EXPORT_REVOKER_PROJECT_ID") != PROJECT
            or environ.get("IAM_EXPORT_REVOKER_BRANCH_ID") != BRANCH):
        raise GateBlocked("Neon project/branch allowlist not confirmed")
    env = decode_credentials(environ.get("IAM_EXPORT_REVOKER_URL", ""))
    before = inventory(env, runner)
    if before[1] != 23:
        raise GateBlocked("expected IAM 23-table inventory not found")
    if mode == "preflight":
        if before[0] != 1 or before[4] != 0 or before[5] != 0:
            raise GateBlocked("unsafe export role attributes or memberships")
        return "PASS_REVOKER_PREFLIGHT_ONLY_NO_DDL"
    if mode != "revoke" or confirm != APPROVAL or \
            environ.get("IAM_EXPORT_REVOKER_APPROVAL") != APPROVAL:
        raise GateBlocked("explicit revoke-only operator confirmation missing")
    # Separate process/connection from exporter. This tool NEVER grants.
    psql(REVOKE_ONLY, env, runner)
    after = inventory(env, runner)  # Independent post-COMMIT connection.
    if after[2] or after[3] or after[4] or after[5] or after[0] != 1:
        raise GateBlocked("REVOCATION_INCOMPLETE: manual incident response required")
    return "PASS_REVOKER_COMMITTED_AND_INDEPENDENTLY_VERIFIED"


def main() -> int:
    parser = argparse.ArgumentParser(description="IAM export emergency REVOKE only")
    parser.add_argument("--mode", choices=("preflight", "revoke"), default="preflight")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()
    try:
        proof = execute(args.mode, args.confirm, os.environ)
        print(proof)
        return 0
    except GateBlocked as exc:
        print("BLOCKED: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
