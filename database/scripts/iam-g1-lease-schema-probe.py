#!/usr/bin/env python3
"""Authenticated PG18 schema-only pg_dump on ONE disposable Neon branch.

No GRANT, data export, remote restore, source Development or Production access.
Only a protected environment secret supplies the dedicated lease role password.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import parse_qs, unquote, urlsplit

EXPECTED_HOST = "ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech"
EXPECTED_ROLE = "iam_schema_export_reader"
EXPECTED_DB = "iam_database"
IMAGE = "iam-pg18-system-ca:local"


class Blocked(RuntimeError):
    pass


def validate_url(raw: str) -> dict[str, str]:
    if not raw:
        raise Blocked("MISSING_PROTECTED_LEASE_SECRET")
    if any(char in raw for char in "\r\n\x00"):
        raise Blocked("INVALID_CONNECTION_URL")
    try:
        url = urlsplit(raw)
        params = parse_qs(url.query, keep_blank_values=True, strict_parsing=True)
        role = unquote(url.username or "")
        password = unquote(url.password or "")
        db = unquote(url.path.lstrip("/"))
        port = url.port or 5432
    except (ValueError, UnicodeError) as exc:
        raise Blocked("INVALID_CONNECTION_URL") from exc
    if (url.scheme not in ("postgres", "postgresql") or
            url.hostname != EXPECTED_HOST or port != 5432 or
            db != EXPECTED_DB or role != EXPECTED_ROLE or
            url.fragment or not password or
            "pooler" in (url.hostname or "")):
        raise Blocked("LEASE_BRANCH_IDENTITY_MISMATCH")
    if params != {"sslmode": ["verify-full"], "sslrootcert": ["system"]}:
        raise Blocked("TLS_VERIFY_FULL_SYSTEM_CA_REQUIRED")
    if any(char in password for char in "\r\n\x00"):
        raise Blocked("INVALID_CONNECTION_URL")
    return {
        "PGHOST": EXPECTED_HOST,
        "PGPORT": "5432",
        "PGDATABASE": EXPECTED_DB,
        "PGUSER": EXPECTED_ROLE,
        "PGPASSWORD": password,
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": "system",
        "PGCONNECT_TIMEOUT": "15",
        "PGOPTIONS": "-c statement_timeout=60000 -c lock_timeout=5000",
        "SSL_CERT_FILE": "/etc/ssl/certs/ca-certificates.crt",
    }


def classify(stderr: str) -> str:
    """Classify denied operation, never emit SQL, object names or raw stderr."""
    low = stderr.lower()
    # PostgreSQL error text may contain object names or SQL: use ONLY static
    # category codes. Schema, lock, table and sequence are diagnostically
    # different but never disclose identifiers or credentials.
    if "permission denied for schema" in low:
        return "SCHEMA_USAGE_DENIED"
    if "permission denied for sequence" in low:
        return "SEQUENCE_PRIVILEGE_DENIED"
    if "permission denied for view" in low:
        return "VIEW_PRIVILEGE_DENIED"
    if "permission denied for table" in low or "permission denied for relation" in low:
        return "TABLE_PRIVILEGE_DENIED"
    if ("permission denied to lock" in low or
            "must have select privilege" in low or
            "permission denied for lock" in low):
        return "LOCK_PRIVILEGE_DENIED"
    if "must be owner" in low:
        return "OWNERSHIP_REQUIRED"
    if any(part in low for part in ("permission denied", "insufficient privilege",
                                   "not permitted")):
        return "PRIVILEGE_DENIED"
    if any(part in low for part in ("password authentication failed",
                                   "no password supplied", "role \"")):
        return "AUTHENTICATION_DENIED"
    if any(part in low for part in ("certificate", "sslrootcert", "tlsv1", "ssl error")):
        return "TLS_VERIFICATION_FAILED"
    if any(part in low for part in ("connection refused", "timed out",
                                   "could not translate host", "network is unreachable")):
        return "NETWORK_UNREACHABLE"
    return "UNCLASSIFIED_FAILURE"


def run_pg(args: list[str], env: dict[str, str], folder: Path) -> str:
    """Use a 0600 ephemeral env file and suppress raw PostgreSQL stderr."""
    secret_path = folder / "pg-secret.env"
    fd = os.open(secret_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf8") as out:
            for key, value in env.items():
                if "\r" in value or "\n" in value:
                    raise Blocked("INVALID_CONNECTION_ENVIRONMENT")
                out.write(f"{key}={value}\n")
        cmd = [
            "docker", "run", "--rm", "--network", "host",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "--env-file", str(secret_path),
            "--volume", f"{folder}:/work",
            "--workdir", "/work", IMAGE, *args,
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=180,
            check=False,
            env={k: v for k, v in os.environ.items()
                 if not k.startswith("PG") and
                 k not in ("IAM_EXPORT_LEASE_DATABASE_URL", "IAM_G1_LEASE_DIRECT_URL")},
        )
        if result.returncode:
            raise Blocked(f"{args[0].upper()}_{classify(result.stderr)}")
        return result.stdout.strip()
    except subprocess.TimeoutExpired as exc:
        raise Blocked("POSTGRES_CLIENT_TIMEOUT") from exc
    finally:
        secret_path.unlink(missing_ok=True)


def run_probe(env: dict[str, str], folder: Path) -> dict[str, str | int]:
    identity = run_pg([
        "psql", "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1",
        "-c", "SELECT current_database(),current_user,session_user",
    ], env, folder)
    if identity != "iam_database|iam_schema_export_reader|iam_schema_export_reader":
        raise Blocked("AUTHENTICATED_IDENTITY_INCORRECT")

    privileges = run_pg([
        "psql", "-X", "-w", "-A", "-t", "-v", "ON_ERROR_STOP=1",
        "-c", """WITH t AS (
          SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')
        ), s AS (
          SELECT oid FROM pg_namespace WHERE nspname IN ('iam','audit','app_private')
        ) SELECT
          (SELECT count(*) FROM t),
          (SELECT count(*) FROM t WHERE has_table_privilege(current_user,oid,'SELECT')),
          (SELECT count(*) FROM t WHERE has_table_privilege(current_user,oid,'MAINTAIN')),
          (SELECT count(*) FROM s WHERE has_schema_privilege(current_user,oid,'USAGE')),
          (SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user)""",
    ], env, folder)
    if privileges != "23|0|0|0|f":
        raise Blocked("UNEXPECTED_GRANTS_OR_SCHEMA_DRIFT")
    print("PASS_AUTHENTICATED_LEASE_IDENTITY_AND_ZERO_PRIVILEGES")

    # Actual PG18 command: no table data, no remote DDL, no new permissions.
    archive = folder / "schema-only.dump"
    run_pg([
        "pg_dump", "-w", "--schema-only", "--format=custom",
        "--schema=iam", "--schema=audit", "--schema=app_private",
        "--lock-wait-timeout=5s", "--file=/work/schema-only.dump",
    ], env, folder)
    if not archive.is_file() or archive.stat().st_size < 2048:
        raise Blocked("SCHEMA_ARCHIVE_MISSING_OR_TOO_SMALL")
    if not archive.read_bytes()[:5] == b"PGDMP":
        raise Blocked("SCHEMA_ARCHIVE_HEADER_INVALID")
    toc = run_pg(["pg_restore", "--list", "/work/schema-only.dump"], env, folder)
    if any("TABLE DATA " in line or "BLOB " in line for line in toc.splitlines()):
        raise Blocked("ARCHIVE_CONTAINS_DATA")
    if not any(re.search(r"\bTABLE\b", line) for line in toc.splitlines()):
        raise Blocked("SCHEMA_ARCHIVE_TOC_INCOMPLETE")
    return {
        "archive_bytes": archive.stat().st_size,
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "toc_entries": sum(bool(re.match(r"\d+;", line)) for line in toc.splitlines()),
    }


def main() -> int:
    os.umask(0o077)
    try:
        env = validate_url(os.environ.get("IAM_EXPORT_LEASE_DATABASE_URL", ""))
        with tempfile.TemporaryDirectory(prefix="iam-lease-pg18-") as tmp:
            result = run_probe(env, Path(tmp))
        print("PASS_AUTHENTICATED_PG18_SCHEMA_ONLY_DUMP")
        print(f"SCHEMA_DUMP_SHA256={result['sha256']}")
        print(f"SCHEMA_DUMP_BYTES={result['archive_bytes']}")
        print(f"SCHEMA_TOC_ENTRIES={result['toc_entries']}")
        print("NO_DATA_EXPORTED_OR_ARTIFACT_UPLOADED; NO_DDL; NO_GRANTS")
        return 0
    except Blocked as exc:
        print(f"BLOCKED_IAM_G1_SCHEMA_ONLY_PROBE: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
