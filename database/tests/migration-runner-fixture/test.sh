#!/usr/bin/env bash
# Only the disposable service of database-schema-tests. No Neon access.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]]
[[ "${DATABASE_URL:-}" == "postgresql://postgres@localhost:5432/iam_schema_test" ]]
[[ "${MIGRATOR_DATABASE_URL:-}" == "postgresql://iam_migrator_login@localhost:5432/iam_schema_test" ]]
: "${POSTGRES_TEST_PASSWORD:?}"
: "${MIGRATOR_TEST_PASSWORD:?}"
export PEOS_FIXTURE_RUNNER=PG18_DISPOSABLE_ONLY
runner=database/tests/migration-runner-fixture/runner.py
admin() {
  PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql -X -w -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"
}
run() { python3 "$runner" "$@"; }
[[ "$(admin -c "SELECT current_database()='iam_schema_test' AND current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 180000 AND 189999 AND nullif(current_setting('neon.branch_id',true),'') IS NULL")" == t ]]
[[ "$(admin -c "SELECT to_regnamespace('iam_runner_guard') IS NULL AND to_regnamespace('iam_runner_fixture') IS NULL")" == t ]]
# Test-only guard, deliberately owned by the disposable service admin, not
# creatable by the migration runner's normal role. No application data.
admin <<'SQL'
CREATE SCHEMA iam_runner_guard AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA iam_runner_guard FROM PUBLIC;
CREATE TABLE iam_runner_guard.marker(token text PRIMARY KEY);
INSERT INTO iam_runner_guard.marker VALUES ('PG18_DISPOSABLE_RUNNER_V1');
REVOKE ALL ON iam_runner_guard.marker FROM PUBLIC;
GRANT USAGE ON SCHEMA iam_runner_guard TO iam_migrator_login;
GRANT SELECT ON iam_runner_guard.marker TO iam_migrator_login;
SQL
tmp="$(mktemp -d)"
holder=""
cleanup() {
  if [[ -n "$holder" ]]; then kill "$holder" 2>/dev/null || true; wait "$holder" 2>/dev/null || true; fi
  admin -c 'DROP SCHEMA IF EXISTS iam_runner_fixture CASCADE; DROP SCHEMA iam_runner_guard CASCADE;' >/dev/null
  rm -rf "$tmp"
}
trap cleanup EXIT
expect_failure() {
  local expected="$1"; shift
  if "$@" >"$tmp/out" 2>&1; then echo "ERROR: expected $expected" >&2; exit 1; fi
  grep -Fxq "$expected" "$tmp/out" || { cat "$tmp/out" >&2; exit 1; }
}
expect_failure BLOCKED_NON_FIXTURE_TARGET env MIGRATOR_DATABASE_URL=postgresql://iam_migrator_login@example.invalid/iam_database python3 "$runner" apply
# Byte and dependency checks run without a database.
PYTHONDONTWRITEBYTECODE=1 python3 - "$runner" <<'PY'
import importlib.util, pathlib, sys, tempfile
p=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location("fixture_runner",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.ordered(m.PLAN,["1001_events"]) == ["1002_tenants","1001_events"]
for plan in ({"x":("a",("x",))},{"x":("a",("missing",))}):
    try: m.ordered(plan,["x"])
    except ValueError: pass
    else: raise AssertionError("bad DAG accepted")
with tempfile.TemporaryDirectory() as d:
    directory=pathlib.Path(d)
    for f in p.parent.glob("*.sql"):
        (directory/f.name).write_bytes(f.read_bytes())
    m.load_files(directory)
    (directory/"1002_tenants.sql").write_bytes(b"SELECT 1;\n")
    try: m.load_files(directory)
    except ValueError as e: assert str(e)=="BLOCKED_CHECKSUM"
    else: raise AssertionError("tampered migration accepted")
PY
# Rollback on empty fixture must leave NO schema, ledger or business objects.
expect_failure BLOCKED_PEOS_INTENTIONAL_ROLLBACK run rollback-probe
[[ "$(admin -c "SELECT to_regnamespace('iam_runner_fixture') IS NULL")" == t ]]
first="$(run apply)"
[[ "$first" == $'APPLIED:1002_tenants\nAPPLIED:1001_events\nPASS_FIXTURE_TRANSACTION_COMMITTED' ]]
before="$(admin -c "SELECT string_agg(migration_id||':'||checksum_sha256||':'||applied_at::text,',' ORDER BY migration_id) FROM iam_runner_fixture.schema_migrations")"
second="$(run apply)"
[[ "$second" == $'SKIPPED:1002_tenants\nSKIPPED:1001_events\nPASS_FIXTURE_TRANSACTION_COMMITTED' ]]
[[ "$before" == "$(admin -c "SELECT string_agg(migration_id||':'||checksum_sha256||':'||applied_at::text,',' ORDER BY migration_id) FROM iam_runner_fixture.schema_migrations")" ]]
# Real two-backend contention with observable acquisition barrier.
admin >"$tmp/holder" 2>&1 <<'SQL' &
BEGIN;
SELECT pg_advisory_xact_lock(187355,17318);
SELECT 'LOCK_HELD';
SELECT pg_sleep(5);
COMMIT;
SQL
holder=$!
for i in $(seq 1 100); do
  if grep -Fxq LOCK_HELD "$tmp/holder"; then break; fi
  kill -0 "$holder" 2>/dev/null || exit 1
  sleep .05
done
grep -Fxq LOCK_HELD "$tmp/holder"
expect_failure BLOCKED_PEOS_LOCK_BUSY run apply
wait "$holder"
holder=""
[[ "$(run apply)" == "$second" ]]
# Drift test: applied checksum must never be overwritten.
admin -c "UPDATE iam_runner_fixture.schema_migrations SET checksum_sha256=repeat('a',64) WHERE migration_id='1002_tenants'"
expect_failure BLOCKED_PEOS_LEDGER_CHECKSUM run apply
[[ "$(admin -c "SELECT checksum_sha256=repeat('a',64) FROM iam_runner_fixture.schema_migrations WHERE migration_id='1002_tenants'")" == t ]]
admin -c "UPDATE iam_runner_fixture.schema_migrations SET checksum_sha256='7c43dc62750e9c12b41033836afb3bdcd713e3a0b62343f7260bab6a95f6febf' WHERE migration_id='1002_tenants'"
# A recorded migration is not proof of schema safety.
admin -c 'ALTER TABLE iam_runner_fixture.events NO FORCE ROW LEVEL SECURITY'
expect_failure BLOCKED_PEOS_RLS_OR_ACL_DRIFT run apply
admin -c 'ALTER TABLE iam_runner_fixture.events FORCE ROW LEVEL SECURITY'
admin -c 'GRANT INSERT ON iam_runner_fixture.events TO iam_app_runtime'
expect_failure BLOCKED_PEOS_RLS_OR_ACL_DRIFT run apply
admin -c 'REVOKE INSERT ON iam_runner_fixture.events FROM iam_app_runtime'
# Default deny with a real synthetic row and restricted effective runtime.
admin -c 'INSERT INTO iam_runner_fixture.tenants VALUES (1); INSERT INTO iam_runner_fixture.events VALUES (1,1)'
[[ "$(admin -c 'SET ROLE iam_app_runtime_login; SELECT count(*) FROM iam_runner_fixture.tenants; SELECT count(*) FROM iam_runner_fixture.events')" == $'0\n0' ]]
expect_failure BLOCKED_PEOS_INTENTIONAL_ROLLBACK run rollback-probe
[[ "$(admin -c "SELECT to_regclass('iam_runner_fixture.rollback_probe') IS NULL AND (SELECT count(*) FROM iam_runner_fixture.schema_migrations)=2")" == t ]]
[[ "$before" == "$(admin -c "SELECT string_agg(migration_id||':'||checksum_sha256||':'||applied_at::text,',' ORDER BY migration_id) FROM iam_runner_fixture.schema_migrations")" ]]
echo 'PASS: PG18 fixture DAG, byte SHA256, advisory xact lock, idempotency, atomic DDL+ledger, rollback, roles, ACL, FORCE RLS/default deny'
