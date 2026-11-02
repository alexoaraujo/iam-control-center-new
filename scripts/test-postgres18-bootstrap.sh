#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_CONTAINER_ID:?POSTGRES_CONTAINER_ID must identify the disposable PostgreSQL service container}"

psql_in_service() {
  docker exec -i "$POSTGRES_CONTAINER_ID" psql -X -U postgres -d postgres "$@"
}

expect_failure() {
  local label="$1"
  local sql="$2"
  if psql_in_service -v ON_ERROR_STOP=1 -c "$sql" >/dev/null 2>&1; then
    echo "::error::Expected denial but command succeeded: $label"
    exit 1
  fi
  echo "PASS (denied): $label"
}

psql_in_service -v ON_ERROR_STOP=1 -f database/bootstrap/tests/bootstrap.sql
psql_in_service -v ON_ERROR_STOP=1 -f database/bootstrap/tests/assertions.sql

migrator_result="$(
  psql_in_service -Atq -v ON_ERROR_STOP=1 -c \
    "SET SESSION AUTHORIZATION iam_migrator_login; SET ROLE iam_migrator; SELECT current_user; RESET ROLE; SET ROLE iam_owner; SELECT current_user;"
)"
if [[ "$migrator_result" != $'iam_migrator\niam_owner' ]]; then
  echo "::error::Unexpected migrator SET ROLE chain result: $migrator_result"
  exit 1
fi
echo "PASS: migrator can explicitly assume iam_migrator and iam_owner"

expect_failure "runtime cannot SET ROLE iam_owner" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_owner;"
expect_failure "runtime cannot SET ROLE iam_migrator" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_migrator;"
expect_failure "runtime cannot SET ROLE iam_app_runtime" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_app_runtime;"
expect_failure "runtime cannot CREATE in public" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; CREATE TABLE public.runtime_must_not_create(id integer);"
expect_failure "runtime cannot CREATE in the migration fixture schema" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; CREATE TABLE bootstrap_fixture.runtime_must_not_create(id integer);"
expect_failure "runtime cannot create temporary tables" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; CREATE TEMP TABLE runtime_must_not_create(id integer);"
expect_failure "runtime cannot read the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SELECT * FROM bootstrap_fixture.schema_migrations;"
expect_failure "runtime cannot insert into the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; INSERT INTO bootstrap_fixture.schema_migrations(version) VALUES ('runtime-forbidden');"
expect_failure "runtime cannot update the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; UPDATE bootstrap_fixture.schema_migrations SET version = 'runtime-forbidden';"
expect_failure "runtime cannot delete from the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; DELETE FROM bootstrap_fixture.schema_migrations;"

echo "PASS: all PostgreSQL 18 bootstrap negative tests passed"
