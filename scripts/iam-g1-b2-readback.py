#!/usr/bin/env python3
"""IAM-G1: independently verify a fixed B2 synthetic ciphertext by SHA-256.

This program cannot decrypt or restore a database. Never print object bytes.
"""
import hashlib
import io
import os
import sys

BUCKET = "iam-control-center-g1-backups"
REGION = "us-east-005"
ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
OBJECT_KEY = "iam-g1/probes/20261117T002204Z-43987013885.aesgcm"
EXPECTED_SHA256 = "fe9a991b063bd0241bab475c2710389c618fb92f654ed97e1444c9e8bda16f27"
MAX_BYTES = 1024 * 1024
CHUNK_BYTES = 64 * 1024


class VerificationError(Exception):
    pass


def verify_readback(response, expected_sha256=EXPECTED_SHA256):
    """Hash the entire bounded body and check S3 metadata; no plaintext access."""
    try:
        length = int(response.get("ContentLength", -1))
    except (TypeError, ValueError) as exc:
        raise VerificationError("BLOCKED_B2_READBACK_INVALID_LENGTH") from exc
    if not 28 <= length <= MAX_BYTES:
        raise VerificationError("BLOCKED_B2_READBACK_INVALID_LENGTH")
    metadata = response.get("Metadata", {})
    if not isinstance(metadata, dict) or metadata.get("sha256", "").lower() != expected_sha256:
        raise VerificationError("BLOCKED_B2_READBACK_METADATA_HASH")
    if metadata.get("classification") != "synthetic-encrypted-probe":
        raise VerificationError("BLOCKED_B2_READBACK_CLASSIFICATION")
    stream = response["Body"]
    hasher = hashlib.sha256()
    bytes_read = 0
    try:
        while True:
            chunk = stream.read(CHUNK_BYTES)
            if not chunk:
                break
            bytes_read += len(chunk)
            if bytes_read > length or bytes_read > MAX_BYTES:
                raise VerificationError("BLOCKED_B2_READBACK_SIZE_MISMATCH")
            hasher.update(chunk)
    finally:
        if hasattr(stream, "close"):
            stream.close()
    if bytes_read != length:
        raise VerificationError("BLOCKED_B2_READBACK_SIZE_MISMATCH")
    if hasher.hexdigest() != expected_sha256:
        raise VerificationError("BLOCKED_B2_READBACK_SHA256_MISMATCH")
    return bytes_read


def self_test():
    """No network, credentials, SDK or external data used."""
    payload = b"synthetic-ciphertext-only-for-test" * 4
    digest = hashlib.sha256(payload).hexdigest()

    def fixture(data=payload, **overrides):
        response = {
            "ContentLength": len(payload),
            "Metadata": {"sha256": digest, "classification": "synthetic-encrypted-probe"},
            "Body": io.BytesIO(data),
        }
        response.update(overrides)
        return response

    assert verify_readback(fixture(), digest) == len(payload)
    tests = [
        (fixture(data=payload[:-1]), "BLOCKED_B2_READBACK_SIZE_MISMATCH"),
        (fixture(data=b"?" + payload[1:]), "BLOCKED_B2_READBACK_SHA256_MISMATCH"),
        (fixture(Metadata={"sha256": "0" * 64, "classification": "synthetic-encrypted-probe"}), "BLOCKED_B2_READBACK_METADATA_HASH"),
        (fixture(Metadata={"sha256": digest}), "BLOCKED_B2_READBACK_CLASSIFICATION"),
        (fixture(ContentLength=MAX_BYTES + 1), "BLOCKED_B2_READBACK_INVALID_LENGTH"),
        (fixture(ContentLength=0), "BLOCKED_B2_READBACK_INVALID_LENGTH"),
    ]
    for response, expected in tests:
        try:
            verify_readback(response, digest)
        except VerificationError as exc:
            assert str(exc) == expected, (str(exc), expected)
        else:
            raise AssertionError(f"Expected verification failure: {expected}")
    print("PASS_B2_READBACK_OFFLINE_REGRESSION")


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        self_test()
        return
    if len(sys.argv) != 1:
        raise SystemExit("Usage: iam-g1-b2-readback.py [--self-test]")

    access = os.environ.get("AWS_ACCESS_KEY_ID")
    secret = os.environ.get("AWS_SECRET_ACCESS_KEY")
    if not access or not secret:
        raise SystemExit("::error::BLOCKED_B2_READ_ONLY_SECRETS_MISSING")

    import boto3
    from botocore.config import Config
    from botocore.exceptions import (BotoCoreError, ClientError)

    client = boto3.client(
        "s3", endpoint_url=ENDPOINT, region_name=REGION,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                      connect_timeout=10, read_timeout=20, retries={"total_max_attempts": 1}),
    )
    try:
        result = client.get_object(Bucket=BUCKET, Key=OBJECT_KEY)
        size = verify_readback(result)
    except ClientError as exc:
        error_code = exc.response.get("Error", {}).get("Code", "UNKNOWN")
        # Preserve only an allowlisted error code; do not log raw HTTP response.
        if not isinstance(error_code, str) or not error_code.isalnum():
            error_code = "UNKNOWN"
        raise SystemExit(f"::error::BLOCKED_B2_READBACK_S3: {error_code}") from None
    except BotoCoreError:
        raise SystemExit("::error::BLOCKED_B2_READBACK_TRANSPORT") from None
    except VerificationError as exc:
        raise SystemExit(f"::error::{exc}") from None
    print("PASS_B2_INDEPENDENT_READBACK_CIPHERTEXT_SHA256")
    print(f"object_key={OBJECT_KEY}")
    print(f"ciphertext_sha256={EXPECTED_SHA256}")
    print(f"size_bytes={size}")
    print("DECRYPTION_NOT_TESTED: encryption key was ephemeral and not preserved")
    print("RESTORE_NOT_TESTED")
    print("G1_FULL_BACKUP_OWNER_APPROVED=BLOCKED")


if __name__ == "__main__":
    main()
