#!/usr/bin/env python3
"""Offline, no-secret G1 B2 encrypted full-backup readback contracts."""
import hashlib
import importlib.util
import io
import unittest
import urllib.error
from unittest.mock import patch
from pathlib import Path

path = Path(__file__).resolve().parents[2] / "scripts" / "iam-g1-b2-full-readback.py"
spec = importlib.util.spec_from_file_location("g1_b2_full", path)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

SHA = "a" * 40
KEY = f"iam-g1/full-backups/{SHA}/20261119T132500Z-123456.pgdump.aesgcm"
DATA = b"iam-g1-encrypted-full-backup-fixture:" + b"x" * 500
DIGEST = hashlib.sha256(DATA).hexdigest()


def good():
    return {
        "GITHUB_REPOSITORY": gate.REPO,
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_SHA": SHA,
        "IAM_G1_B2_FULL_READBACK_APPROVED_GIT_SHA": SHA,
        "IAM_G1_B2_FULL_READBACK_APPROVED_OBJECT_KEY": KEY,
        "IAM_G1_B2_FULL_READBACK_APPROVED_SHA256": DIGEST,
        "IAM_G1_B2_FULL_READBACK_APPROVED_SIZE_BYTES": str(len(DATA)),
        "AWS_ACCESS_KEY_ID": "SYNTHETIC_NOT_A_KEY",
        "AWS_SECRET_ACCESS_KEY": "SYNTHETIC_NOT_A_SECRET",
    }


def object_response(body=DATA, **changes):
    fields = {
        "ContentLength": len(DATA),
        "ContentType": "application/octet-stream",
        "Metadata": {
            "sha256": DIGEST,
            "classification": "iam-g1-full-backup-encrypted",
            "pg-version": "18",
            "archive-format": "pg-dump-custom",
            "cipher": "aes256gcm",
        },
        "Body": io.BytesIO(body),
    }
    fields.update(changes)
    return fields


def good_env():
    return {
        "name": gate.ENVIRONMENT,
        "can_admins_bypass": False,
        "deployment_branch_policy": {
            "protected_branches": False,
            "custom_branch_policies": True,
        },
        "protection_rules": [{"type": "branch_policy"}],
    }


def good_branches():
    return {"total_count": 1, "branch_policies": [{"name": "main", "type": "branch"}]}


def good_custom():
    return {"total_count": 0, "custom_deployment_protection_rules": []}


