#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# CI-only: run AFTER canonical source restore on the ephemeral PostgreSQL 18
# service. Refuse non-CI endpoints and any new/legacy Neon endpoint. The
# password is the existing ephemeral PostgreSQL service password, not a
# persistent credential and not an IAM production/Neon secret.
expected_url='postgresql://postgres@localhost:5432/iam_source_restore_test'
if [[ "${DATABASE_URL:-}" != "$expected_url" || -z "${PGPASSWORD:-}" ]]; then
  echo 'ERROR: CI runtime login contract only accepts local disposable PostgreSQL service.' >&2
  exit 2
fi

for cmd in psql; do
  command -v "$cmd" >/dev/null || exit 127
done

admin_user="$(psql -X --no-password "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT current_user || '|' || current_database() || '|' || current_setting('server_version_num');")"
if [[ "$admin_user" != 'postgres|iam_source_restore_test|'* ]]; then
  echo 'ERROR: unexpected PostgreSQL test administrator, database or server version.' >&2
  exit 3
fi
version="${admin_user##*|}"
if [[ ! "$version" =~ ^[0-9]+$ ]] || (( version < 180000 )); then
  echo 'ERROR: requires disposable PostgreSQL 18+' >&2
  exit 4
fi

existing="$(psql -X --no-password "$DATABASE_URL" -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT count(*) FROM pg_roles WHERE rolname = 'iam_app_runtime_login';")"
if [[ "$existing" != 0 ]]; then
  echo 'ERROR: unexpected pre-existing CI runtime login.' >&2
  exit 5
fi

echo '[ci-runtime-login] provisioning a new non-admin LOGIN in disposable PostgreSQL'
# \getenv reads the ephemeral password without putting it in CLI argv, files or
# repo. \unset removes the psql variable after the password is set.
psql -X --no-password "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
\getenv app_pass PGPASSWORD
CREATE ROLE iam_app_runtime_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE iam_app_runtime_login PASSWORD :'app_pass';
\unset app_pass
GRANT iam_app_runtime TO iam_app_runtime_login WITH INHERIT TRUE, SET FALSE;
REVOKE TEMPORARY ON DATABASE iam_source_restore_test FROM PUBLIC;
SQL

runtime_url='postgresql://iam_app_runtime_login@localhost:5432/iam_source_restore_test'
echo '[ci-runtime-login] authenticating as the actual LOGIN principal (new connection)'
psql -X --no-password "$runtime_url" -v ON_ERROR_STOP=1 \
  -f database/tests/ci-runtime-login-gate.sql
echo 'PASS: CI runtime network LOGIN privilege and fail-closed RLS contract'
