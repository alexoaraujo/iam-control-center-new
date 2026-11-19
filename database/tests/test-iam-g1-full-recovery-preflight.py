#!/usr/bin/env python3
"""Synthetic, no-network positive and negative G1 recovery guard contracts."""
import importlib.util
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

path = Path(__file__).resolve().parents[1] / "scripts" / "iam-g1-full-recovery-preflight.py"
spec = importlib.util.spec_from_file_location("g1_full_recovery_preflight", path)
guard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = guard
spec.loader.exec_module(guard)

GOOD_SHA = "a" * 40
NOW = datetime(2026, 11, 18, 20, tzinfo=timezone.utc)


def url(host, db, role="neondb_owner", password="SYNTHETIC_SECRET", tls="sslmode=verify-full&sslrootcert=system"):
    return f"postgresql://{role}:{quote(password, safe='')}@{host}:5432/{db}?{tls}"


def valid():
    return {
        "GITHUB_REPOSITORY": guard.REPOSITORY,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_SHA": GOOD_SHA,
        "IAM_G1_RECOVERY_APPROVED_SHA": GOOD_SHA,
        "IAM_G1_B2_BUCKET": guard.B2_BUCKET,
        "IAM_G1_B2_ENDPOINT": guard.B2_ENDPOINT,
        "IAM_G1_B2_REGION": guard.B2_REGION,
        "IAM_G1_B2_OBJECT_PREFIX": guard.B2_PREFIX,
        "IAM_G1_FULL_BACKUP_SOURCE_URL": url(guard.SOURCE_HOST, guard.SOURCE_DB),
        "IAM_G1_FULL_BACKUP_TARGET_URL": url(guard.TARGET_HOST, guard.TARGET_DB),
    }


class PreflightTest(unittest.TestCase):
    def test_exact_pins_and_tls(self):
        guard.validate_scope(valid(), NOW)
        self.assertEqual(guard.PROJECT_ID, "tiny-rice-70320263")
        self.assertNotEqual(guard.SOURCE_BRANCH, guard.TARGET_BRANCH)
        self.assertNotEqual(guard.SOURCE_HOST, guard.TARGET_HOST)

    def test_unapproved_contexts_fail(self):
        for field, replacement in [
            ("GITHUB_REF", "refs/pull/134/merge"),
            ("GITHUB_REF", "refs/heads/production"),
            ("GITHUB_REPOSITORY", "another/repository"),
            ("GITHUB_SHA", "b" * 40),
            ("IAM_G1_RECOVERY_APPROVED_SHA", ""),
            ("IAM_G1_B2_BUCKET", "unexpected-bucket"),
            ("IAM_G1_B2_ENDPOINT", "https://example.invalid"),
            ("IAM_G1_B2_REGION", "us-east-1"),
            ("IAM_G1_B2_OBJECT_PREFIX", "iam-g1/probes/"),
        ]:
            with self.subTest(field=field), self.assertRaises(guard.Blocked):
                guard.validate_scope({**valid(), field: replacement}, NOW)

    def test_unapproved_source_or_target_fails(self):
        samples = [
            ("IAM_G1_FULL_BACKUP_SOURCE_URL", url(guard.TARGET_HOST, guard.SOURCE_DB)),
            ("IAM_G1_FULL_BACKUP_SOURCE_URL", url(guard.SOURCE_HOST.replace(".c-2.", "-pooler.c-2."), guard.SOURCE_DB)),
            ("IAM_G1_FULL_BACKUP_SOURCE_URL", url(guard.SOURCE_HOST, guard.SOURCE_DB, role="iam_schema_export_reader")),
            ("IAM_G1_FULL_BACKUP_TARGET_URL", url(guard.TARGET_HOST, "iam_database")),
            ("IAM_G1_FULL_BACKUP_TARGET_URL", url(guard.TARGET_HOST, guard.TARGET_DB, tls="sslmode=require&sslrootcert=system")),
            ("IAM_G1_FULL_BACKUP_TARGET_URL", url(guard.TARGET_HOST, guard.TARGET_DB, tls="sslmode=verify-full")),
            ("IAM_G1_FULL_BACKUP_TARGET_URL", url(guard.TARGET_HOST, guard.TARGET_DB, tls="sslmode=verify-full&sslrootcert=system&options=-cstatement_timeout=0")),
            ("IAM_G1_FULL_BACKUP_TARGET_URL", ""),
            ("IAM_G1_FULL_BACKUP_TARGET_URL", " " + url(guard.TARGET_HOST, guard.TARGET_DB)),
        ]
        for field, value in samples:
            with self.subTest(field=field, value=value[:10]), self.assertRaises(guard.Blocked):
                guard.validate_scope({**valid(), field: value}, NOW)

    def test_target_ttl_and_clock_fail_closed(self):
        # The Neon lease was extended once, from 20 Nov to 22 Nov, not indefinitely.
        self.assertEqual(guard.TARGET_EXPIRY, datetime(2026, 11, 22, 9, 12, tzinfo=timezone.utc))
        guard.validate_scope(valid(), guard.TARGET_EXPIRY - timedelta(seconds=1))
        for date in [guard.TARGET_EXPIRY,
                     guard.TARGET_EXPIRY + timedelta(seconds=1)]:
            with self.assertRaisesRegex(guard.Blocked, "TTL_EXPIRED"):
                guard.validate_scope(valid(), date)
        with self.assertRaisesRegex(guard.Blocked, "NAIVE_CLOCK"):
            guard.validate_scope(valid(), datetime(2026, 11, 18))

    def test_secret_is_never_echoed_in_errors(self):
        value = url(guard.TARGET_HOST, "wrong_database", password="SUPER_PRIVATE_SHOULD_NOT_LEAK")
        with self.assertRaises(guard.Blocked) as raised:
            guard.validate_scope({**valid(), "IAM_G1_FULL_BACKUP_TARGET_URL": value}, NOW)
        self.assertNotIn("SUPER_PRIVATE_SHOULD_NOT_LEAK", str(raised.exception))

    def test_optional_verified_channel_binding(self):
        connection = url(guard.SOURCE_HOST, guard.SOURCE_DB, tls="sslmode=verify-full&sslrootcert=system&channel_binding=require")
        guard.validate_scope({**valid(), "IAM_G1_FULL_BACKUP_SOURCE_URL": connection}, NOW)
        with self.assertRaises(guard.Blocked):
            guard.validate_scope({**valid(), "IAM_G1_FULL_BACKUP_SOURCE_URL": connection.replace("channel_binding=require", "channel_binding=disable")}, NOW)


if __name__ == "__main__":
    unittest.main()
