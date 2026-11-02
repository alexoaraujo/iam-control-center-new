#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  if [[ "${CI:-}" == "true" ]]; then
    echo "::error::Docker is required in CI to execute PostgreSQL 18 bootstrap tests"
    exit 1
  fi
  echo "SKIP: Docker is unavailable; PostgreSQL 18 bootstrap tests run automatically in CI."
  exit 0
fi

created_container=false
if [[ -n "${POSTGRES_CONTAINER_ID:-}" ]]; then
  container_id="$POSTGRES_CONTAINER_ID"
else
  container_name="iam-pg18-bootstrap-${GITHUB_RUN_ID:-local}-$$"
  container_id="$(docker run -d --name "$container_name" -e POSTGRES_PASSWORD=disposable-ci-only postgres:18)"
  created_container=true
fi

cleanup() {
  if [[ "$created_container" == "true" ]]; then
    docker rm -f "$container_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ready=false
for attempt in $(seq 1 60); do
  if docker exec "$container_id" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "::error::PostgreSQL 18 service did not become ready"
  docker logs "$container_id" || true
  exit 1
fi

psql_in_service() {
  docker exec -i "$container_id" psql -X -h 127.0.0.1 -U postgres -d postgres "$@"
}

expect_permission_denied() {
  local label="$1"
  local sql="$2"
  local output
  if output="$(psql_in_service -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "$sql" 2>&1)"; then
    echo "::error::Expected permission denial but command succeeded: $label"
    exit 1
  fi
  if ! grep -Fq '42501' <<<"$output"; then
    echo "::error::Expected SQLSTATE 42501 for: $label"
    printf '%s\n' "$output"
    exit 1
  fi
  echo "PASS (SQLSTATE 42501): $label"
}

psql_in_service -v ON_ERROR_STOP=1 < database/bootstrap/tests/bootstrap.sql
psql_in_service -v ON_ERROR_STOP=1 < database/bootstrap/tests/assertions.sql

migrator_result="$(
  psql_in_service -Atq -v ON_ERROR_STOP=1 -c \
    "SET SESSION AUTHORIZATION iam_migrator_login; SET ROLE iam_migrator; SELECT current_user; RESET ROLE; SET ROLE iam_owner; SELECT current_user;"
)"
if [[ "$migrator_result" != $'iam_migrator\niam_owner' ]]; then
  echo "::error::Unexpected migrator SET ROLE chain result: $migrator_result"
  exit 1
fi
echo "PASS: migrator can explicitly assume iam_migrator and iam_owner"

expect_permission_denied "runtime cannot SET ROLE iam_owner" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_owner;"
expect_permission_denied "runtime cannot SET ROLE iam_migrator" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_migrator;"
expect_permission_denied "runtime cannot SET ROLE iam_app_runtime" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_app_runtime;"
expect_permission_denied "runtime cannot CREATE in public" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; CREATE TABLE public.runtime_must_not_create(id integer);"
expect_permission_denied "runtime cannot CREATE in the migration fixture schema" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; CREATE TABLE bootstrap_fixture.runtime_must_not_create(id integer);"
expect_permission_denied "runtime cannot create temporary tables" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; CREATE TEMP TABLE runtime_must_not_create(id integer);"
expect_permission_denied "runtime cannot read the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; SELECT * FROM bootstrap_fixture.schema_migrations;"
expect_permission_denied "runtime cannot insert into the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; INSERT INTO bootstrap_fixture.schema_migrations(version) VALUES ('runtime-forbidden');"
expect_permission_denied "runtime cannot update the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; UPDATE bootstrap_fixture.schema_migrations SET version = 'runtime-forbidden';"
expect_permission_denied "runtime cannot delete from the migration ledger" \
  "SET SESSION AUTHORIZATION iam_app_runtime_login; DELETE FROM bootstrap_fixture.schema_migrations;"

echo "PASS: all PostgreSQL 18 bootstrap negative tests passed"

echo "Running IAM migration through the dedicated migrator role chain..."
{
  printf '%s\\n' \
    'SET SESSION AUTHORIZATION iam_migrator_login;' \
    'SET ROLE iam_migrator;' \
    'SET ROLE iam_owner;'
  cat database/migrations/0001_initial_iam_schema.sql
} | psql_in_service -v ON_ERROR_STOP=1
echo "PASS: IAM migration executed as iam_owner through migrator chain"

psql_in_service -v ON_ERROR_STOP=1 < database/tests/0001_schema_contract.sql
echo "PASS: IAM schema ownership, RLS FORCE, tenant FK, audit identity, and default-deny contracts"
