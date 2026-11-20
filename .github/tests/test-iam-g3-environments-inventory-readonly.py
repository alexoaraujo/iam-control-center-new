#!/usr/bin/env python3
"""Synthetic tests for the complete, secret-free GitHub Environment inventory."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "scripts/iam-g3-environments-inventory-readonly.py"
spec = importlib.util.spec_from_file_location("g3_environment_inventory", source)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

KNOWN = (
    "Iam-G1-B2-Full-Readback-Custody", "IAM-G1-Full-Backup-Custody",
    "IAM-G1-B2-Readback-Custody", "IAM-G1-Backup-Custody",
    "IAM-G1-Disposable-Lease-Revocation", "IAM-G1-Disposable-Lease-Probe",
    "IAM-Canonical-Revocation", "IAM-Canonical-Isolated-Restore",
    "IAM-Audit-Development", "Development", "Production",
    "Neon-PR-Lifecycle", "Preview",
)


def payload(names):
    return {"total_count": len(names),
            "environments": [{"name": name, "secret_value": "SHOULD_NEVER_PRINT",
                              "protection_rules": [{"token": "DO_NOT_EMIT"}]}
                             for name in names]}


class FakeResponse:
    def __init__(self, response):
        self.data = json.dumps(response).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, length):
        return self.data[:length]


class InventoryTests(TestCase):
    def test_full_thirteen_names_preserved_without_secret_details(self):
        self.assertEqual(len(KNOWN), 13)
        names = mod.interpret_inventory(payload(KNOWN))
        self.assertEqual(names, sorted(KNOWN))
        self.assertNotIn(mod.TARGET_G3, names)

    def test_detects_separately_created_g3_environment_by_exact_name(self):
        names = mod.interpret_inventory(payload((*KNOWN, mod.TARGET_G3)))
        self.assertIn(mod.TARGET_G3, names)
        self.assertEqual(len(names), 14)

    def test_rejects_truncation_missing_fields_unsafe_names_and_duplicates(self):
        cases = [
            {}, None, [],
            {"total_count": 13, "environments": []},
            {"total_count": 101, "environments": []},
            {"total_count": 2, "environments": [{"name": "Preview"}]},
            payload(("Preview", "Preview")),
            payload(("Preview", "bad\n::error::injection")),
            payload(("Preview", "bad\rname")),
            payload(("Preview", "A" * 101)),
            payload(("Preview", "bad/separator")),
            {"total_count": "secret", "environments": []},
            {"total_count": 1, "environments": ["Preview"]},
        ]
        for case in cases:
            with self.subTest(case=str(case)[:50]), self.assertRaises(mod.InventoryBlocked):
                mod.interpret_inventory(case)

    def test_no_upstream_private_fields_or_secret_values_are_logged(self):
        fake = FakeResponse(payload(KNOWN))
        capture = io.StringIO()
        with patch.object(mod.request, "urlopen", return_value=fake) as call, contextlib.redirect_stdout(capture):
            mod.run(mod.REPOSITORY, "dummy-only-in-memory-token")
        output = capture.getvalue()
        self.assertIn("PASS_G3_READONLY_COMPLETE_ENV_INVENTORY count=13", output)
        self.assertIn("G3_ENV_NAME_NOT_PRESENT", output)
        self.assertIn("G3_ENV_CREDENTIAL_ATTESTATION=NOT_PERFORMED", output)
        for secret in ("SHOULD_NEVER_PRINT", "DO_NOT_EMIT", "dummy-only-in-memory-token"):
            self.assertNotIn(secret, output)
        self.assertEqual(call.call_args[0][0].full_url, mod.API)

    def test_missing_repo_or_token_is_rejected_before_request(self):
        for repo, token in (("wrong/repo", "dummy"), (mod.REPOSITORY, "")):
            with self.subTest(repo=repo, token=bool(token)), patch.object(
                mod.request, "urlopen"
            ) as call, self.assertRaises(mod.InventoryBlocked):
                mod.run(repo, token)
            call.assert_not_called()


if __name__ == "__main__":
    main(verbosity=2)
