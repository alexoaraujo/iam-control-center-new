#!/usr/bin/env python3
"""G1 B2 encrypted-only staging and isolated PostgreSQL 18 full restore.

Trusted main workflow only. B2 stage uses a read-only key and NEVER sees AES/SQL.
Restore uses a DIFFERENT protected Environment and NEVER sees B2 credentials.
No Production endpoint, Production branch or inherited IAM database is writable.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from urllib.parse import parse_qs, unquote, urlsplit

REPOSITORY = "alexoaraujo/iam-control-center-new"
STAGE_ENVIRONMENT = "IAM-G1-B2-Full-Readback-Custody"
RESTORE_ENVIRONMENT = "IAM-G1-Full-Restore-Custody"
PROJECT = "tiny-rice-70320263"
BRANCH = "br-floral-glitter-b6zvytjp"
PARENT_BRANCH = "br-ancient-term-b6mmx5ol"
TARGET_HOST = "ep-young-wind-b66dzic2.c-2.sa-east-1.aws.neon.tech"
TARGET_DATABASE = "iam_g1_restore_validation"
INHERITED_DATABASE = "iam_database"
MAINTENANCE_DATABASE = "neondb"
TARGET_OWNER = "neondb_owner"
EXPIRY = datetime(2026, 11, 24, 12, 0, 0, tzinfo=timezone.utc)
HEADROOM = timedelta(hours=24)
CONFIRM = "RESTORE_G1_FULL_B2_TO_EXACT_DISPOSABLE_ONLY"
MAX_CIPHERTEXT_BYTES = 64 * 1024 * 1024
IMAGE = "iam-pg18-system-ca:local"
STAGED_RELATIVE_PATH = Path("iam-g1-stage/approved-ciphertext.aesgcm")


class Blocked(RuntimeError):
    """Only constant error codes; never leak credentials, SQL, data or tokens."""


def load_local(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(path))
    if not spec or not spec.loader:
        raise Blocked("BLOCKED_G1_RESTORE_TRUSTED_DEPENDENCY")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def reader():
    return load_local("iam_g1_full_reader", "iam-g1-b2-full-readback.py")


def aead():
    return load_local("iam_g1_aead", "iam-g1-archive-authentication.py")


def stage_path(env: dict[str, str]) -> Path:
    root = Path(env.get("RUNNER_TEMP", ""))
    if not root.is_absolute() or not root.is_dir() or root.is_symlink():
        raise Blocked("BLOCKED_G1_RESTORE_RUNNER_TEMP")
    return root / STAGED_RELATIVE_PATH


def assert_trusted_main(env: dict[str, str], *, confirm: bool = False) -> None:
    if (env.get("GITHUB_REPOSITORY") != REPOSITORY or
            env.get("GITHUB_REF") != "refs/heads/main" or
            env.get("GITHUB_EVENT_NAME") != "workflow_dispatch" or
            re.fullmatch(r"[0-9a-f]{40}", env.get("GITHUB_SHA", "")) is None):
        raise Blocked("BLOCKED_G1_RESTORE_NOT_TRUSTED_MAIN")
    if confirm:
        if env.get("IAM_G1_RESTORE_APPROVED_SHA") != env["GITHUB_SHA"]:
            raise Blocked("BLOCKED_G1_RESTORE_SHA_NOT_CUSTODY_APPROVED")
        if (env.get("IAM_G1_RESTORE_CONFIRMATION") != CONFIRM or
                env.get("IAM_G1_RESTORE_OPERATOR_APPROVAL") != "DISPOSABLE_ONLY_APPROVED"):
            raise Blocked("BLOCKED_G1_RESTORE_OPERATOR_CONFIRMATION")


def ensure_lease(now: datetime | None = None) -> None:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or EXPIRY - now < HEADROOM:
        raise Blocked("BLOCKED_G1_RESTORE_DISPOSABLE_LEASE_HEADROOM")


def parse_target(raw: str) -> str:
    if not isinstance(raw, str) or not raw or raw != raw.strip():
        raise Blocked("BLOCKED_G1_RESTORE_TARGET_SECRET_MISSING")
    if any(c in raw for c in "\r\n\x00\t'\" "):
        raise Blocked("BLOCKED_G1_RESTORE_TARGET_CONTROL")
    try:
        u = urlsplit(raw)
        port = u.port if u.port is not None else 5432
        params = parse_qs(u.query, keep_blank_values=True, strict_parsing=True)
        username = unquote(u.username or "")
        password = unquote(u.password or "")
    except (ValueError, UnicodeError):
        raise Blocked("BLOCKED_G1_RESTORE_TARGET_INVALID_URI") from None
    if (u.scheme != "postgresql" or u.hostname != TARGET_HOST or port != 5432 or
            u.path != "/" + TARGET_DATABASE or username != TARGET_OWNER or not password or
            u.fragment or "pooler" in (u.hostname or "")):
        raise Blocked("BLOCKED_G1_RESTORE_TARGET_NOT_EXACT_DISPOSABLE")
    if set(params) not in ({"sslmode", "sslrootcert"}, {"sslmode", "sslrootcert", "channel_binding"}):
        raise Blocked("BLOCKED_G1_RESTORE_TLS_PARAMETERS")
    if (params.get("sslmode") != ["verify-full"] or
            params.get("sslrootcert") != ["system"] or
            ("channel_binding" in params and params["channel_binding"] != ["require"])):
        raise Blocked("BLOCKED_G1_RESTORE_TLS_VERIFY_FULL_REQUIRED")
    return password


def pg_environment(password: str, *, database: str = TARGET_DATABASE) -> dict[str, str]:
    if database not in (TARGET_DATABASE, INHERITED_DATABASE, MAINTENANCE_DATABASE):
        raise Blocked("BLOCKED_G1_RESTORE_DATABASE_ALLOWLIST")
    e = dict(os.environ)
    e.update({
        "PGHOST": TARGET_HOST, "PGPORT": "5432", "PGDATABASE": database,
        "PGUSER": TARGET_OWNER, "PGPASSWORD": password,
        "PGSSLMODE": "verify-full", "PGSSLROOTCERT": "system",
        "PGCHANNELBINDING": "require", "PGCONNECT_TIMEOUT": "15",
        "PGOPTIONS": "-c statement_timeout=900000 -c lock_timeout=10000",
    })
    return e


def pg18(args: list[str], pg_env: dict[str, str], *, data: bytes | None = None,
         timeout: int = 180) -> bytes:
    allowed = {"psql", "pg_restore"}
    if not args or args[0] not in allowed:
        raise Blocked("BLOCKED_G1_RESTORE_PG18_COMMAND")
    command = [
        "docker", "run", "--rm", "-i", "--network", "host", "--read-only",
        "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--env", "PGHOST", "--env", "PGPORT", "--env", "PGDATABASE",
        "--env", "PGUSER", "--env", "PGPASSWORD", "--env", "PGSSLMODE",
        "--env", "PGSSLROOTCERT", "--env", "PGCHANNELBINDING",
        "--env", "PGCONNECT_TIMEOUT", "--env", "PGOPTIONS", IMAGE,
    ] + args
    try:
        result = subprocess.run(command, env=pg_env, input=data, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("BLOCKED_G1_RESTORE_PG18_RUNTIME") from None
    if result.returncode != 0:
        raise Blocked("BLOCKED_G1_RESTORE_PG18_STEP_FAILED") from None
    return result.stdout


def pg18_phase(phase: str, action):
    """Tag fixed PG18 phase failures, never including SQL, data or credentials."""
    allowed = {
        "TARGET_IDENTITY", "TARGET_EMPTY", "REFERENCE_IDENTITY",
        "REFERENCE_CATALOG", "ARCHIVE_TOC", "RESTORE_APPLY",
        "RESTORED_CATALOG", "REFERENCE_COUNTS", "RESTORED_COUNTS",
        "RLS_BYPASS_ROLES", "ROLLBACK", "CLEANUP",
    }
    if phase not in allowed:
        raise Blocked("BLOCKED_G1_RESTORE_UNTRUSTED_DIAGNOSTIC_PHASE")
    try:
        return action()
    except Blocked as exc:
        if str(exc) in ("BLOCKED_G1_RESTORE_PG18_STEP_FAILED",
                        "BLOCKED_G1_RESTORE_PG18_RUNTIME"):
            raise Blocked("BLOCKED_G1_RESTORE_PG18_" + phase + "_FAILED") from None
        raise


def sql(pg_env: dict[str, str], query: str) -> str:
    result = pg18(["psql", "-X", "-w", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1",
                   "-c", query], pg_env)
    return result.decode("utf-8", errors="strict").strip()


def identity(pg_env: dict[str, str], expected_db: str) -> None:
    statement = (
        "SELECT current_setting('neon.branch_id',true) || '|' || current_database()"
        " || '|' || current_user || '|' || current_setting('server_version_num')"
    )
    result = sql(pg_env, statement)
    if not re.fullmatch(re.escape(BRANCH + "|" + expected_db + "|" + TARGET_OWNER + "|") +
                        r"18[0-9]{4}", result):
        raise Blocked("BLOCKED_G1_RESTORE_NEON_BRANCH_ROLE_OR_PG18_IDENTITY")


def assert_empty(pg_env: dict[str, str]) -> None:
    query = """SELECT
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')
         AND n.nspname NOT LIKE 'pg_toast%')::text || '|' ||
      (SELECT count(*) FROM pg_namespace WHERE nspname IN ('iam','app_private','audit'))::text || '|' ||
      (SELECT count(*) FROM pg_policies WHERE schemaname IN ('iam','app_private','audit'))::text"""
    if sql(pg_env, query) != "0|0|0":
        raise Blocked("BLOCKED_G1_RESTORE_TARGET_NOT_EMPTY")


def catalog(pg_env: dict[str, str]) -> tuple[str, ...]:
    """Object, owner, ACL, RLS and migration fingerprints; no row data."""
    query = """SELECT
      (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p') AND n.nspname IN ('iam','app_private','audit')) || '|' ||
      (SELECT count(*)::text FROM pg_policies WHERE schemaname IN ('iam','app_private','audit')) || '|' ||
      (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p') AND c.relforcerowsecurity
        AND n.nspname IN ('iam','app_private','audit')) || '|' ||
      (SELECT count(*)::text FROM pg_extension WHERE extname='pgcrypto') || '|' ||
      (SELECT count(*)::text FROM iam.schema_migrations) || '|' ||
      (SELECT md5(coalesce(string_agg(
          format('%s.%s|%s|%s|%s|%s|%s',n.nspname,c.relname,c.relkind,
            pg_get_userbyid(c.relowner),coalesce(c.relacl::text,''),c.relrowsecurity,c.relforcerowsecurity),
          E'\\n' ORDER BY n.nspname,c.relname),''))
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE c.relkind IN ('r','p') AND n.nspname IN ('iam','app_private','audit')) || '|' ||
      (SELECT md5(coalesce(string_agg(
          format('%s.%s.%s|%s|%s|%s|%s',schemaname,tablename,policyname,cmd,
            roles::text,qual,with_check),E'\\n' ORDER BY schemaname,tablename,policyname),''))
       FROM pg_policies WHERE schemaname IN ('iam','app_private','audit')) || '|' ||
      (SELECT md5(coalesce(string_agg(
          format('%s|%s|%s',nspname,pg_get_userbyid(nspowner),coalesce(nspacl::text,'')),
          E'\\n' ORDER BY nspname),''))
       FROM pg_namespace WHERE nspname IN ('iam','app_private','audit')) || '|' ||
      (SELECT md5(coalesce(string_agg(
          format('%s.%s|%s|%s|%s',n.nspname,p.proname,p.prosecdef,
            pg_get_userbyid(p.proowner),coalesce(p.proacl::text,'')),
          E'\\n' ORDER BY n.nspname,p.proname,p.oid),''))
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('iam','app_private','audit'))"""
    return tuple(sql(pg_env, query).split("|"))


def table_names(pg_env: dict[str, str]) -> list[tuple[str, str]]:
    raw = sql(pg_env, """SELECT coalesce(json_agg(json_build_array(n.nspname,c.relname)
                              ORDER BY n.nspname,c.relname)::text,'[]')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE c.relkind='r' AND n.nspname IN ('iam','app_private','audit')""")
    names = json.loads(raw)
    if not isinstance(names, list) or len(names) < 20 or len(names) > 100:
        raise Blocked("BLOCKED_G1_RESTORE_TABLE_LIST")
    if any(not isinstance(row, list) or len(row) != 2 or any(
            not isinstance(z, str) or len(z) > 128 for z in row) for row in names):
        raise Blocked("BLOCKED_G1_RESTORE_TABLE_NAME")
    return [(s, t) for s, t in names]


def table_counts(pg_env: dict[str, str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for schema, table in table_names(pg_env):
        safe = lambda s: '"' + s.replace('"', '""') + '"'
        quantity = sql(pg_env, "SELECT count(*) FROM " + safe(schema) + "." + safe(table))
        if not re.fullmatch(r"[0-9]{1,18}", quantity):
            raise Blocked("BLOCKED_G1_RESTORE_TABLE_COUNT")
        counts[schema + "." + table] = int(quantity)
    return counts


def verify_archive_toc(archive: bytes, pg_env: dict[str, str]) -> None:
    toc = pg18_phase("ARCHIVE_TOC", lambda: pg18(
        ["pg_restore", "--list", "-"], pg_env, data=archive, timeout=90))
    if len(toc) > 1048576:
        raise Blocked("BLOCKED_G1_RESTORE_TOC_OVERSIZE")
    lines = toc.decode("utf-8").splitlines()
    # Entry markers from pg_dump -Fc: " TABLE ", " TABLE DATA ", " POLICY ", " EXTENSION ".
    table_definitions = sum(bool(re.search(r"; [0-9]+ [0-9]+ TABLE ", line)) for line in lines)
    table_data = sum(bool(re.search(r"; [0-9]+ [0-9]+ TABLE DATA ", line)) for line in lines)
    policies = sum(bool(re.search(r"; [0-9]+ [0-9]+ POLICY ", line)) for line in lines)
    if (table_definitions != 23 or table_data < 1 or policies != 41 or
            not any(" EXTENSION - pgcrypto " in line for line in lines)):
        raise Blocked("BLOCKED_G1_RESTORE_ARCHIVE_TOC_PARITY")


def rollback_drill(pg_env: dict[str, str]) -> None:
    ddl = ("BEGIN; CREATE TABLE public.iam_g1_rollback_probe (id integer PRIMARY KEY); "
           "INSERT INTO public.iam_g1_rollback_probe VALUES (1); ROLLBACK;")
    pg18(["psql", "-X", "-w", "-q", "-v", "ON_ERROR_STOP=1", "-c", ddl], pg_env)
    if sql(pg_env, "SELECT CASE WHEN to_regclass('public.iam_g1_rollback_probe') IS NULL "
                       "THEN 'PASS' ELSE 'FAIL' END") != "PASS":
        raise Blocked("BLOCKED_G1_RESTORE_ROLLBACK_NOT_CLEAN")


def cleanup_target(password: str) -> None:
    # This is deliberately destructive ONLY for the exact, previously-attested
    # disposable database. Never accepts user-supplied database names or branches.
    maintenance = pg_environment(password, database=MAINTENANCE_DATABASE)
    identity(maintenance, MAINTENANCE_DATABASE)
    if sql(maintenance, "SELECT count(*) FROM pg_database "
                        "WHERE datname='" + TARGET_DATABASE + "'") != "1":
        raise Blocked("BLOCKED_G1_RESTORE_CLEANUP_DATABASE_IDENTITY")
    sql(maintenance, "DROP DATABASE " + TARGET_DATABASE + " WITH (FORCE)")
    if sql(maintenance, "SELECT count(*) FROM pg_database "
                        "WHERE datname='" + TARGET_DATABASE + "'") != "0":
        raise Blocked("BLOCKED_G1_RESTORE_CLEANUP_RESIDUE")
    if sql(maintenance, "SELECT count(*) FROM pg_database "
                        "WHERE datname='" + INHERITED_DATABASE + "'") != "1":
        raise Blocked("BLOCKED_G1_RESTORE_INHERITED_DATABASE_NOT_PRESERVED")
    print("PASS_G1_RESTORE_ISOLATED_DATABASE_CLEANUP_ZERO_RESIDUE")


def stage_b2(env: dict[str, str]) -> None:
    assert_trusted_main(env)
    r = reader()
    key, digest, size = r.verify_scope(env)
    if (key != aead().APPROVED_OBJECT or digest != aead().APPROVED_SHA256
            or size != aead().APPROVED_SIZE):
        raise Blocked("BLOCKED_G1_RESTORE_B2_WRITER_MANIFEST")
    r.attest_environment(env)
    r.attest_native_key_scope(env)
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
    client = boto3.client(
        "s3", endpoint_url=r.ENDPOINT, region_name=r.REGION,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                      connect_timeout=10, read_timeout=30, retries={"total_max_attempts": 1}),
    )
    try:
        try:
            probe = client.get_object(Bucket=r.BUCKET, Key=r.NEGATIVE_PROBE, Range="bytes=0-0")
        except ClientError as err:
            r.verify_probe_denial(err.response.get("Error", {}).get("Code", "UNKNOWN"))
        else:
            if hasattr(probe.get("Body"), "close"):
                probe["Body"].close()
            raise Blocked("BLOCKED_G1_RESTORE_B2_CROSS_PREFIX_READ")
        obj = client.get_object(Bucket=r.BUCKET, Key=key)
        try:
            data = obj["Body"].read(size + 1)
        finally:
            obj["Body"].close()
        obj["Body"] = io.BytesIO(data)
        r.verify_ciphertext(obj, digest, size)
    except (ClientError, BotoCoreError, OSError, ValueError):
        raise Blocked("BLOCKED_G1_RESTORE_B2_READBACK") from None
    path = stage_path(env)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    print("PASS_G1_RESTORE_B2_READ_ONLY_ENCRYPTED_ARTIFACT_STAGED")


def attest_restore_environment(env: dict[str, str]) -> None:
    assert_trusted_main(env)
    r = reader()
    r.ENVIRONMENT = RESTORE_ENVIRONMENT
    r.attest_environment(env)
    print("PASS_G1_RESTORE_PROTECTED_ENVIRONMENT_MAIN_ONLY")


def restore(env: dict[str, str]) -> None:
    assert_trusted_main(env, confirm=True)
    ensure_lease()
    attest_restore_environment(env)
    password = parse_target(env.get("IAM_G1_RESTORE_TARGET_DATABASE_URL", ""))
    try:
        key = base64.b64decode(env.get("IAM_G1_RESTORE_AES256_GCM_KEY_B64", ""), validate=True)
    except (ValueError, base64.binascii.Error):
        raise Blocked("BLOCKED_G1_RESTORE_ESCROW_KEY_NOT_VALID_BASE64") from None
    if len(key) != 32 or env.get("IAM_G1_RESTORE_PRIVATE_ESCROW") != "PRIVATE_ESCROW_CONFIRMED":
        raise Blocked("BLOCKED_G1_RESTORE_AES_CUSTODY_NOT_ATTESTED")
    approved = aead()
    path = stage_path(env)
    if path.is_symlink() or not path.is_file() or path.stat().st_size != approved.APPROVED_SIZE:
        raise Blocked("BLOCKED_G1_RESTORE_ENCRYPTED_ARTIFACT_NOT_EXACT")
    ciphertext = path.read_bytes()
    approved.approved_identity(approved.SOURCE_SHA, approved.APPROVED_OBJECT,
                               approved.APPROVED_SHA256, approved.APPROVED_SIZE)
    plaintext = approved.authenticate_envelope(
        ciphertext, key, approved.SOURCE_SHA, approved.APPROVED_SHA256, approved.APPROVED_SIZE
    )
    print("PASS_G1_RESTORE_ACTUAL_AES256_GCM_TAG_VERIFIED_BEFORE_DDL")
    pg_env = pg_environment(password)
    pg18_phase("TARGET_IDENTITY", lambda: identity(pg_env, TARGET_DATABASE))
    pg18_phase("TARGET_EMPTY", lambda: assert_empty(pg_env))
    print("PASS_G1_RESTORE_EXACT_EMPTY_DISPOSABLE_DB_AND_PG18_TLS")
    # The inherited database is read-only reference, NEVER a restore target.
    reference_env = pg_environment(password, database=INHERITED_DATABASE)
    pg18_phase("REFERENCE_IDENTITY", lambda: identity(reference_env, INHERITED_DATABASE))
    before = pg18_phase("REFERENCE_CATALOG", lambda: catalog(reference_env))
    if len(before) != 9 or before[:5] != ("23", "41", "20", "1", "0"):
        raise Blocked("BLOCKED_G1_RESTORE_INHERITED_CANONICAL_BASELINE")
    verify_archive_toc(plaintext, pg_env)
    print("PASS_G1_RESTORE_AUTHENTICATED_PG18_TOC_AND_TABLE_DATA")
    # Only from this point can DDL occur, after tag, SHA, TTL, exact DB & TOC.
    try:
        pg18_phase("RESTORE_APPLY", lambda: pg18(
            ["pg_restore", "--single-transaction", "--exit-on-error",
             "--dbname=" + TARGET_DATABASE, "-"], pg_env, data=plaintext, timeout=900))
        restored = pg18_phase("RESTORED_CATALOG", lambda: catalog(pg_env))
        if restored != before or len(restored) != 9:
            raise Blocked("BLOCKED_G1_RESTORE_OWNER_ACL_RLS_LEDGER_CATALOG_PARITY")
        if (pg18_phase("REFERENCE_COUNTS", lambda: table_counts(reference_env)) !=
                pg18_phase("RESTORED_COUNTS", lambda: table_counts(pg_env))):
            raise Blocked("BLOCKED_G1_RESTORE_TABLE_ROW_COUNTS_PARITY")
        bad_roles = pg18_phase("RLS_BYPASS_ROLES", lambda: sql(
            pg_env, "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'iam_%' "
                    "AND rolbypassrls"))
        if bad_roles != "0":
            raise Blocked("BLOCKED_G1_RESTORE_IAM_RUNTIME_BYPASSRLS")
        print("PASS_G1_RESTORE_23_TABLES_41_POLICIES_20_FORCED_RLS_LEDGER_OWNER_ACL_ROWS")
        pg18_phase("ROLLBACK", lambda: rollback_drill(pg_env))
        print("PASS_G1_RESTORE_COMMITTED_DDL_ROLLBACK_DRILL")
    finally:
        # If the exact target was attested empty, remove it even on failed restore,
        # so no sensitive test rows remain. A cleanup failure is a hard FAIL.
        pg18_phase("CLEANUP", lambda: cleanup_target(password))
        path.unlink(missing_ok=True)
    print("PASS_G1_FULL_B2_ARCHIVE_RESTORED_AUDITED_AND_REMOVED_ISOLATED")


def main() -> int:
    try:
        if sys.argv[1:] == ["--check"]:
            assert_trusted_main(dict(os.environ))
            ensure_lease()
            print("PASS_G1_RESTORE_TRUSTED_MAIN_LEASE_ONLY_NO_SECRETS_OR_SQL")
        elif sys.argv[1:] == ["--stage-b2"]:
            stage_b2(dict(os.environ))
        elif sys.argv[1:] == ["--attest-env"]:
            attest_restore_environment(dict(os.environ))
        elif sys.argv[1:] == ["--restore"]:
            restore(dict(os.environ))
        else:
            print("usage: iam-g1-full-restore.py --check|--stage-b2|--attest-env|--restore", file=sys.stderr)
            return 2
    except Blocked as exc:
        print(str(exc), file=sys.stderr)
        print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
