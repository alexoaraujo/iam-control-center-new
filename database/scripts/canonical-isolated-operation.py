#!/usr/bin/env python3
"""Gated PostgreSQL18 schema-only export and isolated restore; no application rows."""
from __future__ import annotations
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib.parse import unquote, urlparse

BASE = Path(__file__).resolve().parent
GUARD = BASE / "guard-canonical-restore-target.py"
spec = importlib.util.spec_from_file_location("iam_canonical_guard", GUARD)
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

EXPIRES = datetime.fromisoformat("2026-11-20T09:12:00+00:00")
APPROVAL = "APPROVED_BR_SWEET_UNION_ONLY"
CONFIRMATION = "RESTORE_BR_SWEET_UNION_ONLY"
# Built by the gated GitHub workflow from the minimal CA fixture.
PG18_CLIENT_IMAGE = "iam-pg18-system-ca:local"

class GateBlocked(Exception):
    pass

def pg_env(url: str) -> dict[str, str]:
    parsed = urlparse(url)
    return {
        "PGHOST": parsed.hostname or "",
        "PGPORT": str(parsed.port or 5432),
        "PGDATABASE": unquote(parsed.path.lstrip("/")),
        "PGUSER": unquote(parsed.username or ""),
        "PGPASSWORD": unquote(parsed.password or ""),
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": "system",
        "PGCONNECT_TIMEOUT": "20",
        "PGOPTIONS": "-c statement_timeout=60000 -c lock_timeout=10000",
    }

def no_trust_env() -> dict[str, str]:
    """Strip inherited PG settings and secret URLs from Docker subprocesses."""
    return {k: v for k, v in os.environ.items()
            if not k.startswith("PG") and k not in (
                "IAM_CANONICAL_SOURCE_URL", "IAM_CANONICAL_TARGET_URL",
                "IAM_CANONICAL_OPERATOR_APPROVAL", "IAM_CANONICAL_CONFIRMATION")}

