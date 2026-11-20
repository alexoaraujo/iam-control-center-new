#!/usr/bin/env python3
"""Offline G1 encrypted writer security contracts: no source, B2 or credentials."""
import base64
import importlib.util
import io
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest
from urllib.parse import quote

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/iam-g1-b2-full-backup-writer.py"
spec = importlib.util.spec_from_file_location("iam_g1_full_writer", SCRIPT)
writer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(writer)

SHA = "a" * 40
KEY = b"x" * 32
NOW = datetime(2026, 11, 19, 15, 0, tzinfo=timezone.utc)

def valid():
    return {
        "GITHUB_REPOSITORY": writer.REPO, "GITHUB_REF": "refs/heads/main",
        "GITHUB_SHA": SHA, "IAM_G1_FULL_BACKUP_APPROVED_SHA": SHA,
        "GITHUB_RUN_ID": "123456", "IAM_G1_FULL_BACKUP_CONFIRMATION": writer.CONFIRMATION,
        "IAM_G1_ENCRYPTION_KEY_ESCROW_ATTESTATION": "PRIVATE_ESCROW_CONFIRMED",
        "IAM_G1_B2_BUCKET": writer.BUCKET, "IAM_G1_B2_ENDPOINT": writer.ENDPOINT,
        "IAM_G1_B2_REGION": writer.REGION, "IAM_G1_B2_OBJECT_PREFIX": writer.PREFIX,
        "IAM_G1_FULL_BACKUP_SOURCE_URL":
            "postgresql://neondb_owner:" + quote("SYNTHETIC_PASSWORD_TEST_ONLY", safe="") +
            "@ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech:5432/iam_database"
            "?sslmode=verify-full&sslrootcert=system",
        "AWS_ACCESS_KEY_ID": "TEST_NOT_REAL", "AWS_SECRET_ACCESS_KEY": "TEST_NOT_REAL",
        "IAM_G1_AES256_GCM_KEY_B64": base64.b64encode(KEY).decode(),
    }

def valid_native():
    return {"apiInfo": {"storageApi": {"allowed": {
        "buckets": [{"id": "nonsecret-fixture", "name": writer.BUCKET}],
        "namePrefix": writer.PREFIX,
        "capabilities": ["writeFiles"],
    }}}}

