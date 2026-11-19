#!/usr/bin/env python3
"""G1 manual, ciphertext-only B2 full-backup readback. No backup, SQL or decryption."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

REPO = "alexoaraujo/iam-control-center-new"
ENVIRONMENT = "IAM-G1-B2-Full-Readback-Custody"
BUCKET = "iam-control-center-g1-backups"
ENDPOINT = "https://s3.us-east-005.backblazeb2.com"
REGION = "us-east-005"
PREFIX = "iam-g1/full-backups/"
# These are metadata-only capabilities; every mutation or cross-bucket grant
# fails. A B2 Native v4 authorization response proves effective permissions.
READ_CAPABILITIES = frozenset({
    "readFiles", "listFiles", "listBuckets", "readBuckets", "readBucketEncryption",
})
# Existing and confirmed synthetic object: an independently scoped full-backup
# reader must NOT be able to inspect even its metadata.
NEGATIVE_PROBE = "iam-g1/probes/20261117T002204Z-43987013885.aesgcm"
MAX_BYTES = 2 * 1024 * 1024 * 1024
CHUNK_BYTES = 1024 * 1024
KEY_PATTERN = re.compile(
    r"iam-g1/full-backups/([a-f0-9]{40})/([0-9]{8}T[0-9]{6}Z-[0-9]+\.pgdump\.aesgcm)\Z"
)


class Blocked(RuntimeError):
    """Fail-closed with messages containing no credentials, URLs or object data."""


def verify_environment(environment: dict, branches: dict, custom: dict) -> str:
    if environment.get("name") != ENVIRONMENT:
        raise Blocked("BLOCKED_G1_FULL_B2_ENVIRONMENT_NAME")
    if environment.get("can_admins_bypass") is not False:
        raise Blocked("BLOCKED_G1_FULL_B2_ADMIN_BYPASS")
    policy = environment.get("deployment_branch_policy") or {}
    if policy.get("protected_branches") is not False or policy.get("custom_branch_policies") is not True:
        raise Blocked("BLOCKED_G1_FULL_B2_BRANCH_SELECTION")
    listed = branches.get("branch_policies")
    if (branches.get("total_count") != 1 or not isinstance(listed, list)
            or len(listed) != 1 or listed[0].get("name") != "main"
            or listed[0].get("type") != "branch"):
        raise Blocked("BLOCKED_G1_FULL_B2_MAIN_ONLY")
    extra = custom.get("custom_deployment_protection_rules")
    if custom.get("total_count") != 0 or not isinstance(extra, list) or extra:
        raise Blocked("BLOCKED_G1_FULL_B2_CUSTOM_RULES")
    rules = environment.get("protection_rules")
    if not isinstance(rules, list) or any(
        not isinstance(r, dict) or r.get("type") not in
        {"branch_policy", "required_reviewers", "wait_timer"} for r in rules
    ):
        raise Blocked("BLOCKED_G1_FULL_B2_RULES_UNKNOWN")
    reviewers = [r for r in rules if r["type"] == "required_reviewers"]
    if len(reviewers) > 1:
        raise Blocked("BLOCKED_G1_FULL_B2_REVIEWERS_DUPLICATED")
    if reviewers:
        rule = reviewers[0]
        identities = rule.get("reviewers", [])
        if (rule.get("prevent_self_review") is not True or
                not isinstance(identities, list) or len(identities) != 1 or
                identities[0].get("type") != "User" or
                (identities[0].get("reviewer") or {}).get("login") != "alexoaraujo83"):
            raise Blocked("BLOCKED_G1_FULL_B2_REVIEWER_GUARD")
    if any(r.get("wait_timer") != 0 for r in rules if r["type"] == "wait_timer"):
        raise Blocked("BLOCKED_G1_FULL_B2_WAIT_TIMER")
    return "INDEPENDENT_REVIEWER" if reviewers else "SOLO_NO_REQUIRED_REVIEWER"


def _github_json(path: str, token: str) -> dict:
    if not token:
        raise Blocked("BLOCKED_G1_FULL_B2_GITHUB_READ_TOKEN")
    req = urllib.request.Request(
        f"https://api.github.com/repos/{REPO}/environments/{ENVIRONMENT}{path}",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "iam-g1-full-b2-readback",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            if response.status != 200:
                raise Blocked("BLOCKED_G1_FULL_B2_GITHUB_API")
            data = json.loads(response.read(524288).decode("utf-8"))
    except (urllib.error.URLError, ValueError, UnicodeError):
        raise Blocked("BLOCKED_G1_FULL_B2_GITHUB_API") from None
    if not isinstance(data, dict):
        raise Blocked("BLOCKED_G1_FULL_B2_GITHUB_RESPONSE")
    return data


def attest_environment(env: dict[str, str]) -> str:
    if env.get("GITHUB_REPOSITORY") != REPO or env.get("GITHUB_REF") != "refs/heads/main":
        raise Blocked("BLOCKED_G1_FULL_B2_UNTRUSTED_REPOSITORY_OR_REF")
    token = env.get("GITHUB_TOKEN", "")
    result = verify_environment(
        _github_json("", token),
        _github_json("/deployment-branch-policies?per_page=100", token),
        _github_json("/deployment_protection_rules", token),
    )
    return result


def verify_scope(env: dict[str, str]) -> tuple[str, str, int]:
    if env.get("GITHUB_REPOSITORY") != REPO or env.get("GITHUB_REF") != "refs/heads/main":
        raise Blocked("BLOCKED_G1_FULL_B2_UNTRUSTED_REPO_OR_REF")
    sha = env.get("GITHUB_SHA", "")
    if (not re.fullmatch(r"[0-9a-f]{40}", sha) or
            env.get("IAM_G1_B2_FULL_READBACK_APPROVED_GIT_SHA") != sha):
        raise Blocked("BLOCKED_G1_FULL_B2_UNAPPROVED_GITHUB_SHA")
    key = env.get("IAM_G1_B2_FULL_READBACK_APPROVED_OBJECT_KEY", "")
    match = KEY_PATTERN.fullmatch(key)
    if not match or match.group(1) != sha or not key.startswith(PREFIX):
        raise Blocked("BLOCKED_G1_FULL_B2_UNAPPROVED_PREFIX_OR_KEY")
    digest = env.get("IAM_G1_B2_FULL_READBACK_APPROVED_SHA256", "")
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        raise Blocked("BLOCKED_G1_FULL_B2_UNAPPROVED_DIGEST")
    size_raw = env.get("IAM_G1_B2_FULL_READBACK_APPROVED_SIZE_BYTES", "")
    if not re.fullmatch(r"[1-9][0-9]{0,10}", size_raw):
        raise Blocked("BLOCKED_G1_FULL_B2_UNAPPROVED_SIZE")
    size = int(size_raw)
    if size < 256 or size > MAX_BYTES:
        raise Blocked("BLOCKED_G1_FULL_B2_SIZE_OUT_OF_RANGE")
    if not env.get("AWS_ACCESS_KEY_ID") or not env.get("AWS_SECRET_ACCESS_KEY"):
        raise Blocked("BLOCKED_G1_FULL_B2_READ_ONLY_CREDENTIALS_MISSING")
    return key, digest, size


def verify_native_key_scope(payload: dict) -> None:
    """Positive proof of one bucket, exact prefix and non-mutating permissions."""
    api = payload.get("apiInfo") if isinstance(payload, dict) else None
    storage = api.get("storageApi") if isinstance(api, dict) else None
    allowed = storage.get("allowed") if isinstance(storage, dict) else None
    if not isinstance(allowed, dict):
        raise Blocked("BLOCKED_G1_FULL_B2_NATIVE_SCOPE_UNAVAILABLE")
    if allowed.get("namePrefix") != PREFIX:
        raise Blocked("BLOCKED_G1_FULL_B2_NATIVE_PREFIX_NOT_EXACT")
    buckets = allowed.get("buckets")
    if (not isinstance(buckets, list) or len(buckets) != 1 or
            not isinstance(buckets[0], dict) or
            buckets[0].get("name") != BUCKET or
            not isinstance(buckets[0].get("id"), str) or
            not buckets[0]["id"]):
        raise Blocked("BLOCKED_G1_FULL_B2_NATIVE_BUCKET_NOT_EXCLUSIVE")
    capabilities = allowed.get("capabilities")
    if (not isinstance(capabilities, list) or
            not all(isinstance(c, str) for c in capabilities) or
            len(capabilities) != len(set(capabilities)) or
            "readFiles" not in capabilities or
            not set(capabilities).issubset(READ_CAPABILITIES)):
        raise Blocked("BLOCKED_G1_FULL_B2_NATIVE_WRITE_OR_ADMIN_CAPABILITY")


def attest_native_key_scope(env: dict[str, str]) -> None:
    # Backblaze B2 Native API v4 authorizes the SAME key used by the S3 client;
    # never retain or log the response's short-lived authorizationToken.
    pair = (env["AWS_ACCESS_KEY_ID"] + ":" + env["AWS_SECRET_ACCESS_KEY"]).encode("utf-8")
    basic = base64.b64encode(pair).decode("ascii")
    request = urllib.request.Request(
        "https://api.backblazeb2.com/b2api/v4/b2_authorize_account",
        headers={
            "Authorization": "Basic " + basic,
            "Accept": "application/json",
            "User-Agent": "iam-g1-full-b2-readback",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            if response.status != 200:
                raise Blocked("BLOCKED_G1_FULL_B2_NATIVE_AUTH_RESPONSE")
            metadata = json.loads(response.read(524288).decode("utf-8"))
    except (urllib.error.URLError, ValueError, UnicodeError):
        raise Blocked("BLOCKED_G1_FULL_B2_NATIVE_AUTH_RESPONSE") from None
    verify_native_key_scope(metadata)


def verify_probe_denial(code: str) -> None:
    if code not in {"AccessDenied", "Forbidden", "403"}:
        # In particular, NotFound cannot prove that this key lacks access.
        raise Blocked("BLOCKED_G1_FULL_B2_NEGATIVE_SCOPE_UNPROVEN")


def verify_ciphertext(response: dict, expected_sha: str, expected_size: int) -> int:
    try:
        length = int(response.get("ContentLength", -1))
    except (ValueError, TypeError):
        raise Blocked("BLOCKED_G1_FULL_B2_INVALID_CONTENT_LENGTH") from None
    if length != expected_size or not 256 <= length <= MAX_BYTES:
        raise Blocked("BLOCKED_G1_FULL_B2_SIZE_MISMATCH")
    if response.get("ContentType") != "application/octet-stream":
        raise Blocked("BLOCKED_G1_FULL_B2_CONTENT_TYPE")
    metadata = response.get("Metadata")
    if (not isinstance(metadata, dict) or
            metadata.get("sha256") != expected_sha or
            metadata.get("classification") != "iam-g1-full-backup-encrypted" or
            metadata.get("pg-version") != "18" or
            metadata.get("archive-format") != "pg-dump-custom" or
            metadata.get("cipher") != "aes256gcm"):
        raise Blocked("BLOCKED_G1_FULL_B2_METADATA_MISMATCH")
    stream = response.get("Body")
    if not hasattr(stream, "read"):
        raise Blocked("BLOCKED_G1_FULL_B2_BODY_MISSING")
    length_read = 0
    hasher = hashlib.sha256()
    try:
        while True:
            chunk = stream.read(CHUNK_BYTES)
            if not chunk:
                break
            length_read += len(chunk)
            if length_read > expected_size or length_read > MAX_BYTES:
                raise Blocked("BLOCKED_G1_FULL_B2_STREAM_BOUNDS")
            hasher.update(chunk)
    finally:
        if hasattr(stream, "close"):
            stream.close()
    if length_read != expected_size:
        raise Blocked("BLOCKED_G1_FULL_B2_TRUNCATED_OBJECT")
    if hasher.hexdigest() != expected_sha:
        raise Blocked("BLOCKED_G1_FULL_B2_SHA256_MISMATCH")
    return length_read


def readback(env: dict[str, str]) -> None:
    key, digest, size = verify_scope(env)
    # The protected job revalidates environment protections before touching B2.
    review_mode = attest_environment(env)
    attest_native_key_scope(env)
    print("PASS_G1_B2_NATIVE_READ_ONLY_EXACT_BUCKET_PREFIX")
    import boto3
    from botocore.config import Config
    from botocore.exceptions import BotoCoreError, ClientError
    client = boto3.client(
        "s3", endpoint_url=ENDPOINT, region_name=REGION,
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                      connect_timeout=10, read_timeout=30,
                      retries={"total_max_attempts": 1}),
    )
    try:
        # Probe the actual GetObject permission, not HEAD alone. Range prevents
        # downloading the synthetic probe; any successful response is overbroad.
        try:
            probe_result = client.get_object(
                Bucket=BUCKET, Key=NEGATIVE_PROBE, Range="bytes=0-0"
            )
        except ClientError as err:
            code = err.response.get("Error", {}).get("Code", "UNKNOWN")
            verify_probe_denial(code)
        else:
            probe_body = probe_result.get("Body")
            if hasattr(probe_body, "close"):
                probe_body.close()
            raise Blocked("BLOCKED_G1_FULL_B2_CREDENTIAL_OVERBROAD")
        result = client.get_object(Bucket=BUCKET, Key=key)
        read_bytes = verify_ciphertext(result, digest, size)
    except ClientError as err:
        code = err.response.get("Error", {}).get("Code", "UNKNOWN")
        clean_code = code if isinstance(code, str) and code.isalnum() else "UNKNOWN"
        raise Blocked(f"BLOCKED_G1_FULL_B2_S3_{clean_code}") from None
    except BotoCoreError:
        raise Blocked("BLOCKED_G1_FULL_B2_TRANSPORT") from None
    print("PASS_G1_B2_FULL_CIPHERTEXT_INDEPENDENT_READBACK_SHA256")
    print(f"object_key={key}")
    print(f"ciphertext_sha256={digest}")
    print(f"ciphertext_size_bytes={read_bytes}")
    print(f"reviewer_mode={review_mode}")
    if review_mode == "SOLO_NO_REQUIRED_REVIEWER":
        print("NOT_ATTESTED_G1_INDEPENDENT_HUMAN_REVIEW")
    print("G1_DECRYPTION=NOT_TESTED")
    print("G1_RESTORE=NOT_TESTED")
    print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")


def main() -> int:
    try:
        if sys.argv[1:] == ["--attest-env"]:
            mode = attest_environment(os.environ)
            print("PASS_G1_B2_FULL_READBACK_ENV_METADATA_ONLY")
            print(f"reviewer_mode={mode}")
            print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")
        elif sys.argv[1:] == ["--check"]:
            verify_scope(os.environ)
            print("PASS_G1_B2_FULL_READBACK_LOCAL_SCOPE_ONLY")
            print("G1_FULL_BACKUP_RESTORE=NOT_ATTESTED")
        elif sys.argv[1:] == ["--readback"]:
            readback(os.environ)
        else:
            print("Usage: iam-g1-b2-full-readback.py --attest-env|--check|--readback", file=sys.stderr)
            return 2
    except Blocked as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
