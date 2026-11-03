#!/usr/bin/env bash
set -euo pipefail

: "\${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "\${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL must authenticate as iam_migrator_login}"
: "\${RUNTIME_DATABASE_URL:?RUNTIME_DATABASE_URL must authenticate as iam_app_runtime_login}"
: "\${MIGRATOR_TEST_PASSWORD:?MIGRATOR_TEST_PASSWORD is required for disposable CI/local use}"
: "\${RUNTIME_TEST_PASSWORD:?RUNTIME_TEST_PASSWORD is required for disposable CI/local use}"

ROOT="database/prototypes/iam-context"

echo "[1/5] Create disposable LOGIN and group-role fixtures"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -v migrator_password="$MIGRATOR_TEST_PASSWORD" \
  -v runtime_password="$RUNTIME_TEST_PASSWORD" \
  -f "$ROOT/bootstrap.sql"

echo "[2/5] Execute prototype schema through authenticated migrator LOGIN"
{
  printf '%s\n' 'SET ROLE iam_migrator;' 'SET ROLE iam_owner;'
  cat "$ROOT/schema.sql"
} | PGPASSWORD="$MIGRATOR_TEST_PASSWORD" psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1

echo "[3/5] Seed disposable test-only context fixtures"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$ROOT/tests/fixtures.sql"

echo "[4/5] Execute runtime tests through authenticated runtime LOGIN"
PGPASSWORD="$RUNTIME_TEST_PASSWORD" psql "$RUNTIME_DATABASE_URL" \
  -v ON_ERROR_STOP=1 -f "$ROOT/tests/runtime-contract.sql"

echo "[5/5] Verify expected PostgreSQL major version"
server_version="$(psql "$DATABASE_URL" -Atc 'SHOW server_version_num')"
if [[ "$server_version" -lt 180000 || "$server_version" -ge 190000 ]]; then
  echo "Expected PostgreSQL 18; got server_version_num=$server_version" >&2
  exit 1
fi

echo "PASS: isolated tenant-context harness on PostgreSQL 18 (test adapter only)"
