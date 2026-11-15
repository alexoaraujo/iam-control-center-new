#!/usr/bin/env python3
"""No-credential unit contracts for the G1 protected Environment bootstrap."""
import importlib.util
import json
from pathlib import Path
from unittest import TestCase, main, mock

path = Path(__file__).resolve().parents[1] / "scripts/iam-g1-disposable-environment-bootstrap.py"
spec = importlib.util.spec_from_file_location("g1_env_bootstrap", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def environment(reviewer="alexoaraujo83", self_review=True):
    return {
        "name": m.ENV,
        "can_admins_bypass": False,
        "deployment_branch_policy": {
            "protected_branches": False, "custom_branch_policies": True
        },
        "protection_rules": [{
            "type": "required_reviewers",
            "prevent_self_review": self_review,
            "reviewers": [{"type": "User", "reviewer": {"login": reviewer}}]
        }],
    }


class GitHubFake:
    def __init__(self, actor="alexoaraujo", branch_policies=None):
        self.actor = actor
        self.policies = list(branch_policies or [])
        self.variables = {}
        self.env = None
        self.calls = []

    def __call__(self, args, data=None):
        self.calls.append((args, data))
        if args[:2] == ["api", f"repos/{m.REPO}"]:
            return {"private": False, "default_branch": "main"}
        if args[:2] == ["api", "user"]:
            return {"login": self.actor}
        if args[:2] == ["api", f"users/{m.REVIEWER}"]:
            return {"id": 288204053, "login": m.REVIEWER}
        if args[:2] == ["api", f"repos/{m.REPO}/collaborators/{m.REVIEWER}/permission"]:
            return {"permission": "write"}
        if args[:3] == ["api", "--method", "PUT"]:
            assert args[3] == m.BASE
            assert data["reviewers"] == [{"type": "User", "id": 288204053}]
            assert data["prevent_self_review"] is True
            assert data["can_admins_bypass"] is False
            self.env = environment()
            return self.env
        if args[:3] == ["api", "--method", "POST"]:
            assert args[3] == m.BASE + "/deployment-branch-policies"
            assert data == {"name": "main", "type": "branch"}
            self.policies.append({"name": "main", "type": "branch"})
            return self.policies[-1]
        if args[:2] == ["api", m.BASE]:
            return self.env or environment()
        if args[:2] == ["api", m.BASE + "/deployment-branch-policies"]:
            return {"total_count": len(self.policies), "branch_policies": self.policies}
        if args[:2] == ["variable", "set"]:
            assert args[3:7] == ["--repo", m.REPO, "--env", m.ENV]
            assert args[7] == "--body"
            self.variables[args[2]] = args[8]
            return ""
        if args[:2] == ["variable", "list"]:
            return json.dumps([
                {"name": name, "value": value}
                for name, value in self.variables.items()
            ])
        raise AssertionError(f"Unexpected GitHub call: {args!r}")


class Contracts(TestCase):
    def test_exact_reviewer_and_no_self_review(self):
        self.assertTrue(m.expected_environment(environment()))
        self.assertFalse(m.expected_environment(environment("alexoaraujo")))
        self.assertFalse(m.expected_environment(environment(self_review=False)))
        bypass = environment()
        bypass["can_admins_bypass"] = True
        self.assertFalse(m.expected_environment(bypass))
        absent_bypass = environment()
        absent_bypass.pop("can_admins_bypass")
        self.assertFalse(m.expected_environment(absent_bypass))
        e = environment()
        e["deployment_branch_policy"]["protected_branches"] = True
        self.assertFalse(m.expected_environment(e))

    def test_exact_main_only_policy(self):
        self.assertTrue(m.expected_policies({
            "total_count": 1, "branch_policies": [{"name": "main", "type": "branch"}]
        }))
        self.assertFalse(m.expected_policies({
            "total_count": 2,
            "branch_policies": [{"name": "main"}, {"name": "development"}]
        }))
        self.assertFalse(m.expected_policies({
            "total_count": 1, "branch_policies": [{"name": "main", "type": "tag"}]
        }))

    def test_apply_protects_then_sets_only_non_secret_vars(self):
        f = GitHubFake()
        with mock.patch.object(m, "gh", f), mock.patch.object(m, "branch_not_expired"):
            m.apply_environment()
            m.read_protection()
            m.verify_non_secret_vars()
        self.assertEqual(f.variables, m.VARIABLES)
        self.assertEqual(f.variables["IAM_G1_DISPOSABLE_REVOKER_APPROVED_SHA"],
                         "BLOCKED_UNTIL_REVIEWED_MAIN_SHA")
        flattened = " ".join(str(call[0]) for call in f.calls).lower()
        self.assertNotIn("secret set", flattened)
        self.assertNotIn("neon_api_key", flattened)
        self.assertNotIn("grant", flattened)
        self.assertFalse(any(args[:2] == ["secret", "set"] for args, _ in f.calls))
        self.assertTrue(all(
            args[2] in ("PUT", "POST")
            for args, _ in f.calls if args[:2] == ["api", "--method"]
        ))

    def test_apply_blocks_self_reviewer(self):
        f = GitHubFake(actor=m.REVIEWER)
        with mock.patch.object(m, "gh", f), mock.patch.object(m, "branch_not_expired"):
            with self.assertRaises(m.Blocked):
                m.apply_environment()
        self.assertIsNone(f.env)

    def test_apply_rejects_unexpected_existing_branch_patterns(self):
        f = GitHubFake(branch_policies=[
            {"name": "main", "type": "branch"},
            {"name": "feature/*", "type": "branch"},
        ])
        with mock.patch.object(m, "gh", f), mock.patch.object(m, "branch_not_expired"):
            with self.assertRaisesRegex(m.Blocked, "UNEXPECTED_EXISTING_BRANCH"):
                m.apply_environment()
        self.assertFalse(f.variables)

    def test_missing_confirm_blocks_without_api(self):
        f = GitHubFake()
        with mock.patch.object(m, "gh", f), mock.patch("sys.argv", [
            "bootstrap.py", "--mode", "apply", "--confirm", "UNAPPROVED"
        ]):
            self.assertEqual(m.main(), 2)
        self.assertEqual(f.calls, [])


if __name__ == "__main__":
    main(verbosity=2)
