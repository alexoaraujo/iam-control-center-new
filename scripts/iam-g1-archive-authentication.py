#!/usr/bin/env python3
"""OFFLINE G1 AES-GCM envelope verifier; NO B2, SQL, network, actual secrets or restore.

The genuine encrypted archive remains untouched. A future trusted-main restore
runner requires its own review and protected credentials.
"""
from __future__ import annotations

import hashlib
import hmac
import re
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAGIC = b"IAMG1A1!"
NONCE_BYTES = 12
TAG_BYTES = 16
MAX_OFFLINE_CIPHERTEXT_BYTES = 64 * 1024 * 1024
SOURCE_SHA = "0ee3e512bb761ce4d81202eb77a48a1ef9c77109"
WRITER_RUN_ID = "44655204795"
APPROVED_OBJECT = (
    "iam-g1/full-backups/" + SOURCE_SHA +
    "/20261120T014019Z-" + WRITER_RUN_ID + ".pgdump.aesgcm"
)
APPROVED_SHA256 = "610d5f0ef74ec77ebe35912207856d2a4638cab462a6f9e39d9c472382083aa9"
APPROVED_SIZE = 110953


class Blocked(RuntimeError):
    """Fixed, redacted error code; never interpolate ciphertext, key or URL."""


def authenticate_envelope(
    ciphertext: bytes, key: bytes, source_sha: str,
    expected_sha256: str, expected_size: int,
) -> bytes:
    """Release plaintext only AFTER SHA256 integrity and AES-GCM tag verification.

    No file/network I/O. In-memory test fixtures only; not a live restore API.
    """
    if (not isinstance(source_sha, str) or
            re.fullmatch(r"[a-f0-9]{40}", source_sha) is None or
            not isinstance(expected_sha256, str) or
            re.fullmatch(r"[a-f0-9]{64}", expected_sha256) is None):
        raise Blocked("BLOCKED_G1_ARCHIVE_INVALID_SOURCE_OR_DIGEST")
    if not isinstance(key, bytes) or len(key) != 32:
        raise Blocked("BLOCKED_G1_ARCHIVE_INVALID_AES256_KEY")
    if (not isinstance(ciphertext, bytes) or
            not isinstance(expected_size, int) or isinstance(expected_size, bool) or
            not (len(MAGIC) + NONCE_BYTES + TAG_BYTES + 5 <= expected_size <= MAX_OFFLINE_CIPHERTEXT_BYTES) or
            len(ciphertext) != expected_size):
        raise Blocked("BLOCKED_G1_ARCHIVE_LENGTH_OR_LIMIT")
    if not ciphertext.startswith(MAGIC):
        raise Blocked("BLOCKED_G1_ARCHIVE_MAGIC")
    if not hmac.compare_digest(hashlib.sha256(ciphertext).hexdigest(), expected_sha256):
        raise Blocked("BLOCKED_G1_ARCHIVE_DIGEST")
    nonce = ciphertext[len(MAGIC):len(MAGIC) + NONCE_BYTES]
    payload = ciphertext[len(MAGIC) + NONCE_BYTES:]
    try:
        plaintext = AESGCM(key).decrypt(nonce, payload, MAGIC + source_sha.encode("ascii"))
    except (InvalidTag, ValueError):
        raise Blocked("BLOCKED_G1_ARCHIVE_AEAD_AUTHENTICATION") from None
    if not plaintext.startswith(b"PGDMP") or len(plaintext) < 256:
        raise Blocked("BLOCKED_G1_ARCHIVE_NOT_PG18_CUSTOM_FORMAT")
    return plaintext


def approved_identity(source_sha: str, object_key: str, digest: str, size: int) -> None:
    if (source_sha != SOURCE_SHA or object_key != APPROVED_OBJECT or
            digest != APPROVED_SHA256 or size != APPROVED_SIZE):
        raise Blocked("BLOCKED_G1_ARCHIVE_UNAPPROVED_WRITER_MANIFEST")


def main() -> int:
    # No option exists to supply actual B2 objects or cryptographic secrets.
    print("G1_ARCHIVE_AUTHENTICATION=OFFLINE_LIBRARY_ONLY")
    print("G1_ARCHIVE_AEAD_AUTHENTICATION=NOT_ATTESTED_ON_REAL_BACKUP")
    print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
