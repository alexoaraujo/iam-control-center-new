#!/usr/bin/env python3
"""Offline contract tests for branch-only owner password rotation and secret sync."""
import importlib.util
import io
from pathlib import Path
from unittest import TestCase, main, mock

src = (Path(__file__).resolve().parents[1] /
       "scripts/iam-g1-child-owner-rotate-and-sync.py")
spec = importlib.util.spec_from_file_location("iam_g1_rotate_sync", src)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class Contracts(TestCase):
    def test_plan_never_touches_remote_services(self):
        with mock.patch.object(m, "neon", side_effect=AssertionError("neon used")), \
             mock.patch.object(m, "gh", side_effect=AssertionError("github used")), \
             mock.patch.object(m, "preflight", side_effect=AssertionError("preflight used")):
            m.execute("plan", "")

    def test_confirmation_required_before_remote_call(self):
        with mock.patch.dict("os.environ", {"NEON_API_KEY": "unit-key"}), \
             mock.patch.object(m, "preflight",
                               side_effect=AssertionError("no preflight allowed")):
            with self.assertRaisesRegex(m.Blocked, "CONFIRMATION"):
                m.execute("rotate", "WRONG")

    def test_missing_neon_key_blocks_before_reset(self):
        with mock.patch.dict("os.environ", {"NEON_API_KEY": ""}):
            with self.assertRaisesRegex(m.Blocked, "NEON_API_KEY_MISSING"):
                m.execute("rotate", m.CONFIRM)

    def test_reset_targets_only_child(self):
        with mock.patch.object(m, "neon", return_value={
            "role": {"password": "example-password-only-synthetic"}
        }) as api:
            self.assertEqual(
                m.obtain_password("unit-key", "rotate"),
                "example-password-only-synthetic")
            api.assert_called_once_with(
                "POST",
                f"/projects/{m.PROJECT}/branches/{m.CHILD}/roles/{m.ROLE}/reset_password",
                "unit-key")

    def test_recovery_reads_existing_password_without_rotating(self):
        with mock.patch.object(m, "neon", return_value={
            "password": "example-password-only-synthetic"
        }) as api:
            m.obtain_password("unit-key", "sync-only")
            api.assert_called_once_with(
                "GET",
                f"/projects/{m.PROJECT}/branches/{m.CHILD}/roles/{m.ROLE}/reveal_password",
                "unit-key")

    def test_url_escapes_password_and_enforces_tls(self):
        url = m.connection_url("synthetic@:/?# &")
        self.assertTrue(url.startswith(
            f"postgresql://{m.ROLE}:synthetic%40%3A%2F%3F%23%20%26@{m.HOST}:5432/{m.DATABASE}"
        ))
        self.assertTrue(url.endswith("?sslmode=verify-full&sslrootcert=system"))
        self.assertNotIn("synthetic@:/?# &", url)

    def test_secret_set_via_stdin_never_argv(self):
        full_url = m.connection_url("synthetic-password")
        with mock.patch.object(m, "gh", return_value="") as cli, \
             mock.patch("sys.stdout", new_callable=io.StringIO):
            m.sync_secret(full_url)
        cli.assert_called_once_with(
            ["secret", "set", m.SECRET, "--env", m.ENV, "--repo", m.REPO],
            stdin=full_url)
        self.assertNotIn(full_url, str(cli.call_args.args[0]))

    def test_rotate_and_sync_use_same_password(self):
        with mock.patch.dict("os.environ", {"NEON_API_KEY": "unit-key"}), \
             mock.patch.object(m, "preflight"), \
             mock.patch.object(m, "obtain_password",
                               return_value="synthetic-password") as get_pwd, \
             mock.patch.object(m, "sync_secret") as sync, \
             mock.patch.object(m, "test_new_connection") as conn, \
             mock.patch("sys.stdout", new_callable=io.StringIO):
            m.execute("rotate", m.CONFIRM)
            get_pwd.assert_called_once_with("unit-key", "rotate")
            sync.assert_called_once_with(
                m.connection_url("synthetic-password"))
            conn.assert_called_once_with("synthetic-password")

    def test_fail_closed_if_secret_sync_unavailable(self):
        with mock.patch.object(m, "gh",
                               side_effect=m.Blocked("GITHUB_API_OR_SECRET_SYNC_DENIED")), \
             mock.patch.object(m.time, "sleep"):
            with self.assertRaisesRegex(m.Blocked, "RUN_SYNC_ONLY"):
                m.sync_secret(m.connection_url("synthetic-password"))


if __name__ == "__main__":
    main(verbosity=2)
