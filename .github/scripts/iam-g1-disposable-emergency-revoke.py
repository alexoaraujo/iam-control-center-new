#!/usr/bin/env python3
"""Independent REVOKE-only operator for one disposable Neon G1 branch.

Never import/execute from the Development emergency revoker; do not add GRANT,
ALTER ROLE, backup, RESTORE or a dynamic SQL identifier here.
This code does not establish independent human approval or branch attestation.
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from urllib.parse import parse_qsl, unquote, urlsplit

PROJECT = "tiny-rice-70320263"
BRANCH = "br-spring-grass-b6gap6kp"
HOST = "ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech"
DATABASE = "iam_database"
ADMIN = "neondb_owner"
READER = "iam_schema_export_reader"
LATCH = "REVOKE_G1_DISPOSABLE_LEASE_ONLY"
SCHEMAS = ("iam", "audit", "app_private")

class Blocked(RuntimeError):
    pass

def connect_env(raw: str) -> dict[str, str]:
    """Require the immutable direct endpoint, independent admin and TLS."""
    try:
        if not raw or raw != raw.strip() or any(ord(c) < 32 for c in raw):
            raise Blocked("REVOKER_URL_MISSING_OR_MALFORMED")
        u = urlsplit(raw)
        pairs = parse_qsl(u.query, keep_blank_values=True, strict_parsing=True)
        if (u.scheme not in ("postgresql", "postgres") or u.hostname != HOST
                or u.port != 5432 or u.path != "/" + DATABASE or u.fragment
                or unquote(u.username or "") != ADMIN or not u.password
                or sorted(pairs) != [("sslmode", "verify-full"),
                                    ("sslrootcert", "system")]):
            raise Blocked("BRANCH_ADMIN_IDENTITY_OR_TLS_MISMATCH")
        password = unquote(u.password)
        if any(c in password for c in ("\x00", "\n", "\r")):
            raise Blocked("INVALID_OPERATOR_CREDENTIAL")
    except (TypeError, ValueError) as exc:
        raise Blocked("INVALID_OPERATOR_URL") from exc
    return {
        "PGHOST": HOST, "PGPORT": "5432", "PGDATABASE": DATABASE,
        "PGUSER": ADMIN, "PGPASSWORD": password,
        "PGSSLMODE": "verify-full", "PGSSLROOTCERT": "system",
        "PGCONNECT_TIMEOUT": "8", "PGAPPNAME": "iam-g1-disposable-revoker",
        "PGOPTIONS": "-c statement_timeout=30000 -c lock_timeout=3000",
    }

# All catalog reads are metadata-only. Do not read table rows or dump data.
INVENTORY = r"""
SELECT 'G1_STATE|' ||
 (SELECT count(*) FROM pg_roles WHERE rolname='iam_schema_export_reader'
   AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
   AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit) || '|' ||
 (SELECT count(*) FROM pg_namespace WHERE nspname IN ('iam','audit','app_private')) || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')) || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind='v') || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind='S') || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p') AND c.relforcerowsecurity) || '|' ||
 (SELECT count(*) FROM pg_namespace WHERE nspname IN ('iam','audit','app_private')
   AND has_schema_privilege('iam_schema_export_reader',oid,'USAGE')) || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p','v','m','f')
     AND has_table_privilege('iam_schema_export_reader',c.oid,'MAINTAIN')) || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p','v','m','f')
     AND (has_table_privilege('iam_schema_export_reader',c.oid,'SELECT')
       OR has_table_privilege('iam_schema_export_reader',c.oid,'INSERT')
       OR has_table_privilege('iam_schema_export_reader',c.oid,'UPDATE')
       OR has_table_privilege('iam_schema_export_reader',c.oid,'DELETE')
       OR has_table_privilege('iam_schema_export_reader',c.oid,'TRUNCATE'))) || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
   WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind='S'
     AND (has_sequence_privilege('iam_schema_export_reader',c.oid,'USAGE')
       OR has_sequence_privilege('iam_schema_export_reader',c.oid,'SELECT')
       OR has_sequence_privilege('iam_schema_export_reader',c.oid,'UPDATE'))) || '|' ||
 (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON m.member=r.oid
   WHERE r.rolname='iam_schema_export_reader');
