#!/usr/bin/env python3
"""Offline main-only G3 Environment readback tests; never access secrets."""
import importlib.util
import contextlib
import io
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

source = Path(__file__).resolve().parents[1] / "scripts/iam-g3-environment-protection-readonly.py"
spec = importlib.util.spec_from_file_location("g3_env_policy", source)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def good_env():
    return {
        "name": mod.NAME, "can_admins_bypass": False,
        "deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": True
        },
        "protection_rules": [{"type": "branch_policy"}],
    }


def policies(*names):
    return {"total_count": len(names), "branch_policies": [
        {"name": name, "type": "branch"} for name in names
    ]}


def good_custom():
    return {"total_count": 0, "custom_deployment_protection_rules": []}


class MainOnlyControls(TestCase):
    def test_accept_exact_main_branch_only(self):
        self.assertEqual(mod.ALLOWED, {"main"})
        self.assertEqual(mod.verify_g3(good_env(), policies("main"), good_custom()), ["main"])

    def test_reject_legacy_pr_ref_wildcards_and_mixed_refs(self):
        for entries in (
            (), ("refs/pull/128/merge",), ("refs/heads/main",),
            ("refs/pull/145/merge",), ("refs/pull/*/merge",),
            ("main", "refs/pull/128/merge"), ("main", "main"),
            ("integration/peos-single-maintainer-bun-20261117",),
        ):
            with self.subTest(refs=entries), self.assertRaises(mod.PolicyBlocked):
                mod.verify_g3(good_env(), policies(*entries), good_custom())
        p = policies("main")
        p["branch_policies"][0]["type"] = "tag"
        with self.assertRaisesRegex(mod.PolicyBlocked, "POLICY_TYPE_NOT_BRANCH"):
            mod.verify_g3(good_env(), p, good_custom())

    def test_missing_admin_bypass_or_unknown_protection_is_blocked(self):
        for name, value in (
            ("can_admins_bypass", True), ("can_admins_bypass", None),
            ("deployment_branch_policy", {}),
            ("protection_rules", []),
            ("protection_rules", [{"type": "required_reviewers"}]),
            ("protection_rules", [{"type": "branch_policy"},
                                  {"type": "wait_timer", "wait_timer": 30}]),
        ):
            metadata = good_env()
            metadata[name] = value
            with self.subTest(name=name), self.assertRaises(mod.PolicyBlocked):
                mod.verify_g3(metadata, policies("main"), good_custom())
        with self.assertRaises(mod.PolicyBlocked):
            mod.verify_g3(good_env(), policies("main"), {
                "total_count": 1, "custom_deployment_protection_rules": [{}]
            })

    def test_readback_never_fetches_secrets_or_mutates(self):
        capture = io.StringIO()
        with patch.object(mod, "query", side_effect=[
            good_env(), policies("main"), good_custom()]) as mock, \
             contextlib.redirect_stdout(capture):
            mod.run(mod.REPO, "fake-read-token")
        self.assertEqual(mock.call_count, 3)
        self.assertIn("PASS_G3_ENV_EFFECTIVE_PROTECTION", capture.getvalue())
        self.assertIn('["main"]', capture.getvalue())
        self.assertTrue(all("/secrets" not in args[0][0] and
                            "/variables" not in args[0][0]
                            for args in mock.call_args_list))

    def test_missing_token_or_wrong_repository_rejected(self):
        with patch.object(mod, "query") as mock:
            for repo, token in (("other/repository", "fake"), (mod.REPO, "")):
                with self.assertRaises(mod.PolicyBlocked):
                    mod.run(repo, token)
            mock.assert_not_called()


if __name__ == "__main__":
    main(verbosity=2)