class FullBackupWriterTests(unittest.TestCase):
    def test_exact_main_sha_source_tls_and_escrow(self):
        key, sha = writer.check_scope(valid(), NOW)
        self.assertEqual(key, KEY)
        self.assertEqual(sha, SHA)

    def test_reject_mismatches_missing_secrets_and_target_uri(self):
        bad = {
            "GITHUB_REPOSITORY": "someone/repo",
            "GITHUB_REF": "refs/heads/production",
            "GITHUB_SHA": "b" * 40,
            "IAM_G1_FULL_BACKUP_APPROVED_SHA": "b" * 40,
            "IAM_G1_FULL_BACKUP_CONFIRMATION": "NO_BACKUP",
            "IAM_G1_ENCRYPTION_KEY_ESCROW_ATTESTATION": "",
            "IAM_G1_B2_BUCKET": "other-bucket",
            "IAM_G1_B2_OBJECT_PREFIX": "iam-g1/probes/",
            "AWS_ACCESS_KEY_ID": "",
            "AWS_SECRET_ACCESS_KEY": "",
            "IAM_G1_AES256_GCM_KEY_B64": base64.b64encode(b"x" * 31).decode(),
            "GITHUB_RUN_ID": "unsafe/1",
            "IAM_G1_FULL_BACKUP_SOURCE_URL":
                valid()["IAM_G1_FULL_BACKUP_SOURCE_URL"].replace("/iam_database?", "/iam_canonical_validation?"),
        }
        for k, v in bad.items():
            with self.subTest(k=k), self.assertRaises(writer.Blocked):
                writer.check_scope({**valid(), k: v}, NOW)

    def test_ttl_24h_recovery_window(self):
        guard = writer._recovery_guard()
        writer.check_scope(valid(), guard.TARGET_EXPIRY - timedelta(hours=24, seconds=1))
        for now in [guard.TARGET_EXPIRY - timedelta(hours=24),
                    guard.TARGET_EXPIRY, guard.TARGET_EXPIRY + timedelta(hours=1)]:
            with self.assertRaisesRegex(writer.Blocked, "TARGET_RECOVERY_WINDOW"):
                writer.check_scope(valid(), now)

    def test_writer_key_exact_prefix_no_read_or_delete(self):
        writer.verify_native_writer_scope(valid_native())
        for replacement in [
            {"namePrefix": "iam-g1/"},
            {"namePrefix": ""},
            {"capabilities": ["writeFiles", "readFiles"]},
            {"capabilities": ["writeFiles", "deleteFiles"]},
            {"capabilities": ["writeFiles", "listAllBucketNames"]},
            {"capabilities": ["listBuckets"]},
            {"buckets": []},
            {"buckets": [{"id": "x", "name": "other"}]},
            {"buckets": [{"id": "x", "name": writer.BUCKET}, {"id": "y", "name": "other"}]},
        ]:
            root = valid_native()
            root["apiInfo"]["storageApi"]["allowed"].update(replacement)
            with self.subTest(replacement=replacement), self.assertRaises(writer.Blocked):
                writer.verify_native_writer_scope(root)

    def test_native_b2_preflight_never_exports_and_requires_valid_scope(self):
        from contextlib import redirect_stdout, redirect_stderr
        from unittest.mock import patch

        # With approved local scope, the probe calls only B2 authorization.
        with patch.object(writer, "check_scope", return_value=(KEY, SHA)):
            with patch.object(writer, "attest_native_writer_key") as b2:
                with patch.object(writer, "export_and_encrypt",
                                  side_effect=AssertionError("no pg_dump in B2 preflight")):
                    with patch.object(writer.sys, "argv", ["writer", "--check-native-b2"]):
                        with patch.dict(writer.os.environ, valid(), clear=True):
                            with redirect_stdout(io.StringIO()) as output:
                                self.assertEqual(writer.main(), 0)
        b2.assert_called_once()
        self.assertIn("PASS_G1_WRITER_B2_NATIVE_EXACT_BUCKET_PREFIX_CAPABILITIES",
                      output.getvalue())
        self.assertIn("NOT_ATTESTED", output.getvalue())

        # Wrong main SHA or another local error must not call B2 authorization.
        with patch.object(writer, "check_scope",
                          side_effect=writer.Blocked("BLOCKED_G1_WRITER_UNAPPROVED_SHA")):
            with patch.object(writer, "attest_native_writer_key") as b2:
                with patch.object(writer.sys, "argv", ["writer", "--check-native-b2"]):
                    with redirect_stderr(io.StringIO()):
                        self.assertEqual(writer.main(), 2)
        b2.assert_not_called()

        # Overprivileged B2 authorizations must fail, never be treated as PASS.
        with patch.object(writer, "check_scope", return_value=(KEY, SHA)):
            with patch.object(writer, "attest_native_writer_key",
                              side_effect=writer.Blocked("BLOCKED_G1_WRITER_NATIVE_OVERPRIVILEGED")):
                with patch.object(writer.sys, "argv", ["writer", "--check-native-b2"]):
                    with redirect_stderr(io.StringIO()) as errors:
                        self.assertEqual(writer.main(), 2)
        self.assertIn("NATIVE_OVERPRIVILEGED", errors.getvalue())

    def test_full_archive_aes_gcm_round_trip_authenticates_sha(self):
        from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
        from cryptography.exceptions import InvalidTag
        plaintext = b"PGDMP" + b"FULL_ARCHIVE_SYNTHETIC_ONLY" * 50
        out = io.BytesIO()
        plain_len, length, digest = writer.encrypt_stream(io.BytesIO(plaintext), out, KEY, SHA)
        ciphertext = out.getvalue()
        self.assertEqual(plain_len, len(plaintext))
        self.assertEqual(len(ciphertext), length)
        import hashlib
        self.assertEqual(hashlib.sha256(ciphertext).hexdigest(), digest)
        self.assertTrue(ciphertext.startswith(writer.MAGIC))
        nonce = ciphertext[len(writer.MAGIC):len(writer.MAGIC) + 12]
        body = ciphertext[len(writer.MAGIC) + 12:-16]
        tag = ciphertext[-16:]
        def decrypt(data, auth_sha):
            decryptor = Cipher(algorithms.AES(KEY), modes.GCM(nonce, tag)).decryptor()
            decryptor.authenticate_additional_data(writer.MAGIC + auth_sha.encode())
            return decryptor.update(data) + decryptor.finalize()
        self.assertEqual(decrypt(body, SHA), plaintext)
        for tampered, auth_sha in [(body[:-1] + b"?", SHA), (body, "b" * 40)]:
            with self.assertRaises(InvalidTag):
                decrypt(tampered, auth_sha)

    def test_noncustom_or_tiny_archive_rejected(self):
        for payload in [b"NOTPG" + b"x" * 600, b"PGDMPshort"]:
            with self.subTest(length=len(payload)), self.assertRaises(writer.Blocked):
                writer.encrypt_stream(io.BytesIO(payload), io.BytesIO(), KEY, SHA)

    def test_authenticated_pg18_identity_required_before_dump(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        source = valid()
        identity_failed = SimpleNamespace(returncode=0,
                                          stdout=b"iam_database|neondb_owner|170007\n")
        with patch.object(writer.subprocess, "run", return_value=identity_failed) as run:
            with patch.object(writer.subprocess, "Popen",
                              side_effect=AssertionError("must never export")):
                with self.assertRaisesRegex(writer.Blocked, "PG18_SOURCE_IDENTITY_OR_VERSION"):
                    writer.export_and_encrypt(source, io.BytesIO(), KEY, SHA)
        self.assertNotIn("SYNTHETIC_PASSWORD_TEST_ONLY", str(run.call_args.args[0]))

        class SyntheticDump:
            def __init__(self):
                self.stdout = io.BytesIO(b"PGDMP" + b"synthetic-ci-only" * 80)
            def wait(self, **kwargs):
                return 0
            def poll(self):
                return 0
        with patch.object(writer.subprocess, "run",
                          return_value=SimpleNamespace(returncode=0,
                                                       stdout=b"iam_database|neondb_owner|180007\n")):
            with patch.object(writer.subprocess, "Popen", return_value=SyntheticDump()):
                output = io.BytesIO()
                plain, size, sha256 = writer.export_and_encrypt(source, output, KEY, SHA)
        self.assertGreater(plain, 256)
        self.assertEqual(len(output.getvalue()), size)
        self.assertTrue(output.getvalue().startswith(writer.MAGIC))
        self.assertEqual(len(sha256), 64)

    def test_explicit_channel_binding_require_propagates_to_pg18_identity_and_dump(self):
        from unittest.mock import patch
        from types import SimpleNamespace

        source = valid()
        source["IAM_G1_FULL_BACKUP_SOURCE_URL"] += "&channel_binding=require"

        class SyntheticDump:
            def __init__(self):
                self.stdout = io.BytesIO(b"PGDMP" + b"encrypted-test-only" * 80)
            def wait(self, **kwargs):
                return 0
            def poll(self):
                return 0

        with patch.object(
                writer.subprocess, "run",
                return_value=SimpleNamespace(
                    returncode=0, stdout=b"iam_database|neondb_owner|180007\n")) as identity:
            with patch.object(writer.subprocess, "Popen",
                              return_value=SyntheticDump()) as dump:
                writer.export_and_encrypt(source, io.BytesIO(), KEY, SHA)
        self.assertEqual(identity.call_args.kwargs["env"]["PGCHANNELBINDING"], "require")
        self.assertIn("PGCHANNELBINDING", identity.call_args.args[0])
        self.assertEqual(dump.call_args.kwargs["env"]["PGCHANNELBINDING"], "require")
        self.assertIn("PGCHANNELBINDING", dump.call_args.args[0])

        # No explicit channel_binding requirement => libpq's documented prefer.
        source = valid()
        with patch.object(
                writer.subprocess, "run",
                return_value=SimpleNamespace(
                    returncode=0, stdout=b"iam_database|neondb_owner|180007\n")) as identity:
            with patch.object(writer.subprocess, "Popen",
                              return_value=SyntheticDump()) as dump:
                writer.export_and_encrypt(source, io.BytesIO(), KEY, SHA)
        self.assertEqual(identity.call_args.kwargs["env"]["PGCHANNELBINDING"], "prefer")
        self.assertEqual(dump.call_args.kwargs["env"]["PGCHANNELBINDING"], "prefer")

    def test_unique_object_name_exact_sha_and_run(self):
        key = writer.object_key(SHA, "123", NOW)
        self.assertEqual(key, writer.PREFIX + SHA + "/20261119T150000Z-123.pgdump.aesgcm")
        self.assertRegex(key, r"/[0-9]{8}T[0-9]{6}Z-123\.pgdump\.aesgcm$")
        with self.assertRaises(writer.Blocked):
            writer.object_key("b" * 39, "123", NOW)
        with self.assertRaises(writer.Blocked):
            writer.object_key(SHA, "../123", NOW)

    def test_error_never_echoes_database_password(self):
        invalid = valid()["IAM_G1_FULL_BACKUP_SOURCE_URL"].replace("iam_database?", "other?")
        with self.assertRaises(writer.Blocked) as ctx:
            writer.check_scope({**valid(), "IAM_G1_FULL_BACKUP_SOURCE_URL": invalid}, NOW)
        self.assertNotIn("SYNTHETIC_PASSWORD_TEST_ONLY", str(ctx.exception))

    def test_reuse_main_only_environment_reader_and_no_network_during_import(self):
        # The attestation is the already-tested readback policy with a distinct
        # environment name; unknown or wildcard config must still fail closed.
        reader = writer._load(Path(__file__).resolve().parents[2] /
                              "scripts/iam-g1-b2-full-readback.py", "readback_contract")
        reader.ENVIRONMENT = writer.ENVIRONMENT
        env = {"name": writer.ENVIRONMENT, "can_admins_bypass": False,
               "deployment_branch_policy":
                   {"protected_branches": False, "custom_branch_policies": True},
               "protection_rules": [{"type": "branch_policy"}]}
        branch = {"total_count": 1, "branch_policies": [{"type": "branch", "name": "main"}]}
        custom = {"total_count": 0, "custom_deployment_protection_rules": []}
        self.assertEqual(reader.verify_environment(env, branch, custom), "SOLO_NO_REQUIRED_REVIEWER")
        branch["branch_policies"][0]["name"] = "*"
        with self.assertRaises(reader.Blocked):
            reader.verify_environment(env, branch, custom)

if __name__ == "__main__":
    unittest.main()