"""

# Hardened for incident response: revoke MAINTAIN on ALL relations in the
# three allowlisted schemas, including the view (prior fixture missed it).
# REVOKE persists only after COMMIT. An independent subsequent connection
# proves effective privileges, not merely whether REVOKE statements ran.
REVOKE_SQL = r"""
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='3s';
DO $guard$
BEGIN
 IF current_database()<>'iam_database' OR current_user<>'neondb_owner'
    OR session_user<>current_user
    OR current_setting('server_version_num')::integer NOT BETWEEN 180000 AND 189999
    OR (SELECT count(*) FROM pg_namespace WHERE nspname IN
          ('iam','audit','app_private'))<>3
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='iam_schema_export_reader')
 THEN RAISE EXCEPTION 'BLOCKED_G1_BRANCH_REVOKER_GUARD'; END IF;
END $guard$;
DO $revoke$
DECLARE r record;
BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p','v','m','f')
   ORDER BY n.nspname,c.relname
 LOOP
   EXECUTE format('REVOKE MAINTAIN ON TABLE %I.%I FROM iam_schema_export_reader',
                  r.nspname,r.relname);
 END LOOP;
END $revoke$;
REVOKE USAGE ON SCHEMA iam,audit,app_private FROM iam_schema_export_reader;
COMMIT;
"""

def psql(statement: str, env: dict[str, str], runner=subprocess.run) -> str:
    try:
        out = runner(["psql", "-X", "-w", "-At", "-v", "ON_ERROR_STOP=1"],
                     input=statement, text=True, capture_output=True, check=False,
                     timeout=45,
                     env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                          "HOME": os.environ.get("HOME", "/tmp"), **env})
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        raise Blocked("PG18_OPERATOR_UNAVAILABLE_OR_TIMED_OUT") from exc
    if out.returncode != 0:
        # Never forward libpq diagnostics; they may contain credentials/SQL.
        raise Blocked("OPERATOR_SQL_REJECTED_NO_VERIFIED_PASS")
    return out.stdout.strip()

def inventory(env: dict[str, str], runner=subprocess.run) -> tuple[int, ...]:
    lines = [l for l in psql(INVENTORY, env, runner).splitlines()
             if l.startswith("G1_STATE|")]
    if len(lines) != 1:
        raise Blocked("INVENTORY_AMBIGUOUS")
    try:
        values = tuple(int(x) for x in lines[0].split("|")[1:])
    except ValueError as exc:
        raise Blocked("INVENTORY_INVALID") from exc
    if len(values) != 11 or any(x < 0 for x in values):
        raise Blocked("INVENTORY_INCOMPLETE")
    return values

def execute(mode: str, confirm: str, config: dict[str, str],
            runner=subprocess.run) -> str:
    if (config.get("IAM_G1_DISPOSABLE_PROJECT_ID") != PROJECT
            or config.get("IAM_G1_DISPOSABLE_BRANCH_ID") != BRANCH):
        raise Blocked("CONTROL_PLANE_BRANCH_ID_NOT_ALLOWLISTED")
    env = connect_env(config.get("IAM_G1_DISPOSABLE_REVOKER_URL", ""))
    before = inventory(env, runner)
    # 1 role security, 3 schemas, 23 tables, 1 view, 3 sequences, 20 FORCE RLS.
    if before[:6] != (1, 3, 23, 1, 3, 20) or before[8:] != (0, 0, 0):
        raise Blocked("READER_ROLE_OR_CANONICAL_CATALOG_DRIFT")
    if mode == "preflight":
        if (before[6], before[7]) not in ((0, 0), (3, 24)):
            raise Blocked("PARTIAL_LEASE_DETECTED")
        return "PASS_G1_DISPOSABLE_REVOKER_PREFLIGHT_NO_DDL"
    if (mode != "revoke" or confirm != LATCH
            or config.get("IAM_G1_DISPOSABLE_REVOKER_APPROVAL") != LATCH):
        raise Blocked("INDEPENDENT_REVOKE_APPROVAL_MISSING")
    psql(REVOKE_SQL, env, runner)
    after = inventory(env, runner)  # DIFFERENT connection, after COMMIT.
    if after[:6] != (1, 3, 23, 1, 3, 20) or any(after[6:]):
        raise Blocked("REVOCATION_NOT_EFFECTIVE_ESCALATE_INCIDENT")
    return "PASS_G1_DISPOSABLE_REVOKER_COMMITTED_AND_VERIFIED"

def main() -> int:
    parser = argparse.ArgumentParser(description="G1 disposable branch REVOKE-only")
    parser.add_argument("--mode", choices=("preflight", "revoke"), default="preflight")
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()
    try:
        print(execute(args.mode, args.confirm, os.environ))
        return 0
    except Blocked as exc:
        print("BLOCKED_G1_DISPOSABLE_REVOKER: " + str(exc), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