class FullReadbackTest(unittest.TestCase):
    def test_exact_main_sha_and_narrow_prefix(self):
        self.assertEqual(gate.verify_scope(good()), (KEY, DIGEST, len(DATA)))
        self.assertNotEqual(gate.PREFIX, "iam-g1/probes/")
        self.assertFalse(gate.NEGATIVE_PROBE.startswith(gate.PREFIX))

    def test_unapproved_identity_prefix_and_evidence_are_rejected(self):
        replacements = {
            "GITHUB_REF": "refs/pull/138/merge",
            "GITHUB_REPOSITORY": "other/repo",
            "GITHUB_SHA": "b" * 40,
            "IAM_G1_B2_FULL_READBACK_APPROVED_GIT_SHA": "b" * 40,
            "IAM_G1_B2_FULL_READBACK_APPROVED_OBJECT_KEY": gate.NEGATIVE_PROBE,
            "IAM_G1_B2_FULL_READBACK_APPROVED_SHA256": "0" * 63,
            "IAM_G1_B2_FULL_READBACK_APPROVED_SIZE_BYTES": "0",
            "AWS_ACCESS_KEY_ID": "",
            "AWS_SECRET_ACCESS_KEY": "",
        }
        for field, wrong in replacements.items():
            with self.subTest(field=field), self.assertRaises(gate.Blocked):
                gate.verify_scope({**good(), field: wrong})

    def test_non_sha_scoped_key_path_and_path_traversal_are_rejected(self):
        for key in [
            f"iam-g1/full-backups/{'b'*40}/20261119T132500Z-123456.pgdump.aesgcm",
            f"iam-g1/full-backups/{SHA}/../probes/x.aesgcm",
            f"iam-g1/full-backups/{SHA}/20261119T132500Z-123456.pgdump.aesgcm/evil",
            f"iam-g1/full-backups/{SHA}/old.txt",
            f"iam-g1/full-backups/{SHA}/20261119T132500Z-123456.pgdump.aesgcm?x=1",
        ]:
            with self.subTest(key=key), self.assertRaises(gate.Blocked):
                gate.verify_scope({**good(), "IAM_G1_B2_FULL_READBACK_APPROVED_OBJECT_KEY": key})

    def test_full_encrypted_ciphertext_hash_and_size(self):
        self.assertEqual(gate.verify_ciphertext(object_response(), DIGEST, len(DATA)), len(DATA))
        for data, error in [(DATA[:-1], "TRUNCATED_OBJECT"), (b"?" + DATA[1:], "SHA256_MISMATCH")]:
            with self.subTest(error=error), self.assertRaisesRegex(gate.Blocked, error):
                gate.verify_ciphertext(object_response(body=data), DIGEST, len(DATA))

    def test_synthetic_metadata_size_or_format_never_counts_as_full_backup(self):
        cases = [
            object_response(Metadata={**object_response()["Metadata"], "classification": "synthetic-encrypted-probe"}),
            object_response(Metadata={**object_response()["Metadata"], "cipher": "plaintext"}),
            object_response(Metadata={**object_response()["Metadata"], "sha256": "0"*64}),
            object_response(ContentType="application/json"),
            object_response(ContentLength=0),
            object_response(ContentLength=gate.MAX_BYTES + 1),
        ]
        for response in cases:
            with self.subTest(meta=response["Metadata"]), self.assertRaises(gate.Blocked):
                gate.verify_ciphertext(response, DIGEST, len(DATA))

    def test_native_auth_proves_one_bucket_exact_prefix_and_read_only_permissions(self):
        valid = {
            "apiInfo": {"storageApi": {"allowed": {
                "buckets": [{"id": "synthetic-bucket-id", "name": gate.BUCKET}],
                "namePrefix": gate.PREFIX,
                "capabilities": ["readFiles", "listFiles"],
            }}}
        }
        gate.verify_native_key_scope(valid)
        invalid = [
            {"apiInfo": {"storageApi": {"allowed": {
                **valid["apiInfo"]["storageApi"]["allowed"], "namePrefix": "iam-g1/",
            }}}},
            {"apiInfo": {"storageApi": {"allowed": {
                **valid["apiInfo"]["storageApi"]["allowed"], "buckets": [],
            }}}},
            {"apiInfo": {"storageApi": {"allowed": {
                **valid["apiInfo"]["storageApi"]["allowed"], "buckets": [
                    {"id": "synthetic-bucket-id", "name": gate.BUCKET},
                    {"id": "another", "name": "other-bucket"},
                ],
            }}}},
            {"apiInfo": {"storageApi": {"allowed": {
                **valid["apiInfo"]["storageApi"]["allowed"], "capabilities": [
                    "readFiles", "writeFiles",
                ],
            }}}},
            {"apiInfo": {"storageApi": {"allowed": {
                **valid["apiInfo"]["storageApi"]["allowed"], "capabilities": [
                    "readFiles", "deleteFiles",
                ],
            }}}},
            {"apiInfo": {"storageApi": {"allowed": {
                **valid["apiInfo"]["storageApi"]["allowed"], "capabilities": [
                    "readFiles", "writeBucketEncryption",
                ],
            }}}},
            {"apiInfo": {"storageApi": {"allowed": {
                **valid["apiInfo"]["storageApi"]["allowed"], "capabilities": [
                    "listFiles",
                ],
            }}}},
            {},
        ]
        for payload in invalid:
            with self.subTest(payload=payload), self.assertRaises(gate.Blocked):
                gate.verify_native_key_scope(payload)

    def test_negative_control_proves_scope_excludes_probe(self):
        for code in ["AccessDenied", "Forbidden", "403"]:
            gate.verify_probe_denial(code)
        for code in ["NoSuchKey", "404", "InternalError", "Unauthorized"]:
            with self.subTest(code=code), self.assertRaises(gate.Blocked):
                gate.verify_probe_denial(code)

    def test_live_environment_policy_solo_does_not_claim_independence(self):
        self.assertEqual(gate.verify_environment(good_env(), good_branches(), good_custom()),
                         "SOLO_NO_REQUIRED_REVIEWER")
        e = good_env()
        e["protection_rules"].append({
            "type": "required_reviewers", "prevent_self_review": True,
            "reviewers": [{"type": "User", "reviewer": {"login": "alexoaraujo83"}}],
        })
        self.assertEqual(gate.verify_environment(e, good_branches(), good_custom()),
                         "INDEPENDENT_REVIEWER")

    def test_bypass_unknown_reviewers_wildcards_and_custom_rules_fail_closed(self):
        invalid = [
            (dict(good_env(), can_admins_bypass=True), good_branches(), good_custom()),
            (dict(good_env(), can_admins_bypass=None), good_branches(), good_custom()),
            (good_env(), {"total_count": 1, "branch_policies": [{"name": "*", "type": "branch"}]}, good_custom()),
            (good_env(), good_branches(), {"total_count": 1, "custom_deployment_protection_rules": [{"id": 1}]}),
        ]
        for e, b, c in invalid:
            with self.assertRaises(gate.Blocked):
                gate.verify_environment(e, b, c)
        e = good_env()
        e["protection_rules"].append({"type": "required_reviewers", "prevent_self_review": False,
                                     "reviewers": [{"type": "User", "reviewer": {"login": "alexoaraujo83"}}]})
        with self.assertRaises(gate.Blocked):
            gate.verify_environment(e, good_branches(), good_custom())

    def test_github_environment_api_classifies_denials_without_leaking_token(self):
        # A 404 is not proof of absence: GitHub can intentionally hide a
        # resource from an underprivileged token. Never attempt to create it.
        token = "SYNTHETIC_PRIVATE_TEST_TOKEN"
        fixtures = [
            ("", 404, "ENVIRONMENT_NOT_FOUND_OR_INACCESSIBLE"),
            ("", 403, "ENVIRONMENT_FORBIDDEN"),
            ("", 401, "ENVIRONMENT_UNAUTHORIZED"),
            ("/deployment-branch-policies?per_page=100", 404,
             "BRANCH_POLICIES_NOT_FOUND_OR_INACCESSIBLE"),
            ("/deployment_protection_rules", 403,
             "CUSTOM_PROTECTION_RULES_FORBIDDEN"),
        ]
        for path, status, marker in fixtures:
            with self.subTest(path=path, status=status):
                error = urllib.error.HTTPError(
                    "https://example.invalid/synthetic-endpoint", status,
                    "synthetic error", {}, None,
                )
                with patch.object(gate.urllib.request, "urlopen", side_effect=error):
                    with self.assertRaises(gate.Blocked) as caught:
                        gate._github_json(path, token)
                self.assertIn(marker, str(caught.exception))
                self.assertNotIn(token, str(caught.exception))
                self.assertNotIn("example.invalid", str(caught.exception))

    def test_github_environment_api_transport_failure_fails_closed(self):
        with patch.object(gate.urllib.request, "urlopen",
                          side_effect=urllib.error.URLError("synthetic failure")):
            with self.assertRaisesRegex(gate.Blocked, "TRANSPORT_OR_JSON"):
                gate._github_json("", "SYNTHETIC_PRIVATE_TEST_TOKEN")

    def test_no_boto3_or_network_needed_for_contracts(self):
        # The regression suite only imports the module; the B2 SDK is loaded
        # inside the protected --readback path.
        self.assertEqual(gate.BUCKET, "iam-control-center-g1-backups")
        self.assertEqual(gate.ENDPOINT, "https://s3.us-east-005.backblazeb2.com")
        self.assertEqual(gate.REGION, "us-east-005")


if __name__ == "__main__":
    unittest.main()
