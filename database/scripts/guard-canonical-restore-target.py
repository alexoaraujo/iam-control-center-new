#!/usr/bin/env python3
"""Fail-closed identity/TLS guard; no network, SQL, migration or secrets logged."""
from __future__ import annotations
import os
import sys
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlparse

# Independently verified against the user's authorized Neon organization on 2026-11-13.
# SOURCE is development in org alexoaraujo; legacy cross-org projects are forbidden.
# Do not replace with caller-controlled production/project variables.
SOURCE_HOST = "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"
TARGET_HOST = "ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech"
SOURCE_DATABASE = "iam_database"
TARGET_DATABASE = "iam_canonical_validation"
SOURCE_ROLE = "iam_schema_export_reader"
TARGET_ROLE = "neondb_owner"
EXPECTED_SOURCE_BRANCH = "br-ancient-term-b6mmx5ol"
EXPECTED_TARGET_BRANCH = "br-sweet-union-b6j80a7j"
EXPECTED_SOURCE_PROJECT = "tiny-rice-70320263"
EXPECTED_TARGET_PROJECT = "tiny-rice-70320263"

class GateBlocked(ValueError):
    """Inputs fail the independently reviewed allowlist."""

@dataclass(frozen=True)
class ConnectionIdentity:
    hostname: str
    database: str
    username: str

def parse_approved_url(raw: str, *, host: str, database: str, role: str) -> ConnectionIdentity:
    if not raw:
        raise GateBlocked("missing secret connection URL")
    if any(c in raw for c in "\r\n\x00"):
        raise GateBlocked("connection URL contains forbidden control characters")
    try:
        url = urlparse(raw)
        port = url.port or 5432
        username = unquote(url.username or "")
        password = unquote(url.password or "")
        db = unquote(url.path.lstrip("/"))
        params = parse_qs(url.query, keep_blank_values=True, strict_parsing=True)
    except (ValueError, UnicodeError) as exc:
        raise GateBlocked("malformed connection URL") from exc
    if url.scheme not in ("postgres", "postgresql"):
        raise GateBlocked("Postgres connection scheme required")
    if url.fragment or url.params or url.hostname != host or port != 5432:
        raise GateBlocked("endpoint/port differs from Neon control-plane allowlist")
    if "pooler" in (url.hostname or ""):
        raise GateBlocked("direct non-pooled Neon endpoint is required")
    if db != database or username != role or not password:
        raise GateBlocked("database, dedicated role, or password requirement failed")
    if any(c in username + password for c in "\r\n\x00"):
        raise GateBlocked("credential contains forbidden control characters")
    if set(params) != {"sslmode", "sslrootcert"}:
        raise GateBlocked("only reviewed TLS connection parameters are allowed")
    if params.get("sslmode") != ["verify-full"] or params.get("sslrootcert") != ["system"]:
        raise GateBlocked("full TLS identity and CA verification required")
    return ConnectionIdentity(url.hostname, db, username)

def verify_connections(source: str, target: str) -> tuple[ConnectionIdentity, ConnectionIdentity]:
    approved_source = parse_approved_url(source, host=SOURCE_HOST, database=SOURCE_DATABASE, role=SOURCE_ROLE)
    approved_target = parse_approved_url(target, host=TARGET_HOST, database=TARGET_DATABASE, role=TARGET_ROLE)
    if approved_source == approved_target:
        raise GateBlocked("source and target must be different")
    return approved_source, approved_target

def main() -> int:
    try:
        verify_connections(os.environ.get("IAM_CANONICAL_SOURCE_URL", ""),
                           os.environ.get("IAM_CANONICAL_TARGET_URL", ""))
    except GateBlocked as exc:
        print(f"BLOCKED_CANONICAL_TARGET: {exc}", file=sys.stderr)
        return 2
    print("PASS_URL_ALLOWLIST_ONLY: source/target, roles and TLS parameters validated; no SQL executed")
    print("REVIEW_REQUIRED: independently recheck Neon project/branch-to-host mapping and approve restore")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
