#!/usr/bin/env bash
# Only the independent disposable PG18 service declared in database-tests.yml.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]]
[[ "${DATABASE_URL:-}" == "postgresql://postgres@localhost:5432/iam_schema_test" ]]
[[ "${MIGRATOR_DATABASE_URL:-}" == "postgresql://iam_migrator_login@localhost:5432/iam_schema_test" ]]
: "${POSTGRES_TEST_PASSWORD:?}"
export MIGRATOR_TEST_PASSWORD="$(openssl rand -hex 32)"
# Keep libpq configuration isolated from any inherited PG* settings.
admin() {
  env -i PATH="$PATH" LC_ALL=C PGPASSWORD="$POSTGRES_TEST_PASSWORD" PGCONNECT_TIMEOUT=5 \
    psql -X -w -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"
}
admin -f database/tests/role-reconciliation-fixture/reconcile-and-test.sql
# Existing exact canonical graph diagnostic must pass on the committed fixture.
result="$(admin -f database/scripts/iam-g1-role-parity-readonly.sql)"
[[ "$result" == *'|t' ]] || { echo 'BLOCKED_ROLE_GRAPH_READBACK' >&2; exit 1; }
# Provision just the local fixture migrator credential; never print its value.
env -i PATH="$PATH" LC_ALL=C PGPASSWORD="$POSTGRES_TEST_PASSWORD" PGCONNECT_TIMEOUT=5 MIGRATOR_TEST_PASSWORD="$MIGRATOR_TEST_PASSWORD" \
  psql -X -w -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
\getenv migration_password MIGRATOR_TEST_PASSWORD
ALTER ROLE iam_migrator_login PASSWORD :'migration_password';
SQL
# Use the existing real authenticated migration runner, unchanged.
bash database/tests/migration-runner-fixture/test.sh
echo 'PASS: declarative partial role graph, exact memberships/ACLs/owners/RLS, idempotency, rollback, authenticated migration runner integration'