def docker_run(args: list[str], creds: dict[str, str], workspace: Path) -> str:
    # No credentials appear in the subprocess command line or GitHub logs.
    secret_file = workspace / ("pgpass-%d.env" % os.getpid())
    fd = os.open(secret_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf8") as f:
        for k, value in creds.items():
            if "\n" in value or "\r" in value:
                raise GateBlocked("invalid connection environment")
            f.write(f"{k}={value}\n")
    cmd = [
        "docker", "run", "--rm", "--network", "host", "--user", str(os.getuid()),
        "--env-file", str(secret_file), "-v", f"{workspace}:/work",
        PG18_CLIENT_IMAGE, *args
    ]
    try:
        result = subprocess.run(
            cmd, env=no_trust_env(), check=False,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=300
        )
        if result.returncode:
            # Never emit raw stderr: pg client errors may include SQL or secrets.
            # Emit only an allowlisted stage and failure category.
            stage = {
                "psql": ("source_preflight" if creds.get("PGUSER") == mod.SOURCE_ROLE
                         else "target_preflight"),
                "pg_dump": "schema_export",
                "pg_restore": "archive_inspection" if "--list" in args else "schema_restore",
            }.get(args[0], "postgres_client")
            stderr = result.stderr.lower()
            if "no password supplied" in stderr:
                category = "AUTH_NO_PASSWORD"
            elif "password authentication failed" in stderr:
                category = "AUTH_REJECTED"
            elif "password has expired" in stderr or "expired password" in stderr:
                category = "AUTH_EXPIRED"
            elif "role " in stderr and "does not exist" in stderr:
                category = "AUTH_ROLE_MISSING"
            elif ("certificate verify failed" in stderr
                  or "server certificate for" in stderr
                  or "hostname mismatch" in stderr):
                category = "TLS_CERT_VERIFY"
            elif ("root certificate" in stderr or "sslrootcert" in stderr
                  or "certificate store" in stderr):
                category = "TLS_TRUST_STORE"
            elif ("ssl error" in stderr or "sslmode" in stderr
                  or "tlsv1 alert" in stderr):
                category = "TLS_HANDSHAKE"
            elif ("permission denied" in stderr or "must be owner" in stderr
                  or "insufficient privilege" in stderr):
                category = "PRIVILEGE"
            elif ("could not translate host name" in stderr or "connection refused" in stderr
                  or "connection timed out" in stderr or "network is unreachable" in stderr):
                category = "NETWORK"
            else:
                category = "UNCLASSIFIED"
            raise GateBlocked(f"PG18_{stage.upper()}_{category}: command failed; "
                              "raw stderr withheld for secret/SQL safety")
        return result.stdout.strip()
    except subprocess.TimeoutExpired as e:
        raise GateBlocked("PostgreSQL command timed out") from e
    finally:
        secret_file.unlink(missing_ok=True)

def scalar(sql: str, creds: dict[str, str], workspace: Path) -> str:
    return docker_run(["psql", "-X", "-w", "-v", "ON_ERROR_STOP=1",
                       "-A", "-t", "-c", sql], creds, workspace)

def check_authentication_only(creds: dict[str, str],
                              expected_database: str, expected_role: str,
                              workspace: Path) -> None:
    """Authenticate through libpq with strict client-side TLS, then check session identity.

    Neon's proxy terminates external TLS before forwarding to PostgreSQL.
    pg_stat_ssl describes the proxy-to-backend hop, NOT client-to-proxy TLS.
    PGSSLMODE=verify-full and PGSSLROOTCERT=system force libpq to reject
    untrusted certificates and hostname mismatches before this SELECT succeeds.
    """
    if creds.get("PGSSLMODE") != "verify-full" or creds.get("PGSSLROOTCERT") != "system":
        raise GateBlocked("BLOCKED_AUTH_TLS_CONFIG: verified external TLS is mandatory")
    sql = "SELECT current_database(), current_user, session_user"
    got = scalar(sql, creds, workspace).split("|")
    if len(got) != 3:
        raise GateBlocked("BLOCKED_AUTH_OUTPUT_SHAPE: expected three identity columns")
    if got[0] != expected_database:
        raise GateBlocked("BLOCKED_AUTH_DATABASE: connected database differs from allowlist")
    if got[1] != expected_role or got[2] != expected_role:
        raise GateBlocked("BLOCKED_AUTH_ROLE: effective/session identity differs from allowlist")


def check_source(creds: dict[str, str], workspace: Path) -> None:
    sql = """SELECT current_database(), current_user, session_user,
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')),
      (SELECT count(*) FROM pg_policies
       WHERE schemaname IN ('iam','audit','app_private')),
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('iam','audit','app_private')
       AND c.relkind IN ('r','p') AND c.relforcerowsecurity),
      (SELECT has_table_privilege(current_user,c.oid,'SELECT')
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='iam' AND c.relname='schema_migrations'
          AND c.relkind IN ('r','p')),
      (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),
      (SELECT rolcanlogin FROM pg_roles WHERE rolname=current_user),
      (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
       WHERE r.rolname=current_user)"""
    got = scalar(sql, creds, workspace).split("|")
    expected = [
        "iam_database", mod.SOURCE_ROLE, mod.SOURCE_ROLE,
        "23", "41", "20", "f", "f", "t", "0"
    ]
    if got != expected:
        raise GateBlocked("source identity, schema or least-privilege check failed")

def check_target(creds: dict[str, str], workspace: Path) -> None:
    sql = """SELECT current_database(), current_user, session_user,
      (SELECT count(*) FROM pg_namespace WHERE nspname IN ('iam','audit','app_private')),
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')),
      (SELECT count(*) FROM pg_policies WHERE schemaname IN ('iam','audit','app_private')),
      (SELECT count(*) FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
       WHERE a.grantee=to_regrole('iam_app_runtime_login')),
      (SELECT count(*) FROM pg_roles WHERE rolname IN
       ('iam_owner','iam_app_runtime','iam_worker','iam_migrator')),
      (SELECT count(*) FROM pg_roles WHERE rolname IN
       ('iam_owner','iam_app_runtime','iam_worker','iam_migrator')
       AND NOT rolbypassrls AND NOT rolsuper),
      (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
       JOIN pg_roles p ON p.oid=m.roleid
       WHERE r.rolname=current_user AND p.rolname='iam_owner' AND m.set_option),
      to_regclass('iam.schema_migrations') IS NULL"""
    got = scalar(sql, creds, workspace).split("|")
    expected = [
        "iam_canonical_validation", "neondb_owner", "neondb_owner",
        "0", "0", "0", "0", "4", "4", "1", "t"
    ]
    if got != expected:
        raise GateBlocked("target identity or clean-catalog check failed; refusing DDL")

def check_restored(creds: dict[str, str], workspace: Path) -> None:
    sql = """SELECT
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')),
      (SELECT count(*) FROM pg_policies
       WHERE schemaname IN ('iam','audit','app_private')),
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('iam','audit','app_private')
       AND c.relkind IN ('r','p') AND c.relforcerowsecurity),
      (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('iam','audit','app_private')
       AND c.relkind IN ('r','p') AND c.relowner=to_regrole('iam_owner')),
      to_regclass('iam.schema_migrations') IS NOT NULL,
      (SELECT count(*) FROM iam.schema_migrations)"""
    if scalar(sql, creds, workspace) != "23|41|20|23|t|0":
        raise GateBlocked("post-restore contract mismatch; freeze isolated target for review")

def check_restore_acl_principals(source_creds: dict[str, str],
                                 target_creds: dict[str, str],
                                 workspace: Path) -> None:
    """Fail before the first DDL when pg_dump ACL grantee roles are absent.

    PostgreSQL roles are branch-wide in Neon. This workflow must NEVER create,
    alter or inherit them automatically to satisfy a database-scoped approval.
    """
    acl_sql = """WITH acl_grantees AS (
      SELECT (aclexplode(n.nspacl)).grantee AS grantee
        FROM pg_namespace n WHERE n.nspname IN ('iam','audit','app_private')
      UNION ALL
      SELECT (aclexplode(c.relacl)).grantee
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname IN ('iam','audit','app_private') AND c.relacl IS NOT NULL
      UNION ALL
      SELECT (aclexplode(p.proacl)).grantee
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('iam','audit','app_private') AND p.proacl IS NOT NULL
      UNION ALL
      SELECT (aclexplode(d.defaclacl)).grantee
        FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
       WHERE n.nspname IN ('iam','audit','app_private')
    )
    SELECT DISTINCT rolname FROM acl_grantees a
      JOIN pg_roles r ON r.oid=a.grantee
     WHERE a.grantee <> 0 ORDER BY rolname"""
    required = set(scalar(acl_sql, source_creds, workspace).splitlines())
    target_sql = "SELECT rolname FROM pg_roles WHERE rolname LIKE 'iam_%' ORDER BY rolname"
    existing = set(scalar(target_sql, target_creds, workspace).splitlines())
    if not required or not {"iam_owner", "iam_app_runtime"}.issubset(required):
        raise GateBlocked("source ACL principal inventory incomplete; no DDL permitted")
    missing = sorted(required - existing)
    if missing:
        raise GateBlocked(
            "BLOCKED_SOURCE_ACL_PRINCIPALS: destination Neon branch lacks role(s) "
            + ", ".join(missing) + "; database-only authorization does not allow CREATE ROLE"
        )


def check_runtime_role_contract(source_creds: dict[str, str],
                                target_creds: dict[str, str],
                                workspace: Path) -> None:
    """A restored RLS schema is not canonical with a divergent login inheritance."""
    sql = """SELECT rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper
      FROM pg_roles
     WHERE rolname IN ('iam_app_runtime_login','iam_migrator_login','iam_worker_login')
     ORDER BY rolname"""
    source = scalar(sql, source_creds, workspace).strip()
    target = scalar(sql, target_creds, workspace).strip()
    if not source or source != target:
        raise GateBlocked(
            "BLOCKED_ROLE_ATTRIBUTES: source and destination IAM login roles differ; "
            "roles are Neon branch-wide and must be reviewed independently before DDL"
        )


    # Compare every outbound membership and PostgreSQL 16+ SET / INHERIT
    # option; equal LOGIN attributes do not establish authorization parity.
    membership_sql = """SELECT member.rolname, granted.rolname,
      m.admin_option, m.inherit_option, m.set_option
      FROM pg_auth_members m
      JOIN pg_roles member ON member.oid=m.member
      JOIN pg_roles granted ON granted.oid=m.roleid
      WHERE member.rolname IN
        ('iam_app_runtime_login','iam_migrator_login','iam_worker_login')
      ORDER BY member.rolname, granted.rolname"""
    source_memberships = scalar(membership_sql, source_creds, workspace).strip()
    target_memberships = scalar(membership_sql, target_creds, workspace).strip()
    if not source_memberships or source_memberships != target_memberships:
        raise GateBlocked(
            "BLOCKED_ROLE_MEMBERSHIPS: source and destination LOGIN role "
            "memberships differ (including ADMIN, INHERIT and SET options); "
            "no restoration DDL is permitted"
        )



def check_schema_export_lock_permissions(creds: dict[str, str], workspace: Path) -> None:
    """pg_dump schema-only still needs ACCESS SHARE on every selected table.

    Do not grant SELECT on IAM identity or secret tables just to satisfy a dump.
    Source-DB remediation requires a separately approved, auditable export identity.
    """
    sql = """SELECT count(*),
       count(*) FILTER (WHERE
         has_table_privilege(current_user,c.oid,'SELECT') OR
         has_table_privilege(current_user,c.oid,'MAINTAIN') OR
         has_table_privilege(current_user,c.oid,'UPDATE') OR
         has_table_privilege(current_user,c.oid,'DELETE') OR
         has_table_privilege(current_user,c.oid,'TRUNCATE'))
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')"""
    if scalar(sql, creds, workspace).strip() != "23|23":
        raise GateBlocked(
            "BLOCKED_SOURCE_SCHEMA_LOCK_PRIVILEGES: export reader lacks "
            "ACCESS SHARE eligibility on all 23 IAM tables; never grant "
            "blanket SELECT on sensitive source tables")


def check_migrator_owner_membership(source_creds: dict[str, str],
                                    target_creds: dict[str, str],
                                    workspace: Path) -> None:
    """Ensure migrator can SET iam_owner with no automatic inheritance/admin."""
    sql = """SELECT m.admin_option,m.inherit_option,m.set_option
      FROM pg_auth_members m
      JOIN pg_roles member ON member.oid=m.member
      JOIN pg_roles granted ON granted.oid=m.roleid
     WHERE member.rolname='iam_migrator' AND granted.rolname='iam_owner'"""
    source = scalar(sql, source_creds, workspace).strip()
    target = scalar(sql, target_creds, workspace).strip()
    if source != "f|f|t" or target != source:
        raise GateBlocked(
            "BLOCKED_MIGRATOR_OWNER_MEMBERSHIP: isolated destination differs "
            "from source (ADMIN=false, INHERIT=false, SET=true); "
            "privileged role changes require independent approval")


def check_pgcrypto_availability(source_creds: dict[str, str],
                               target_creds: dict[str, str],
                               workspace: Path) -> None:
    source = scalar(
        "SELECT count(*) FROM pg_extension WHERE extname='pgcrypto'",
        source_creds, workspace).strip()
    target = scalar(
        "SELECT count(*) FROM pg_available_extensions WHERE name='pgcrypto'",
        target_creds, workspace).strip()
    if source != "1" or target != "1":
        raise GateBlocked("BLOCKED_PGCRYPTO: source extension or target package missing")


def check_authenticated_readiness(source_creds: dict[str, str],
                                  target_creds: dict[str, str],
                                  workspace: Path) -> None:
    """Catalog-only checks; collect all blockers without touching data or DDL."""
    checks = (
        lambda: check_restore_acl_principals(source_creds, target_creds, workspace),
        lambda: check_runtime_role_contract(source_creds, target_creds, workspace),
        lambda: check_migrator_owner_membership(source_creds, target_creds, workspace),
        lambda: check_pgcrypto_availability(source_creds, target_creds, workspace),
        lambda: check_schema_export_lock_permissions(source_creds, workspace),
    )
    blockers = []
    for check in checks:
        try:
            check()
        except GateBlocked as exc:
            blockers.append(str(exc))
    if blockers:
        raise GateBlocked("; ".join(blockers))
    print("PASS_AUTHENTICATED_READINESS_ONLY: source/target catalogs, "
          "ACL roles, grants and extension prerequisites; no DDL or data read")


def execute(mode: str) -> None:
    if mode not in ("auth_only", "readiness_only", "export_only", "restore_isolated"):
        raise GateBlocked("unrecognized operation")
    if datetime.now(timezone.utc) >= EXPIRES:
        raise GateBlocked("disposable Neon branch has expired")
    source = os.environ.get("IAM_CANONICAL_SOURCE_URL", "")
    target = os.environ.get("IAM_CANONICAL_TARGET_URL", "")
    try:
        mod.verify_connections(source, target)
    except mod.GateBlocked as e:
        raise GateBlocked(str(e)) from e
    if mode in ("auth_only", "readiness_only", "export_only") and os.environ.get("IAM_CANONICAL_CONFIRMATION", "") != "NO_DDL":
        raise GateBlocked("read-only operation requires NO_DDL confirmation")
    if mode == "restore_isolated":
        if os.environ.get("IAM_CANONICAL_OPERATOR_APPROVAL", "") != APPROVAL:
            raise GateBlocked("protected environment approval secret missing or invalid")
        if os.environ.get("IAM_CANONICAL_CONFIRMATION", "") != CONFIRMATION:
            raise GateBlocked("manual operation confirmation mismatch")
    with tempfile.TemporaryDirectory(
        prefix="iam-canonical-", dir=os.environ.get("RUNNER_TEMP") or None
    ) as tmp:
        workspace = Path(tmp)
        src = pg_env(source)
        dst = pg_env(target)
        if mode == "auth_only":
            failures = []
            for label, credentials, database, role in (
                ("SOURCE", src, mod.SOURCE_DATABASE, mod.SOURCE_ROLE),
                ("TARGET", dst, mod.TARGET_DATABASE, mod.TARGET_ROLE),
            ):
                try:
                    check_authentication_only(credentials, database, role, workspace)
                except GateBlocked as exc:
                    # Only allowlisted diagnostics; raw stderr, passwords and SQL suppressed.
                    failures.append(f"{label}: {exc}")
            if failures:
                raise GateBlocked("BLOCKED_AUTH_ONLY: " + "; ".join(failures))
            print("PASS_AUTHENTICATED_IDENTITY_ONLY: pinned DB, role and verified TLS; no DDL")
            return
        check_source(src, workspace)
        check_target(dst, workspace)
        # Every export or restore must pass the SAME comprehensive readiness gate
        # as readiness_only, before any pg_dump call or other external operation.
        # This prevents an isolated grant to the export role from bypassing
        # source/target role and membership parity checks.
        check_authenticated_readiness(src, dst, workspace)
        if mode == "readiness_only":
            return
        archive = workspace / "schema.dump"
        docker_run([
            "pg_dump", "-w", "--schema-only", "--format=custom",
            "--schema=iam", "--schema=audit", "--schema=app_private",
            "--file=/work/schema.dump"
        ], src, workspace)
        if not archive.is_file() or archive.stat().st_size < 2048:
            raise GateBlocked("schema-only export is missing or too small")
        toc = docker_run(["pg_restore", "--list", "/work/schema.dump"], src, workspace)
        if any("TABLE DATA " in line or "BLOB DATA " in line for line in toc.splitlines()):
            raise GateBlocked("schema-only archive unexpectedly includes data")
        import hashlib
        fingerprint = hashlib.sha256(archive.read_bytes()).hexdigest()
        print("PASS_AUTHENTICATED_SCHEMA_EXPORT: verified TLS, least-privilege PG18 schema-only")
        print(f"SCHEMA_DUMP_SHA256={fingerprint}; archive is not uploaded")
        if mode == "export_only":
            print("EXPORT_ONLY: no DDL or restoration performed")
            return
        # Inventory ACL recipients before any extension, CREATE or restore DDL.
        check_restore_acl_principals(src, dst, workspace)
        check_runtime_role_contract(src, dst, workspace)
        check_migrator_owner_membership(src, dst, workspace)
        check_pgcrypto_availability(src, dst, workspace)
        # Scope is the exact isolated database, NEVER inherited iam_database.
        # CREATE EXTENSION may remain if restore fails; other DDL is one transaction.
        docker_run([
            "psql", "-X", "-w", "-v", "ON_ERROR_STOP=1", "-c",
            "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public"
        ], dst, workspace)
        docker_run([
            "pg_restore", "-w", "--exit-on-error", "--single-transaction",
            "--dbname=iam_canonical_validation", "/work/schema.dump"
        ], dst, workspace)
        check_restored(dst, workspace)
        print("PASS_ISOLATED_SCHEMA_RESTORE: 23 tables, 41 policies, 20 FORCE RLS, 23 owners")
        print("REMAINING_GATES: ledger, business data, independent rollback, RLS A/B, release")

def main() -> int:
    try:
        if len(sys.argv) != 2:
            raise GateBlocked("specify exactly one operation")
        execute(sys.argv[1])
    except GateBlocked as e:
        print(f"BLOCKED_CANONICAL_EXECUTION: {e}", file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
