#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to the disposable PostgreSQL administrator database}"
: "${BOOTSTRAP_DATABASE_URL:?BOOTSTRAP_DATABASE_URL must authenticate as iam_bootstrap_admin}"
: "${MIGRATOR_DATABASE_URL:?MIGRATOR_DATABASE_URL must authenticate as iam_migrator_login}"
: "${POSTGRES_TEST_PASSWORD:?POSTGRES_TEST_PASSWORD must be unique to this disposable CI run}"

# Generate credentials at runtime. Never commit fixed passwords or hashes.
BOOTSTRAP_TEST_PASSWORD="${BOOTSTRAP_TEST_PASSWORD:-$(openssl rand -hex 32)}"
MIGRATOR_TEST_PASSWORD="${MIGRATOR_TEST_PASSWORD:-$(openssl rand -hex 32)}"
export BOOTSTRAP_TEST_PASSWORD MIGRATOR_TEST_PASSWORD

echo "Preparing a non-superuser database-owner fixture for the role bootstrap..."
PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v bootstrap_password="$BOOTSTRAP_TEST_PASSWORD" <<'SQL'
CREATE ROLE iam_bootstrap_admin
  LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS
  PASSWORD :'bootstrap_password';
SQL
PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "ALTER DATABASE iam_schema_test OWNER TO iam_bootstrap_admin;"

echo "Running the reviewed role bootstrap as its least-privilege administrative principal..."
PGPASSWORD="$BOOTSTRAP_TEST_PASSWORD" psql "$BOOTSTRAP_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/bootstrap/0000_iam_roles.sql

echo "Checking role attributes, membership options, and database privileges..."
PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/tests/0000_role_bootstrap_contract.sql
PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/tests/role-assumption-contract.sql

echo "Verifying bootstrap is non-idempotent and fails without partial role creation..."
if PGPASSWORD="$BOOTSTRAP_TEST_PASSWORD" psql "$BOOTSTRAP_DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f database/bootstrap/0000_iam_roles.sql; then
  echo "ERROR: second bootstrap unexpectedly succeeded" >&2
  exit 1
fi
role_count="$(PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM pg_roles WHERE rolname IN ('iam_owner','iam_migrator','iam_migrator_login','iam_app_runtime','iam_app_runtime_login');")"
test "$role_count" = "5"

echo "Verifying PostgreSQL rolls back role DDL after a transaction failure..."
if PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "BEGIN; CREATE ROLE iam_bootstrap_rollback_probe NOLOGIN; SELECT 1 / 0; COMMIT;"; then
  echo "ERROR: rollback probe unexpectedly succeeded" >&2
  exit 1
fi
rollback_probe="$(PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM pg_roles WHERE rolname = 'iam_bootstrap_rollback_probe';")"
test "$rollback_probe" = "0"

echo "Setting a disposable password only for the authenticated CI migration test..."
PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v migrator_password="$MIGRATOR_TEST_PASSWORD" <<'SQL'
ALTER ROLE iam_migrator_login PASSWORD :'migrator_password';
SQL

echo "Running migration over an authenticated non-privileged LOGIN session..."
{
  printf '%s\n' 'SET ROLE iam_migrator;' 'SET ROLE iam_owner;'
  cat database/migrations/0001_context_key_hardening.sql
} | PGPASSWORD="$MIGRATOR_TEST_PASSWORD" psql "$MIGRATOR_DATABASE_URL" -v ON_ERROR_STOP=1

# Schema contract checks intentionally run as the disposable test administrator
# because they inspect ownership and exercise test-only grants/RLS behavior.
PGPASSWORD="$POSTGRES_TEST_PASSWORD" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/0001_schema_contract.sql
echo "PASS: role bootstrap, role-assumption contract, rollback, migration chain, schema contract, and RLS default-deny tests"
