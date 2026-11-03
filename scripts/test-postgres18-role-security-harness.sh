#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:=127.0.0.1}"
: "${PGPORT:=5432}"
: "${PGUSER:=postgres}"
: "${PGDATABASE:=postgres}"
: "${PGAPPNAME:?PGAPPNAME must identify the disposable role-security harness}"
: "${PGPASSWORD:?PGPASSWORD must be set to a disposable CI-only password}"

if [[ "$PGHOST" != "127.0.0.1" || "$PGPORT" != "5432" || "$PGUSER" != "postgres" || "$PGDATABASE" != "postgres" || "$PGAPPNAME" != "postgres18-role-security-disposable" ]]; then
  echo "::error::Refusing non-disposable PostgreSQL target; expected local PostgreSQL 18 service defaults and harness application_name."
  exit 1
fi

export PGHOST PGPORT PGUSER PGDATABASE PGAPPNAME PGPASSWORD
psql_base=(psql -X -v ON_ERROR_STOP=1 -P pager=off)

server_version="$("${psql_base[@]}" -Atqc 'SHOW server_version;')"
case "$server_version" in
  18.*) echo "PostgreSQL server version: $server_version" ;;
  *) echo "::error::Expected PostgreSQL 18; received $server_version"; exit 1 ;;
esac

preflight="$("${psql_base[@]}" -Atqc "SELECT current_database() || '|' || session_user || '|' || current_setting('application_name');")"
if [[ "$preflight" != "postgres|postgres|postgres18-role-security-disposable" ]]; then
  echo "::error::Refusing unexpected server identity: $preflight"
  exit 1
fi

"${psql_base[@]}" -c 'CREATE DATABASE iam_role_harness;' postgres
export PGDATABASE=iam_role_harness

"${psql_base[@]}" -f role-security-harness/sql/00_fixture.sql
"${psql_base[@]}" -f role-security-harness/sql/10_assertions.sql

expect_sqlstate() {
  local label="$1" expected="$2" sql="$3" output
  if output="$("${psql_base[@]}" -v VERBOSITY=verbose -c "$sql" 2>&1)"; then
    echo "::error::Expected SQLSTATE $expected but statement succeeded: $label"; exit 1
  fi
  if ! grep -Fq "$expected" <<<"$output"; then
    echo "::error::Expected SQLSTATE $expected for $label"
    printf '%s\n' "$output"; exit 1
  fi
  echo "PASS local $label (SQLSTATE $expected)"
}

chain_output="$("${psql_base[@]}" -Atq -c "
  SET SESSION AUTHORIZATION iam_migrator_login;
  SET ROLE iam_migrator;
  SELECT session_user || '|' || current_user;
  SET ROLE iam_owner;
  SELECT session_user || '|' || current_user;
  RESET ROLE;
  RESET SESSION AUTHORIZATION;
")"
expected_chain=$'iam_migrator_login|iam_migrator\niam_migrator_login|iam_owner'
if [[ "$chain_output" != "$expected_chain" ]]; then
  echo "::error::Unexpected migrator role-assumption chain:"
  printf '%s\n' "$chain_output"; exit 1
fi
echo "PASS local ROLE-10 migrator SET ROLE chain preserves session_user/current_user"

expect_sqlstate "ROLE-11 runtime cannot SET ROLE iam_owner" "42501" "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_owner;"
expect_sqlstate "ROLE-12 runtime cannot SET ROLE iam_migrator" "42501" "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_migrator;"
expect_sqlstate "ROLE-13 runtime cannot SET ROLE iam_app_runtime when SET is false" "42501" "SET SESSION AUTHORIZATION iam_app_runtime_login; SET ROLE iam_app_runtime;"
