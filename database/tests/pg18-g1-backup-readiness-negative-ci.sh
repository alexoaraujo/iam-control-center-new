#!/usr/bin/env bash
# G1 behavioral gate. Only a disposable PG18 localhost GitHub Actions service.
set -Eeuo pipefail
umask 077
expected='postgresql://postgres@localhost:5432/iam_source_restore_test'
if [[ "${DATABASE_URL:-}" != "$expected" || -z "${PGPASSWORD:-}" ]]; then
  echo 'BLOCKED_G1_READINESS_CI_ONLY: isolated localhost service required' >&2
  exit 2
fi
identity="$(psql -X -w -Atq -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "SELECT current_user || '|' || current_database() || '|' || current_setting('server_version_num')")"
if [[ ! "$identity" =~ ^postgres\|iam_source_restore_test\|18[0-9]{4}$ ]]; then
  echo 'BLOCKED_G1_READINESS_CI_ONLY: wrong role/database/version' >&2; exit 3
fi
script='database/scripts/iam-g1-neon-backup-readiness.sql'
test -s "$script"
collision="$(psql -X -w -Atq -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
 "SELECT count(*) FROM pg_roles WHERE rolname IN ('iam_schema_export_reader','iam_migrator_login','iam_worker_login')")"
[[ "$collision" == 0 ]] || { echo 'BLOCKED_G1_FIXTURE_COLLISION' >&2; exit 4; }

fixture_created=0
cleanup() {
  if [[ "$fixture_created" == 1 ]]; then
    psql -X -w -q -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA iam,audit,app_private FROM iam_schema_export_reader;
REVOKE USAGE ON SCHEMA iam,audit,app_private FROM iam_schema_export_reader;
DROP ROLE iam_schema_export_reader;
REVOKE iam_migrator FROM iam_migrator_login;
DROP ROLE iam_migrator_login;
REVOKE iam_owner FROM iam_migrator;
REVOKE iam_worker FROM iam_worker_login;
DROP ROLE iam_worker_login;
SQL
    local residual
    residual="$(psql -X -w -Atq -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
      "SELECT count(*) FROM pg_roles WHERE rolname IN ('iam_schema_export_reader','iam_migrator_login','iam_worker_login')")"
    [[ "$residual" == 0 ]] || { echo 'BLOCKED_G1_FIXTURE_CLEANUP' >&2; return 1; }
    echo 'PASS_G1_READINESS_FIXTURE_CLEANUP'
  fi
}
trap cleanup EXIT

# CI fixture only; no Neon URLs, credentials, or user data.
psql -X -w -q -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
BEGIN;
CREATE ROLE iam_schema_export_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_migrator_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_worker_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT iam_owner TO iam_migrator WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_migrator TO iam_migrator_login WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
GRANT iam_worker TO iam_worker_login WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;
GRANT USAGE ON SCHEMA iam,audit,app_private TO iam_schema_export_reader;
GRANT MAINTAIN ON ALL TABLES IN SCHEMA iam,audit,app_private TO iam_schema_export_reader;
COMMIT;
SQL
fixture_created=1
readiness() {
  psql -X -w -Atq -F '|' -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$script"
}
assert_gate() {
  local label="$1" output="$2" expect_schema="$3" expect_roles="$4" expect_reader="$5"
  local db pg18 schema roles reader backup metrics
  IFS='|' read -r db pg18 schema roles reader backup metrics <<< "$output"
  if [[ "$db" != iam_source_restore_test || "$pg18" != PASS ||
        "$schema" != "$expect_schema" || "$roles" != "$expect_roles" ||
        "$reader" != "$expect_reader" || "$backup" != NOT_EVALUATED_NO_ARCHIVE_OR_RESTORE ||
        -z "$metrics" ]]; then
    echo "BLOCKED_G1_READINESS_$label" >&2
    return 1
  fi
  echo "PASS_G1_READINESS_$label"
}
mutate_with_rollback() {
  local statement="$1"
  psql -X -w -Atq -F '|' -v ON_ERROR_STOP=1 "$DATABASE_URL" <<SQL
BEGIN;
${statement}
\i ${script}
ROLLBACK;
SQL
}
baseline="$(readiness)"
assert_gate BASELINE "$baseline" PASS PASS PASS
mutated="$(mutate_with_rollback 'ALTER TABLE iam.tenants DISABLE ROW LEVEL SECURITY;')"
assert_gate RLS_DISABLED_DENIED "$mutated" BLOCKED PASS PASS
mutated="$(mutate_with_rollback 'GRANT iam_app_runtime TO iam_app_runtime_login WITH INHERIT FALSE, SET FALSE, ADMIN FALSE;')"
assert_gate RUNTIME_INHERIT_DENIED "$mutated" PASS BLOCKED PASS
mutated="$(mutate_with_rollback 'GRANT TRUNCATE ON TABLE iam.tenants TO iam_schema_export_reader;')"
assert_gate READER_TRUNCATE_DENIED "$mutated" PASS PASS BLOCKED
mutated="$(mutate_with_rollback 'GRANT CREATE ON SCHEMA iam TO iam_schema_export_reader;')"
assert_gate READER_CREATE_DENIED "$mutated" PASS PASS BLOCKED
mutated="$(mutate_with_rollback 'GRANT iam_migrator TO iam_schema_export_reader WITH INHERIT FALSE, SET FALSE, ADMIN FALSE;')"
assert_gate READER_MEMBERSHIP_DENIED "$mutated" PASS PASS BLOCKED
mutated="$(mutate_with_rollback 'ALTER ROLE iam_app_runtime_login NOLOGIN;')"
assert_gate RUNTIME_NOLOGIN_DENIED "$mutated" PASS BLOCKED PASS
mutated="$(mutate_with_rollback 'ALTER ROLE iam_worker_login BYPASSRLS;')"
assert_gate WORKER_BYPASSRLS_DENIED "$mutated" PASS BLOCKED PASS
mutated="$(mutate_with_rollback 'REVOKE iam_worker FROM iam_worker_login;')"
assert_gate WORKER_MEMBERSHIP_DENIED "$mutated" PASS BLOCKED PASS
mutated="$(mutate_with_rollback 'REVOKE iam_migrator FROM iam_migrator_login;')"
assert_gate MIGRATOR_MEMBERSHIP_DENIED "$mutated" PASS BLOCKED PASS
mutated="$(mutate_with_rollback 'REVOKE iam_owner FROM iam_migrator;')"
assert_gate MIGRATOR_OWNER_MEMBERSHIP_DENIED "$mutated" PASS BLOCKED PASS
mutated="$(mutate_with_rollback 'ALTER ROLE iam_schema_export_reader CREATEROLE;')"
assert_gate READER_CRTROLE_DENIED "$mutated" PASS PASS BLOCKED
[[ "$(readiness)" == "$baseline" ]] || { echo 'BLOCKED_G1_READINESS_POST_ROLLBACK' >&2; exit 9; }
echo 'PASS_G1_READINESS_POST_ROLLBACK_PARITY'
echo 'PASS_G1_READINESS_NEGATIVE_BEHAVIORAL_CI_ONLY'
