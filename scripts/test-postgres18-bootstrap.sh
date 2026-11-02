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
  printf '%s\n' \
    'SET SESSION AUTHORIZATION iam_migrator_login;' \
    'SET ROLE iam_migrator;' \
    'SET ROLE iam_owner;'
  cat database/migrations/0001_initial_iam_schema.sql
} | psql_in_service -v ON_ERROR_STOP=1
echo "PASS: IAM migration executed as iam_owner through migrator chain"

psql_in_service -v ON_ERROR_STOP=1 < database/tests/0001_schema_contract.sql
echo "PASS: IAM schema ownership, RLS FORCE, tenant FK, audit identity, and default-deny contracts"


echo "Running the actual Neon Development role proposal as a non-superuser database owner..."

# Use a second disposable cluster because PostgreSQL roles are cluster-wide and
# the legacy bootstrap fixture above already creates roles with the same names.
proposal_container_name="iam-pg18-proposal-${GITHUB_RUN_ID:-local}-$$"
proposal_container_id="$(docker run -d --name "$proposal_container_name" -e POSTGRES_PASSWORD=disposable-ci-only postgres:18)"
trap 'cleanup; docker rm -f "$proposal_container_id" >/dev/null 2>&1 || true' EXIT

proposal_ready=false
for attempt in $(seq 1 60); do
  if docker exec "$proposal_container_id" pg_isready -h 127.0.0.1 -U postgres -d postgres >/dev/null 2>&1; then
    proposal_ready=true
    break
  fi
  sleep 1
done
if [[ "$proposal_ready" != "true" ]]; then
  echo "::error::Isolated proposal PostgreSQL 18 cluster did not become ready"
  docker logs "$proposal_container_id" || true
  exit 1
fi

psql_proposal_superuser() {
  docker exec -i "$proposal_container_id" psql -X -U postgres -d postgres "$@"
}

# Create a real LOGIN administrator and database. The proposal is then applied
# over TCP as that role; do not emulate identity with SET SESSION AUTHORIZATION.
psql_proposal_superuser -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE neon_superuser
  NOLOGIN INHERIT NOSUPERUSER CREATEDB CREATEROLE NOREPLICATION BYPASSRLS;
CREATE ROLE "Iam-control-center_owner"
  LOGIN INHERIT NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
GRANT neon_superuser TO "Iam-control-center_owner"
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
CREATE DATABASE "Iam-control-center" OWNER "Iam-control-center_owner";
SQL

# Trust is confined to loopback inside this disposable PostgreSQL container.
docker exec -u postgres "$proposal_container_id" sh -c \
  'sed -i "1ihost all all 127.0.0.1/32 trust" "$PGDATA/pg_hba.conf" && pg_ctl reload -D "$PGDATA"'

psql_as_admin() {
  docker exec -i "$proposal_container_id" psql -X -h 127.0.0.1 -U "Iam-control-center_owner" \
    -d "Iam-control-center" "$@"
}

psql_as_login() {
  local role="$1"
  shift
  docker exec -i "$proposal_container_id" psql -X -h 127.0.0.1 -U "$role" -d "Iam-control-center" "$@"
}

psql_as_admin -v ON_ERROR_STOP=1 < database/bootstrap/neon-development-roles.proposal.sql

psql_as_admin -v ON_ERROR_STOP=1 <<'SQL'
DO $proposal_assertions$
DECLARE
  membership record;
