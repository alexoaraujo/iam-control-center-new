#!/usr/bin/env python3
"""Offline G1 Environment contracts: single maintainer, separate technical safeguards."""
import importlib.util
import json
from pathlib import Path
from unittest import TestCase, main, mock

path = Path(__file__).resolve().parents[1] / "scripts/iam-g1-disposable-environment-bootstrap.py"
spec = importlib.util.spec_from_file_location("g1_env_bootstrap", path)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def environment(*, reviewer=False, bypass=False, branch=True):
    return {
        "name": m.ENV,
        "can_admins_bypass": bypass,
        "deployment_branch_policy": {
            "protected_branches": not branch, "custom_branch_policies": branch,
        },
        "protection_rules": [{
            "type": "required_reviewers",
            "prevent_self_review": True,
            "reviewers": [{"type": "User", "reviewer": {"login": "second-human"}}],
        }] if reviewer else [],
    }


class GitHubFake:
    def __init__(self, actor=None, branch_policies=None, permission="admin"):
        self.actor = actor if actor is not None else m.MAINTAINER
        self.permission = permission
        self.policies = list(branch_policies or [])
        self.variables = {}
        self.env = None
        self.calls = []

    def __call__(self, args, data=None):
        self.calls.append((args, data))
        if args[:2] == ["api", f"repos/{m.REPO}"]:
            return {"private": False, "default_branch": "main"}
        if args[:2] == ["api", "user"]:
            return {"login": self.actor, "id": 325264809}
        if args[:2] == ["api", f"repos/{m.REPO}/collaborators/{m.MAINTAINER}/permission"]:
            return {"permission": self.permission}
        if args[:3] == ["api", "--method", "PUT"]:
            assert args[3] == m.BASE
            assert data["reviewers"] == []
            assert data["prevent_self_review"] is False
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
                {"name": name, "value": value} for name, value in self.variables.items()
            ])
        raise AssertionError(f"Unexpected GitHub call: {args!r}")


class Contracts(TestCase):
    def test_no_required_reviewers_and_no_admin_bypass(self):
        self.assertTrue(m.expected_environment(environment()))
        self.assertFalse(m.expected_environment(environment(reviewer=True)))
        self.assertFalse(m.expected_environment(environment(bypass=True)))
        absent = environment()
        absent.pop("can_admins_bypass")
        self.assertFalse(m.expected_environment(absent))
        self.assertFalse(m.expected_environment(environment(branch=False)))

    def test_exact_main_only_policy(self):
        self.assertTrue(m.expected_policies({
            "total_count": 1, "branch_policies": [{"name": "main", "type": "branch"}],
        }))
        self.assertFalse(m.expected_policies({
            "total_count": 2,
            "branch_policies": [{"name": "main"}, {"name": "development"}],
        }))
        self.assertFalse(m.expected_policies({
            "total_count": 1, "branch_policies": [{"name": "main", "type": "tag"}],
        }))

    def test_apply_no_second_person_and_sets_only_non_secret_vars(self):
        fake = GitHubFake()
        with mock.patch.object(m, "gh", fake), mock.patch.object(m, "branch_not_expired"):
            m.apply_environment()
            m.read_protection()
            m.verify_non_secret_vars()
        self.assertEqual(fake.variables, m.VARIABLES)
        self.assertEqual(fake.variables["IAM_G1_DISPOSABLE_REVOKER_APPROVED_SHA"],
                         "BLOCKED_UNTIL_MAINTAINER_SHA_RECORDED")
        self.assertFalse(any(args[:2] == ["secret", "set"] for args, _ in fake.calls))
        self.assertFalse(any(args[:2] == ["api", f"users/second-human"]
                             for args, _ in fake.calls))

    def test_apply_rejects_non_maintainer_or_non_admin(self):
        for fake in (GitHubFake(actor="other"), GitHubFake(permission="write")):
            with mock.patch.object(m, "gh", fake), mock.patch.object(m, "branch_not_expired"):
                with self.assertRaisesRegex(m.Blocked, "SINGLE_MAINTAINER"):
                    m.apply_environment()
            self.assertIsNone(fake.env)

    def test_apply_rejects_unexpected_existing_branch_patterns(self):
        fake = GitHubFake(branch_policies=[
            {"name": "main", "type": "branch"},
            {"name": "feature/*", "type": "branch"},
        ])
        with mock.patch.object(m, "gh", fake), mock.patch.object(m, "branch_not_expired"):
            with self.assertRaisesRegex(m.Blocked, "UNEXPECTED_EXISTING_BRANCH"):
                m.apply_environment()
        self.assertFalse(fake.variables)

    def test_missing_confirm_blocks_without_api(self):
        fake = GitHubFake()
        with mock.patch.object(m, "gh", fake), mock.patch("sys.argv", [
            "bootstrap.py", "--mode", "apply", "--confirm", "UNAPPROVED",
        ]):
            self.assertEqual(m.main(), 2)
        self.assertEqual(fake.calls, [])

    def test_expired_lease_blocks_real_apply(self):
        with mock.patch.object(m, "gh", side_effect=AssertionError("must not call API")):
            with self.assertRaisesRegex(m.Blocked, "TTL_EXPIRED"):
                m.branch_not_expired()


if __name__ == "__main__":
    main(verbosity=2)
