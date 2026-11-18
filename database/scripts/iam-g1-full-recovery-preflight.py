#!/usr/bin/env python3
"""G1 full-backup/restore *preflight only*: exact URLs, SHA and scope; no I/O."""
from __future__ import annotations

import os
import re
import sys
from datetime import datetime, timezone
from urllib.parse import parse_qs, unquote, urlsplit

REPOSITORY = "alexoaraujo/iam-control-center-new"
PROJECT_ID = "tiny-rice-70320263"
SOURCE_BRANCH = "br-ancient-term-b6mmx5ol"
TARGET_BRANCH = "br-sweet-union-b6j80a7j"
SOURCE_HOST = "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"
TARGET_HOST = "ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech"
SOURCE_DB = "iam_database"
TARGET_DB = "iam_canonical_validation"
TARGET_EXPIRY = datetime(2026, 11, 20, 9, 12, tzinfo=timezone.utc)
B2_BUCKET = "iam-control-center-g1-backups"
B2_ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
B2_REGION = "us-east-005"
B2_PREFIX = "iam-g1/full-backups/"


class Blocked(ValueError):
    """Fail closed; messages must never include a supplied connection URL."""


def validate_url(raw: str, host: str, database: str) -> None:
    if not isinstance(raw, str) or not raw or raw != raw.strip():
        raise Blocked("BLOCKED_G1_MISSING_OR_PADDED_URL")
    if any(char in raw for char in "\r\n\x00\t'\" "):
        raise Blocked("BLOCKED_G1_CONTROL_OR_QUOTING")
    try:
        uri = urlsplit(raw)
        username = unquote(uri.username or "")
        password = unquote(uri.password or "")
        port = uri.port or 5432
        params = parse_qs(uri.query, keep_blank_values=True, strict_parsing=True)
    except (ValueError, UnicodeError) as exc:
        raise Blocked("BLOCKED_G1_URI_MALFORMED") from exc
    if uri.scheme != "postgresql" or uri.hostname != host or port != 5432:
        raise Blocked("BLOCKED_G1_ENDPOINT_NOT_APPROVED")
    if uri.fragment or "pooler" in (uri.hostname or "") or uri.path != "/" + database:
        raise Blocked("BLOCKED_G1_DIRECT_DATABASE_REQUIRED")
    if username != "neondb_owner" or not password:
        raise Blocked("BLOCKED_G1_EXCLUSIVE_OWNER_CREDENTIAL_REQUIRED")
    if any(c in password for c in "\r\n\x00"):
        raise Blocked("BLOCKED_G1_CREDENTIAL_CONTROL")
    if set(params) not in ({"sslmode", "sslrootcert"}, {"sslmode", "sslrootcert", "channel_binding"}):
        raise Blocked("BLOCKED_G1_UNAPPROVED_URL_PARAMETERS")
    if params.get("sslmode") != ["verify-full"] or params.get("sslrootcert") != ["system"]:
        raise Blocked("BLOCKED_G1_TLS_VERIFY_FULL_REQUIRED")
    if "channel_binding" in params and params["channel_binding"] != ["require"]:
        raise Blocked("BLOCKED_G1_CHANNEL_BINDING")


def validate_scope(config: dict[str, str], now: datetime | None = None) -> None:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        raise Blocked("BLOCKED_G1_NAIVE_CLOCK")
    if current >= TARGET_EXPIRY:
        raise Blocked("BLOCKED_G1_TARGET_TTL_EXPIRED")
    if config.get("GITHUB_REPOSITORY") != REPOSITORY or config.get("GITHUB_REF") != "refs/heads/main":
        raise Blocked("BLOCKED_G1_NOT_TRUSTED_MAIN")
    sha = config.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or sha != config.get("IAM_G1_RECOVERY_APPROVED_SHA", ""):
        raise Blocked("BLOCKED_G1_SHA_NOT_APPROVED")
    if config.get("IAM_G1_B2_BUCKET") != B2_BUCKET or config.get("IAM_G1_B2_ENDPOINT") != B2_ENDPOINT:
        raise Blocked("BLOCKED_G1_B2_SCOPE")
    if config.get("IAM_G1_B2_REGION") != B2_REGION:
        raise Blocked("BLOCKED_G1_B2_REGION")
    if config.get("IAM_G1_B2_OBJECT_PREFIX") != B2_PREFIX:
        raise Blocked("BLOCKED_G1_OBJECT_PREFIX")
    validate_url(config.get("IAM_G1_FULL_BACKUP_SOURCE_URL", ""), SOURCE_HOST, SOURCE_DB)
    validate_url(config.get("IAM_G1_FULL_BACKUP_TARGET_URL", ""), TARGET_HOST, TARGET_DB)


def main() -> int:
    if sys.argv[1:] != ["--check"]:
        print("Usage: iam-g1-full-recovery-preflight.py --check", file=sys.stderr)
        return 2
    try:
        validate_scope(dict(os.environ))
    except Blocked as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print("PASS_G1_SOURCE_TARGET_B2_URL_ALLOWLIST_ONLY")
    print("NOT_EXECUTED: no network, SQL, export, encryption, B2 upload/readback, restore or rollback")
    print("G1_FULL_BACKUP_RESTORE=BLOCKED_PENDING_REAL_OPERATION")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
