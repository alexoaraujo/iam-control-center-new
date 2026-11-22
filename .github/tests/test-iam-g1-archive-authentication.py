#!/usr/bin/env python3
"""Synthetic-only encrypted G1 envelope tests; no Backblaze, Neon or live keys."""
import hashlib
import importlib.util
from pathlib import Path
import unittest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PATH = Path(__file__).resolve().parents[2] / "scripts/iam-g1-archive-authentication.py"
spec = importlib.util.spec_from_file_location("g1_aead_offline", PATH)
g1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g1)

SHA = "a" * 40
KEY = bytes(range(32))  # publicly known test data, NEVER the real AES key
DATA = b"PGDMP" + b"\x00" * 510


def synthetic(plaintext=DATA, sha=SHA, key=KEY):
    nonce = bytes(range(12))  # fixture only; real writer uses random nonces
    cipher = g1.MAGIC + nonce + AESGCM(key).encrypt(
        nonce, plaintext, g1.MAGIC + sha.encode("ascii")
    )
    return cipher, hashlib.sha256(cipher).hexdigest()


class OfflineEnvelopeTests(unittest.TestCase):
    def test_valid_synthetic_format_and_tag(self):
        cipher, digest = synthetic()
        self.assertEqual(g1.authenticate_envelope(cipher, KEY, SHA, digest, len(cipher)), DATA)

    def test_wrong_sha_key_and_tag_fail_closed(self):
        cipher, digest = synthetic()
        for key, sha in [(KEY, "b"*40), (b"z"*32, SHA)]:
            with self.assertRaisesRegex(g1.Blocked, "AEAD_AUTHENTICATION"):
                g1.authenticate_envelope(cipher, key, sha, digest, len(cipher))
        for index in [len(g1.MAGIC)+12, len(cipher)-1]:
            mutated = bytearray(cipher)
            mutated[index] ^= 1
            with self.assertRaisesRegex(g1.Blocked, "DIGEST"):
                g1.authenticate_envelope(bytes(mutated), KEY, SHA, digest, len(mutated))
            with self.assertRaisesRegex(g1.Blocked, "AEAD_AUTHENTICATION"):
                g1.authenticate_envelope(bytes(mutated), KEY, SHA,
                                         hashlib.sha256(mutated).hexdigest(), len(mutated))

    def test_size_magic_format_and_invalid_key_rejected(self):
        cipher, digest = synthetic()
        for args, marker in [
            ((cipher[:-1], KEY, SHA, digest, len(cipher)), "LENGTH_OR_LIMIT"),
            ((cipher, KEY, SHA, digest, len(cipher)+1), "LENGTH_OR_LIMIT"),
            ((cipher, b"bad", SHA, digest, len(cipher)), "INVALID_AES256_KEY"),
            ((cipher, KEY, "not-a-sha", digest, len(cipher)), "INVALID_SOURCE_OR_DIGEST"),
            ((cipher, KEY, SHA, "invalid", len(cipher)), "INVALID_SOURCE_OR_DIGEST"),
            ((cipher, KEY, SHA, digest, 65*1024*1024), "LENGTH_OR_LIMIT"),
        ]:
            with self.subTest(marker=marker), self.assertRaisesRegex(g1.Blocked, marker):
                g1.authenticate_envelope(*args)
        wrong_magic = b"BADMAGIC" + cipher[len(g1.MAGIC):]
        with self.assertRaisesRegex(g1.Blocked, "MAGIC"):
            g1.authenticate_envelope(wrong_magic, KEY, SHA,
                                     hashlib.sha256(wrong_magic).hexdigest(), len(wrong_magic))
        bad_archive, bad_digest = synthetic(b"BAD!!" + b"\x00"*510)
        with self.assertRaisesRegex(g1.Blocked, "NOT_PG18_CUSTOM_FORMAT"):
            g1.authenticate_envelope(bad_archive, KEY, SHA, bad_digest, len(bad_archive))

    def test_historic_writer_provenance_immutable(self):
        g1.approved_identity(g1.SOURCE_SHA, g1.APPROVED_OBJECT, g1.APPROVED_SHA256, g1.APPROVED_SIZE)
        for args in [
            ("b"*40, g1.APPROVED_OBJECT, g1.APPROVED_SHA256, g1.APPROVED_SIZE),
            (g1.SOURCE_SHA, g1.APPROVED_OBJECT + ".moved", g1.APPROVED_SHA256, g1.APPROVED_SIZE),
            (g1.SOURCE_SHA, g1.APPROVED_OBJECT, "0"*64, g1.APPROVED_SIZE),
            (g1.SOURCE_SHA, g1.APPROVED_OBJECT, g1.APPROVED_SHA256, 0),
        ]:
            with self.assertRaisesRegex(g1.Blocked, "UNAPPROVED_WRITER_MANIFEST"):
                g1.approved_identity(*args)

    def test_offline_only_no_live_restore_or_secrets(self):
        source = PATH.read_text(encoding="utf-8")
        for prohibited in ["import boto3", "import psycopg", "import requests",
                           "from urllib.request", "subprocess", "PGPASSWORD",
                           "IAM_G1_AES256_GCM_KEY_B64", "AWS_SECRET_ACCESS_KEY"]:
            with self.subTest(prohibited=prohibited):
                self.assertNotIn(prohibited, source)
        self.assertEqual(g1.main(), 0)


if __name__ == "__main__":
    unittest.main()
