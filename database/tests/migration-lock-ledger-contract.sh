#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must authenticate as the disposable PostgreSQL administrator}"
: "${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL must authenticate as iam_migrator_login}"
: "${POSTGRES_TEST_PASSWORD:?POSTGRES_TEST_PASSWORD is required}"
: "${MIGRATOR_TEST_PASSWORD:?MIGRATOR_TEST_PASSWORD is required}"
tmp_dir="$(mktemp -d)"
ready_file="$tmp_dir/lock-held"
holder_log="$tmp_dir/holder.log"
cleanup() {
  if [[ -n "${holder_pid:-}" ]]; then wait "$holder_pid" 2>/dev/null || true; fi
  rm -rf "$tmp_dir"
}
trap cleanup EXIT
echo "[migration-lock] starting transaction A and waiting for its advisory lock"
(
  PGPASSWORD="$MIGRATOR_TEST_PASSWORD" psql -X --no-password "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 >"$holder_log" 2>&1 <<SQL
BEGIN;
SET LOCAL ROLE iam_migrator;
SELECT iam.acquire_migration_lock();
\! touch "$ready_file"
SELECT pg_sleep(4);
COMMIT;
SQL
) &
holder_pid=$!
for attempt in $(seq 1 100); do
  [[ -f "$ready_file" ]] && break
  if ! kill -0 "$holder_pid" 2>/dev/null; then cat "$holder_log" >&2; echo "ERROR: transaction A exited before acquiring the migration lock" >&2; exit 1; fi
  sleep 0.1
done
if [[ ! -f "$ready_file" ]]; then cat "$holder_log" >&2; echo "ERROR: transaction A did not acquire the migration lock within 10 seconds" >&2; exit 1; fi
echo "[migration-lock] starting transaction B; it must wait until A commits"
start_ns="$(date +%s%N)"
PGPASSWORD="$MIGRATOR_TEST_PASSWORD" psql -X --no-password "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL ROLE iam_migrator;
SELECT iam.acquire_migration_lock();
COMMIT;
SQL
end_ns="$(date +%s%N)"
elapsed_ms="$(( (end_ns - start_ns) / 1000000 ))"
wait "$holder_pid"
holder_pid=""
if (( elapsed_ms < 2000 )); then
  echo "ERROR: transaction B did not block long enough on the migration advisory lock (${elapsed_ms}ms)" >&2
  exit 1
fi
echo "PASS: transaction B waited ${elapsed_ms}ms for transaction A to commit"
echo "[migration-ledger] validating idempotency, checksum mismatch rejection, and rollback"
PGPASSWORD="$MIGRATOR_TEST_PASSWORD" psql -X --no-password "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SET LOCAL ROLE iam_migrator;
DO $ledger_contract$
DECLARE v_count integer;
BEGIN
  PERFORM iam.record_migration('9999_test_ledger_idempotence', repeat('a',64), repeat('b',40));
  PERFORM iam.record_migration('9999_test_ledger_idempotence', repeat('a',64), repeat('b',40));
  SELECT count(*) INTO v_count FROM iam.schema_migrations WHERE migration_id='9999_test_ledger_idempotence';
  IF v_count <> 1 THEN RAISE EXCEPTION 'idempotent ledger insert expected one row, found %',v_count; END IF;
  BEGIN
    PERFORM iam.record_migration('9999_test_ledger_idempotence', repeat('c',64), repeat('b',40));
    RAISE EXCEPTION 'ledger accepted a mismatched checksum';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'migration checksum mismatch for 9999_test_ledger_idempotence' THEN RAISE; END IF;
  END;
END
$ledger_contract$;
ROLLBACK;
SQL
remaining="$(PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql -X --no-password "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM iam.schema_migrations WHERE migration_id='9999_test_ledger_idempotence';")"
test "$remaining" = "0"
echo "PASS: ledger idempotency, mismatch rejection, and rollback"