BEGIN
  IF current_database() <> 'Iam-control-center'
     OR session_user <> 'Iam-control-center_owner'
     OR current_user <> 'Iam-control-center_owner' THEN
    RAISE EXCEPTION 'Proposal did not execute as the expected real login/database owner';
  END IF;

  IF (SELECT rolsuper OR NOT rolcanlogin OR NOT rolinherit
             OR NOT rolcreatedb OR NOT rolcreaterole
             OR NOT rolreplication OR NOT rolbypassrls
      FROM pg_roles WHERE rolname = session_user) THEN
    RAISE EXCEPTION 'Disposable bootstrap administrator attributes are unexpected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_auth_members m
      JOIN pg_roles granted_role ON granted_role.oid = m.roleid
      JOIN pg_roles member_role ON member_role.oid = m.member
     WHERE granted_role.rolname = 'neon_superuser'
       AND member_role.rolname = session_user
       AND NOT m.admin_option
       AND m.inherit_option
       AND m.set_option
  ) THEN
    RAISE EXCEPTION 'Disposable bootstrap administrator membership does not match Neon';
  END IF;

  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('iam_owner','iam_migrator','iam_app_runtime')
        AND (rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) <> 0 THEN
    RAISE EXCEPTION 'Group role attributes do not match the proposal';
  END IF;

  IF (SELECT count(*) FROM pg_roles
      WHERE rolname IN ('iam_migrator_login','iam_app_runtime_login')
        AND (NOT rolcanlogin OR rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) <> 0 THEN
    RAISE EXCEPTION 'Login role attributes do not match the proposal';
  END IF;

  SELECT m.inherit_option, m.set_option, m.admin_option
    INTO membership
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE granted.rolname = 'iam_owner' AND member.rolname = 'iam_migrator';
  IF NOT FOUND OR membership.inherit_option OR NOT membership.set_option OR membership.admin_option THEN
    RAISE EXCEPTION 'iam_migrator -> iam_owner membership options are incorrect';
  END IF;

  SELECT m.inherit_option, m.set_option, m.admin_option
    INTO membership
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE granted.rolname = 'iam_migrator' AND member.rolname = 'iam_migrator_login';
  IF NOT FOUND OR membership.inherit_option OR NOT membership.set_option OR membership.admin_option THEN
    RAISE EXCEPTION 'iam_migrator_login -> iam_migrator membership options are incorrect';
  END IF;

  SELECT m.inherit_option, m.set_option, m.admin_option
    INTO membership
  FROM pg_auth_members m
  JOIN pg_roles granted ON granted.oid = m.roleid
  JOIN pg_roles member ON member.oid = m.member
  WHERE granted.rolname = 'iam_app_runtime' AND member.rolname = 'iam_app_runtime_login';
  IF NOT FOUND OR NOT membership.inherit_option OR membership.set_option OR membership.admin_option THEN
    RAISE EXCEPTION 'Runtime membership options are incorrect';
  END IF;

  IF NOT pg_has_role('iam_migrator_login', 'iam_migrator', 'SET')
     OR NOT pg_has_role('iam_migrator_login', 'iam_owner', 'SET') THEN
    RAISE EXCEPTION 'Migrator SET ROLE chain is incomplete';
  END IF;

  IF pg_has_role('iam_app_runtime_login', 'iam_owner', 'MEMBER')
     OR pg_has_role('iam_app_runtime_login', 'iam_migrator', 'MEMBER')
     OR pg_has_role('iam_app_runtime_login', 'iam_app_runtime', 'SET') THEN
    RAISE EXCEPTION 'Runtime has unintended membership or SET ROLE capability';
  END IF;

  IF NOT has_database_privilege('iam_owner', current_database(), 'CREATE')
     OR has_database_privilege('iam_migrator_login', current_database(), 'CREATE')
     OR has_database_privilege('iam_app_runtime_login', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'Database CREATE grant does not match the least-privilege proposal';
  END IF;

  IF has_schema_privilege('iam_app_runtime_login', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Runtime unexpectedly has CREATE on public schema';
  END IF;
END
$proposal_assertions$;
SQL

temp_privilege_result="$(psql_as_admin -Atq -v ON_ERROR_STOP=1 -c \
  "SELECT CASE WHEN has_database_privilege('iam_app_runtime_login', current_database(), 'TEMP') THEN 'PRESENT' ELSE 'ABSENT' END;")"
if [[ "$temp_privilege_result" != "PRESENT" ]]; then
  echo "::error::FAIL: expected the existing PUBLIC TEMP privilege to remain unchanged by role bootstrap"
  exit 1
fi
echo "PASS: role bootstrap leaves shared PUBLIC TEMP ACL unchanged"
echo "PENDING: runtime login is not approved for application/Vercel use until a separate TEMP ACL review is completed"

migrator_chain="$(psql_as_login iam_migrator_login -Atq -v ON_ERROR_STOP=1 -c \
  "SET ROLE iam_migrator; SELECT current_user; RESET ROLE; SET ROLE iam_owner; SELECT current_user;")"
if [[ "$migrator_chain" != $'iam_migrator\niam_owner' ]]; then
  echo "::error::Actual proposal migrator chain failed: $migrator_chain"
  exit 1
fi
echo "PASS: proposal migrator login can SET ROLE iam_migrator then iam_owner"

expect_proposal_denial() {
  local label="$1"
  local sql="$2"
  local output
  if output="$(psql_as_login iam_app_runtime_login -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -c "$sql" 2>&1)"; then
    echo "::error::Expected runtime permission denial but command succeeded: $label"
    exit 1
  fi
  if ! grep -Fq '42501' <<<"$output"; then
    echo "::error::Expected SQLSTATE 42501 for proposal runtime test: $label"
    printf '%s\n' "$output"
    exit 1
  fi
  echo "PASS (SQLSTATE 42501): proposal runtime cannot $label"
}

expect_proposal_denial "SET ROLE iam_owner" "SET ROLE iam_owner;"
expect_proposal_denial "SET ROLE iam_migrator" "SET ROLE iam_migrator;"
expect_proposal_denial "SET ROLE iam_app_runtime" "SET ROLE iam_app_runtime;"
expect_proposal_denial "CREATE in public" "CREATE TABLE public.runtime_forbidden(id integer);"

echo "PASS: actual Neon Development role proposal validated with a non-superuser LOGIN administrator"
