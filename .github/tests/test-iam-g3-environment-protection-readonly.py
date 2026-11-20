#!/usr/bin/env python3
"""No-secret synthetic tests for the live PR128 G3 GitHub Environment gate."""
import importlib.util
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


def good_policies(*names):
    if not names:
        names = ("refs/pull/128/merge",)
    return {"total_count": len(names), "branch_policies": [
        {"name": n, "type": "branch"} for n in names
    ]}


def good_custom():
    return {"total_count": 0, "custom_deployment_protection_rules": []}


class Controls(TestCase):
    def test_exact_pr_ref_is_accepted_without_unrelated_access(self):
        names = mod.verify_g3(good_env(), good_policies(), good_custom())
        self.assertEqual(names, ["refs/pull/128/merge"])
        names = mod.verify_g3(good_env(), good_policies(
            "refs/pull/128/merge", "integration/peos-single-maintainer-bun-20261117"
        ), good_custom())
        self.assertEqual(set(names), mod.ALLOWED)

    def test_missing_admin_bypass_and_protection_are_denied(self):
        for name, value in (
            ("can_admins_bypass", True), ("can_admins_bypass", None),
            ("deployment_branch_policy", {}),
            ("protection_rules", []),
            ("protection_rules", [{"type": "required_reviewers"}]),
            ("protection_rules", [{"type": "wait_timer", "wait_timer": 0}]),
            ("protection_rules", [{"type": "branch_policy"},
                                  {"type": "wait_timer", "wait_timer": 30}]),
        ):
            metadata = good_env()
            metadata[name] = value
            with self.subTest(key=name, value=str(value)), self.assertRaises(mod.PolicyBlocked):
                mod.verify_g3(metadata, good_policies(), good_custom())

    def test_other_pr_main_wildcards_tags_and_wrong_branch_are_denied(self):
        for name in ("main", "refs/pull/*/merge", "refs/pull/132/merge",
                     "refs/pull/128/head", "feature/*",
                     "integration/peos-g1-g2-canonical-bun-20261118"):
            with self.subTest(name=name), self.assertRaises(mod.PolicyBlocked):
                mod.verify_g3(good_env(), good_policies(name), good_custom())
        with self.assertRaisesRegex(mod.PolicyBlocked, "PR128_MERGE_REF_NOT_ALLOWED"):
            mod.verify_g3(good_env(), good_policies(
                "integration/peos-single-maintainer-bun-20261117"
            ), good_custom())
        with self.assertRaisesRegex(mod.PolicyBlocked, "POLICY_TYPE_NOT_BRANCH"):
            x = good_policies()
            x["branch_policies"][0]["type"] = "tag"
            mod.verify_g3(good_env(), x, good_custom())

    def test_partial_duplicate_or_custom_unreviewed_policy_is_denied(self):
        for policies in (
            {}, {"total_count": 0, "branch_policies": []},
            {"total_count": 3, "branch_policies": good_policies()["branch_policies"]},
            good_policies("refs/pull/128/merge", "refs/pull/128/merge"),
        ):
            with self.subTest(payload=str(policies)), self.assertRaises(mod.PolicyBlocked):
                mod.verify_g3(good_env(), policies, good_custom())
        with self.assertRaises(mod.PolicyBlocked):
            mod.verify_g3(good_env(), good_policies(), {
                "total_count": 1, "custom_deployment_protection_rules": [{"type": "unknown"}]
            })

    def test_readonly_preflight_uses_only_three_metadata_paths(self):
        with patch.object(mod, "query", side_effect=[good_env(), good_policies(), good_custom()]) as q:
            mod.run(mod.REPO, "fake-read-token")
        self.assertEqual(q.call_count, 3)
        urls = [args[0][0] for args in q.call_args_list]
        self.assertEqual(urls, [mod.ROOT,
                         mod.ROOT + "/deployment-branch-policies?per_page=100",
                         mod.ROOT + "/deployment_protection_rules"])
        self.assertTrue(all("/secrets" not in url and "/variables" not in url for url in urls))

    def test_unexpected_repository_or_missing_token_fail_before_api(self):
        with patch.object(mod, "query") as q:
            for repo, token in (("different/repo", "fake"), (mod.REPO, "")):
                with self.assertRaises(mod.PolicyBlocked):
                    mod.run(repo, token)
            q.assert_not_called()


if __name__ == "__main__":
    main(verbosity=2)
