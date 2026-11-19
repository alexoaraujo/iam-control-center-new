#!/usr/bin/env python3
"""G1 PostgreSQL 18 full custom archive -> streaming AES-256-GCM -> B2.

Manual main-only operation. Never writes an unencrypted archive to disk.
No SQL writes, no restore, no B2 read/delete. Full recovery is NOT attested.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from urllib.parse import unquote, urlsplit
import urllib.error
import urllib.request

REPO = "alexoaraujo/iam-control-center-new"
ENVIRONMENT = "IAM-G1-Full-Backup-Custody"
BUCKET = "iam-control-center-g1-backups"
PREFIX = "iam-g1/full-backups/"
ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
REGION = "us-east-005"
IMAGE = "iam-pg18-system-ca:local"
MAGIC = b"IAMG1A1!"  # 8-byte format marker, then 12-byte nonce, then ciphertext, then 16-byte GCM tag
CHUNK = 1024 * 1024
MAX_CIPHERTEXT_BYTES = 2 * 1024 * 1024 * 1024
ALLOWED_WRITER_CAPABILITIES = frozenset({"writeFiles", "listBuckets"})
CONFIRMATION = "EXPORT_ENCRYPT_UPLOAD_G1_FULL_BACKUP"

class Blocked(RuntimeError):
    """Fixed messages only; never log any secret, URL, B2 response or row."""

def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise Blocked("BLOCKED_G1_WRITER_DEPENDENCY")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def _recovery_guard():
    return _load(Path(__file__).resolve().parents[1] /
                 "database/scripts/iam-g1-full-recovery-preflight.py", "g1_preflight")

def attest_github_environment(env: dict[str, str]) -> str:
    # Reuse the tested GitHub Environment policy reader, including HTTP 401/403/404
    # fail-closed classification and exact-main-only branch policy enforcement.
    reader = _load(Path(__file__).with_name("iam-g1-b2-full-readback.py"), "g1_reader")
    reader.ENVIRONMENT = ENVIRONMENT
    return reader.attest_environment(env)

def check_scope(env: dict[str, str], now: datetime | None = None) -> tuple[bytes, str]:
    guard = _recovery_guard()
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current >= guard.TARGET_EXPIRY - guard.MIN_TARGET_HEADROOM:
        raise Blocked("BLOCKED_G1_WRITER_TARGET_RECOVERY_WINDOW")
    if env.get("GITHUB_REPOSITORY") != REPO or env.get("GITHUB_REF") != "refs/heads/main":
        raise Blocked("BLOCKED_G1_WRITER_UNTRUSTED_REF")
    sha = env.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or env.get("IAM_G1_FULL_BACKUP_APPROVED_SHA") != sha:
        raise Blocked("BLOCKED_G1_WRITER_UNAPPROVED_SHA")
    if env.get("IAM_G1_FULL_BACKUP_CONFIRMATION") != CONFIRMATION:
        raise Blocked("BLOCKED_G1_WRITER_EXPLICIT_CONFIRMATION")
    if (env.get("IAM_G1_B2_BUCKET") != BUCKET or
            env.get("IAM_G1_B2_ENDPOINT") != ENDPOINT or
            env.get("IAM_G1_B2_REGION") != REGION or
            env.get("IAM_G1_B2_OBJECT_PREFIX") != PREFIX):
        raise Blocked("BLOCKED_G1_WRITER_UNAPPROVED_B2_DESTINATION")
    if env.get("IAM_G1_ENCRYPTION_KEY_ESCROW_ATTESTATION") != "PRIVATE_ESCROW_CONFIRMED":
        raise Blocked("BLOCKED_G1_WRITER_ESCROW_NOT_ATTESTED")
    try:
        guard.validate_url(env.get("IAM_G1_FULL_BACKUP_SOURCE_URL", ""), guard.SOURCE_HOST, guard.SOURCE_DB)
    except guard.Blocked:
        raise Blocked("BLOCKED_G1_WRITER_UNAPPROVED_SOURCE_OR_TLS") from None
    if not env.get("AWS_ACCESS_KEY_ID") or not env.get("AWS_SECRET_ACCESS_KEY"):
        raise Blocked("BLOCKED_G1_WRITER_B2_CREDENTIALS_MISSING")
    try:
        key = base64.b64decode(env.get("IAM_G1_AES256_GCM_KEY_B64", ""), validate=True)
    except (ValueError, base64.binascii.Error):
        raise Blocked("BLOCKED_G1_WRITER_AES_KEY_INVALID") from None
    if len(key) != 32:
        raise Blocked("BLOCKED_G1_WRITER_AES_KEY_NOT_256_BIT")
    if not re.fullmatch(r"[0-9]+", env.get("GITHUB_RUN_ID", "")):
        raise Blocked("BLOCKED_G1_WRITER_RUN_ID")
    return key, sha

def verify_native_writer_scope(payload: dict) -> None:
    api = payload.get("apiInfo") if isinstance(payload, dict) else None
    storage = api.get("storageApi") if isinstance(api, dict) else None
    allowed = storage.get("allowed") if isinstance(storage, dict) else None
    if not isinstance(allowed, dict) or allowed.get("namePrefix") != PREFIX:
        raise Blocked("BLOCKED_G1_WRITER_NATIVE_PREFIX")
    buckets = allowed.get("buckets")
    if (not isinstance(buckets, list) or len(buckets) != 1 or
            not isinstance(buckets[0], dict) or buckets[0].get("name") != BUCKET or
            not isinstance(buckets[0].get("id"), str) or not buckets[0]["id"]):
        raise Blocked("BLOCKED_G1_WRITER_NATIVE_BUCKET")
    caps = allowed.get("capabilities")
    if (not isinstance(caps, list) or not all(isinstance(c, str) for c in caps) or
            len(caps) != len(set(caps)) or "writeFiles" not in caps or
            not set(caps).issubset(ALLOWED_WRITER_CAPABILITIES)):
        raise Blocked("BLOCKED_G1_WRITER_NATIVE_OVERPRIVILEGED")

def attest_native_writer_key(env: dict[str, str]) -> None:
    pair = (env["AWS_ACCESS_KEY_ID"] + ":" + env["AWS_SECRET_ACCESS_KEY"]).encode()
    req = urllib.request.Request(
        "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
        headers={"Authorization": "Basic " + base64.b64encode(pair).decode(),
                 "Accept": "application/json", "User-Agent": "iam-g1-b2-full-writer"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.status != 200:
                raise Blocked("BLOCKED_G1_WRITER_B2_NATIVE_AUTH")
            payload = json.loads(response.read(524288).decode())
    except (urllib.error.URLError, ValueError, UnicodeError):
        raise Blocked("BLOCKED_G1_WRITER_B2_NATIVE_AUTH") from None
    verify_native_writer_scope(payload)

def object_key(sha: str, run_id: str, current: datetime | None = None) -> str:
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not re.fullmatch(r"[0-9]+", run_id):
        raise Blocked("BLOCKED_G1_WRITER_OBJECT_ID")
    stamp = (current or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"{PREFIX}{sha}/{stamp}-{run_id}.pgdump.aesgcm"

def encrypt_stream(source, target, key: bytes, sha: str) -> tuple[int, int, str]:
    """Authenticate ciphertext to exact producing SHA; never save raw data."""
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    if len(key) != 32 or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise Blocked("BLOCKED_G1_WRITER_ENCRYPTION_CONTEXT")
    nonce = os.urandom(12)
    cipher = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    cipher.authenticate_additional_data(MAGIC + sha.encode("ascii"))
    hasher = hashlib.sha256()
    header = MAGIC + nonce
    target.write(header)
    hasher.update(header)
    total = len(header)
    plaintext = 0
    first_bytes = bytearray()
    while True:
        chunk = source.read(CHUNK)
        if not chunk:
            break
        if not isinstance(chunk, bytes):
            raise Blocked("BLOCKED_G1_WRITER_PGDUMP_STREAM")
        if len(first_bytes) < 5:
            first_bytes.extend(chunk[:5 - len(first_bytes)])
        plaintext += len(chunk)
        if plaintext > MAX_CIPHERTEXT_BYTES - 36:
            raise Blocked("BLOCKED_G1_WRITER_SIZE_LIMIT")
        encrypted = cipher.update(chunk)
        target.write(encrypted)
        hasher.update(encrypted)
        total += len(encrypted)
    if bytes(first_bytes) != b"PGDMP" or plaintext < 256:
        raise Blocked("BLOCKED_G1_WRITER_INVALID_CUSTOM_ARCHIVE")
    final = cipher.finalize()
    tag = cipher.tag
    target.write(final + tag)
    hasher.update(final + tag)
    total += len(final) + len(tag)
    if not 256 <= total <= MAX_CIPHERTEXT_BYTES:
        raise Blocked("BLOCKED_G1_WRITER_INVALID_CIPHERTEXT_SIZE")
    return plaintext, total, hasher.hexdigest()

def export_and_encrypt(env: dict[str, str], dest, key: bytes, sha: str) -> tuple[int, int, str]:
    src = urlsplit(env["IAM_G1_FULL_BACKUP_SOURCE_URL"])
    guard = _recovery_guard()
    postgres_env = os.environ.copy()
    postgres_env.update({
        "PGHOST": guard.SOURCE_HOST, "PGPORT": "5432", "PGDATABASE": guard.SOURCE_DB,
        "PGUSER": "neondb_owner", "PGPASSWORD": unquote(src.password or ""),
        "PGSSLMODE": "verify-full", "PGSSLROOTCERT": "system",
        "PGCONNECT_TIMEOUT": "15", "PGOPTIONS": "-c statement_timeout=900000 -c lock_timeout=10000",
    })
    # Secrets inherited by variable NAME, never placed on a command line or in logs.
    docker_args = [
        "docker", "run", "--rm", "--network", "host", "--read-only",
        "--cap-drop=ALL", "--security-opt=no-new-privileges",
        "--env", "PGHOST", "--env", "PGPORT", "--env", "PGDATABASE",
        "--env", "PGUSER", "--env", "PGPASSWORD", "--env", "PGSSLMODE",
        "--env", "PGSSLROOTCERT", "--env", "PGCONNECT_TIMEOUT", "--env", "PGOPTIONS",
        IMAGE, "pg_dump", "--format=custom", "--no-password",
        "--serializable-deferrable", "--dbname=iam_database",
    ]
    # Independently authenticate the actual PostgreSQL login/DB/major version
    # before any full-data export. Only fixed SQL and sanitized comparison.
    container_prefix = docker_args[:docker_args.index(IMAGE) + 1]
    try:
        identity = subprocess.run(
            container_prefix + [
                "psql", "-X", "-w", "-A", "-t", "-q", "-c",
                "SELECT current_database() || '|' || current_user || '|' || "
                "current_setting('server_version_num')"
            ], env=postgres_env, stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL, timeout=45, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("BLOCKED_G1_WRITER_PG18_IDENTITY_PROBE_RUNTIME") from None
    if identity.returncode != 0 or not re.fullmatch(
            rb"iam_database\|neondb_owner\|18[0-9]{4}\s*", identity.stdout):
        raise Blocked("BLOCKED_G1_WRITER_PG18_SOURCE_IDENTITY_OR_VERSION")
    proc = subprocess.Popen(docker_args, env=postgres_env,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        if proc.stdout is None:
            raise Blocked("BLOCKED_G1_WRITER_PROCESS_PIPE")
        lengths = encrypt_stream(proc.stdout, dest, key, sha)
        if proc.wait(timeout=900) != 0:
            raise Blocked("BLOCKED_G1_WRITER_PGDUMP_FAILED")
        return lengths
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("BLOCKED_G1_WRITER_PGDUMP_RUNTIME") from None
    finally:
        if proc.stdout:
            proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=15)

def upload_ciphertext(env: dict[str, str], key: str, filename: Path, digest: str, size: int) -> None:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
    client = boto3.client(
        "s3", endpoint_url=ENDPOINT, region_name=REGION,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                      connect_timeout=10, read_timeout=90, retries={"total_max_attempts": 1}),
    )
    try:
        with filename.open("rb") as ciphertext:
            client.put_object(
                Bucket=BUCKET, Key=key, Body=ciphertext, ContentLength=size,
                ContentType="application/octet-stream",
                Metadata={"sha256": digest, "classification": "iam-g1-full-backup-encrypted",
                          "pg-version": "18", "archive-format": "pg-dump-custom",
                          "cipher": "aes256gcm"},
            )
    except ClientError as error:
        code = error.response.get("Error", {}).get("Code", "UNKNOWN")
        safe = code if isinstance(code, str) and code.isalnum() else "UNKNOWN"
        raise Blocked("BLOCKED_G1_WRITER_S3_" + safe) from None
    except (BotoCoreError, OSError):
        raise Blocked("BLOCKED_G1_WRITER_S3_TRANSPORT") from None

def execute(env: dict[str, str]) -> dict:
    key_material, sha = check_scope(env)
    mode = attest_github_environment(env)
    attest_native_writer_key(env)
    object_name = object_key(sha, env["GITHUB_RUN_ID"])
    temp_dir = Path(env.get("RUNNER_TEMP", "/tmp"))
    temp_dir.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    with tempfile.NamedTemporaryFile(mode="wb", prefix="iam-g1-", suffix=".aesgcm",
                                     dir=temp_dir, delete=False) as handle:
        filename = Path(handle.name)
    try:
        with filename.open("wb") as output:
            plain_length, cipher_length, digest = export_and_encrypt(env, output, key_material, sha)
        if filename.stat().st_size != cipher_length:
            raise Blocked("BLOCKED_G1_WRITER_LOCAL_CIPHERTEXT_LENGTH")
        upload_ciphertext(env, object_name, filename, digest, cipher_length)
    finally:
        filename.unlink(missing_ok=True)
    return {
        "schema_version": 1, "repository": REPO, "git_sha": sha,
        "github_run_id": env["GITHUB_RUN_ID"], "source_branch": "br-ancient-term-b6mmx5ol",
        "source_database": "iam_database", "pg_major": 18, "pg_dump_format": "custom",
        "cipher": "aes256gcm", "ciphertext_format": "IAMG1A1!",
        "aad": "IAMG1A1! + 40-byte git_sha", "bucket": BUCKET,
        "object_key": object_name, "ciphertext_sha256": digest,
        "ciphertext_size_bytes": cipher_length, "plaintext_bytes_NOT_A_HASH": plain_length,
        "environment_review_mode": mode,
        "decrypt_verified": False, "independent_readback_verified": False,
        "pg_restore_verified": False, "full_recovery_attested": False,
    }

def main() -> int:
    try:
        if sys.argv[1:] == ["--attest-env"]:
            mode = attest_github_environment(dict(os.environ))
            print("PASS_G1_WRITER_ENVIRONMENT_MAIN_ONLY reviewer_mode=" + mode)
            print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")
        elif sys.argv[1:] == ["--check"]:
            check_scope(dict(os.environ))
            print("PASS_G1_WRITER_LOCAL_SCOPE_AND_AES_KEY_ONLY")
            print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")
        elif sys.argv[1:] == ["--execute"]:
            manifest = execute(dict(os.environ))
            summary = json.dumps(manifest, separators=(",", ":"), sort_keys=True)
            print("PASS_G1_FULL_PGDUMP_ENCRYPTED_B2_UPLOAD")
            print("G1_WRITER_MANIFEST_JSON=" + summary)
            if os.environ.get("GITHUB_STEP_SUMMARY"):
                with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf8") as stream:
                    stream.write("### G1 encrypted full backup — WRITER only\n")
                    stream.write("Backup ciphertext uploaded; independent readback, decryption, restore and rollback NOT tested.\n")
                    stream.write("Non-sensitive writer manifest: " + summary + "\n")
            print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")
        else:
            print("Usage: iam-g1-b2-full-backup-writer.py --attest-env|--check|--execute", file=sys.stderr)
            return 2
    except Blocked as error:
        print(str(error), file=sys.stderr)
        return 2
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
