#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
: "${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL must authenticate as iam_migrator_login}"
: "${MIGRATOR_TEST_PASSWORD:?MIGRATOR_TEST_PASSWORD must be a disposable CI-only password}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v migrator_password="$MIGRATOR_TEST_PASSWORD" \
  -f database/tests/bootstrap.sql

echo "Running migration over an authenticated non-privileged LOGIN session..."
{
  printf '%s\n' 'SET ROLE iam_migrator;' 'SET ROLE iam_owner;'
  cat database/migrations/0001_initial_iam_schema.sql
} | PGPASSWORD="$MIGRATOR_TEST_PASSWORD" psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1

# Schema contract checks intentionally run as the disposable test administrator
# because they inspect ownership and exercise test-only grants/RLS behavior.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/0001_schema_contract.sql
echo "PASS: schema contract, composite tenant FK, and RLS default-deny tests"
