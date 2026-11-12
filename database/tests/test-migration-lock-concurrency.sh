#!/usr/bin/env bash
# PostgreSQL 18 *disposable CI only*: prove actual two-backend migration lock contention.
# Never run this script against Neon Development or Production.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL required}"
: "${PGPASSWORD:?PGPASSWORD required}"
[[ "${DATABASE_URL}" == "postgresql://postgres@localhost:5432/iam_source_restore_test" ]] || {
  echo "::error::Migration concurrency test refuses non-local/disposable database URL" >&2
  exit 2
}
version="$(psql -X -v ON_ERROR_STOP=1 -At "${DATABASE_URL}" -c "SHOW server_version_num")"
[[ "${version}" =~ ^[0-9]+$ ]] && (( version >= 180000 )) || {
  echo "::error::PostgreSQL 18+ required" >&2
  exit 2
}
[[ "$(psql -X -v ON_ERROR_STOP=1 -At "${DATABASE_URL}" -c "SELECT current_user")" == postgres ]] || exit 2
[[ "$(psql -X -v ON_ERROR_STOP=1 -At "${DATABASE_URL}" -c "SELECT to_regprocedure('iam.acquire_migration_lock()') IS NOT NULL")" == t ]] || exit 2

tmpdir="$(mktemp -d)"
holder_pid=""
cleanup() {
  if [[ -n "$holder_pid" ]] && kill -0 "$holder_pid" 2>/dev/null; then
    kill "$holder_pid" 2>/dev/null || true
    wait "$holder_pid" 2>/dev/null || true
  fi
  rm -rf "$tmpdir"
}
trap cleanup EXIT

# Session 1 holds the migration's exact advisory xact lock until COMMIT.
# A unique marker is emitted *after* acquisition so the competitor cannot race.
psql -X -v ON_ERROR_STOP=1 -At "$DATABASE_URL" >"$tmpdir/holder.log" 2>&1 <<'PSQL_HOLDER' &
BEGIN;
SELECT iam.acquire_migration_lock();
SELECT 'LOCK_HELD';
SELECT pg_sleep(5);
COMMIT;
PSQL_HOLDER
holder_pid=$!

ready=false
for attempt in $(seq 1 80); do
  if grep -Fxq LOCK_HELD "$tmpdir/holder.log"; then
    ready=true
    break
  fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then
    echo "::error::Lock holder exited before establishing barrier" >&2
    cat "$tmpdir/holder.log" >&2
    exit 1
  fi
  sleep 0.05
done
[[ "$ready" == true ]] || {
  echo "::error::Could not observe holder barrier before timeout" >&2
  exit 1
}

# Session 2 must be blocked by session 1's still-held transaction lock.
# Fail closed if it somehow acquires the lock or the failure is unrelated.
if psql -X -v ON_ERROR_STOP=1 -At "$DATABASE_URL" >"$tmpdir/competitor.log" 2>&1 <<'PSQL_COMPETITOR'; then
BEGIN;
SET lock_timeout TO '750ms';
SELECT iam.acquire_migration_lock();
COMMIT;
PSQL_COMPETITOR
  echo "::error::Migration lock was acquired while independent holder still owned it" >&2
  exit 1
fi
grep -q 'canceling statement due to lock timeout' "$tmpdir/competitor.log" || {
  echo "::error::Contender failed for a reason other than transaction lock timeout" >&2
  cat "$tmpdir/competitor.log" >&2
  exit 1
}

wait "$holder_pid"
holder_pid=""

# A new backend must acquire after the first transaction has committed.
psql -X -v ON_ERROR_STOP=1 -At "$DATABASE_URL" <<'PSQL_RELEASE'
BEGIN;
SET lock_timeout TO '1500ms';
SELECT iam.acquire_migration_lock();
COMMIT;
PSQL_RELEASE

# No fake ledger entry or DDL: this harness exercises only advisory locking.
[[ "$(psql -X -v ON_ERROR_STOP=1 -At "$DATABASE_URL" -c "SELECT count(*) FROM iam.schema_migrations")" == 0 ]] || {
  echo "::error::Migration concurrency test unexpectedly modified ledger" >&2
  exit 1
}
echo "PASS: independent PostgreSQL 18 sessions serialize migration lock; release after commit; ledger unchanged"
