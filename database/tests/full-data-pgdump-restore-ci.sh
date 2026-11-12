#!/usr/bin/env bash
# PEOS: REAL pg_dump -Fc -> pg_restore --single-transaction, synthetic IAM data.
# This is NOT a Neon backup, PITR test or an operator-approved production workflow.
set -Eeuo pipefail
umask 077
expected_source='postgresql://postgres@localhost:5432/iam_source_restore_test'
if [[ "${DATABASE_URL:-}" != "$expected_source" || -z "${PGPASSWORD:-}" ]]; then
  echo 'BLOCKED: this restore fixture is limited to localhost ephemeral PostgreSQL 18 CI' >&2
  exit 2
fi
for cmd in psql pg_dump pg_restore mktemp; do command -v "$cmd" >/dev/null || exit 127; done
identity="$(psql -X --no-password "$expected_source" -v ON_ERROR_STOP=1 -Atq -c "SELECT current_user || '|' || current_database() || '|' || current_setting('server_version_num')")"
if [[ ! "$identity" =~ ^postgres\|iam_source_restore_test\|18[0-9]{4}$ ]]; then
  echo 'BLOCKED: unexpected source role, database or PostgreSQL version' >&2
  exit 3
fi
target_db='iam_peos_restore_ci_target'
target_url="postgresql://postgres@localhost:5432/$target_db"
target_exists="$(psql -X --no-password "$expected_source" -v ON_ERROR_STOP=1 -Atq -c "SELECT count(*) FROM pg_database WHERE datname='$target_db'")"
if [[ "$target_exists" != 0 ]]; then
  echo 'BLOCKED: recovery fixture destination already exists' >&2
  exit 4
fi
scratch="$(mktemp -d)"
cleanup() {
  psql -X --no-password "$expected_source" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS $target_db WITH (FORCE)" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT
# Only a synthetic tenant is added to the disposable service DB. The FORCE RLS
# policies are deliberately left unchanged and checked in the restored copy.
psql -X --no-password "$expected_source" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $guard$
BEGIN
 IF current_database()<>'iam_source_restore_test' OR current_user<>'postgres'
    OR (SELECT count(*) FROM iam.tenants)<>0
    OR (SELECT count(*) FROM iam.schema_migrations)<>0
 THEN RAISE EXCEPTION 'refuse synthetic restore fixture: source state drifted';END IF;
END
$guard$;
INSERT INTO iam.tenants(id,slug,display_name)
 VALUES ('ac110000-1111-4111-8111-000000000001'::uuid,
         'peos-ci-restore','PEOS Synthetic Restore CI');
SQL
# Never print or upload the dump; remove even when pg_restore fails.
pg_dump --no-password --format=custom --file="$scratch/iam-ci.dump" "$expected_source"
test -s "$scratch/iam-ci.dump"
psql -X --no-password "$expected_source" -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $target_db TEMPLATE template0"
restore_start="$(date +%s)"
pg_restore --no-password --single-transaction --exit-on-error \
  --dbname="$target_url" "$scratch/iam-ci.dump"
restore_end="$(date +%s)"
# Compare only digests/counts in memory, never print the synthetic row or hash.
fingerprint_sql="SELECT
 (SELECT count(*) FROM iam.tenants)::text || '|' ||
 (SELECT count(*) FROM iam.schema_migrations)::text || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
    WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p'))::text || '|' ||
 (SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private'))::text || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private') AND c.relforcerowsecurity)::text || '|' ||
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')
      AND pg_get_userbyid(c.relowner)='iam_owner')::text || '|' ||
 (SELECT encode(digest(to_jsonb(t)::text,'sha256'),'hex')
  FROM iam.tenants t WHERE id='ac110000-1111-4111-8111-000000000001'::uuid)"
src="$(psql -X --no-password "$expected_source" -v ON_ERROR_STOP=1 -Atq -c "$fingerprint_sql")"
dst="$(psql -X --no-password "$target_url" -v ON_ERROR_STOP=1 -Atq -c "$fingerprint_sql")"
if [[ "$src" != "$dst" || "$dst" != "1|0|23|41|20|23|"* ]]; then
  echo 'BLOCKED: restored row, ownership, RLS, ledger or data fingerprint mismatch' >&2
  exit 5
fi
# Authenticate as the REAL disposable runtime LOGIN (not SET ROLE as postgres).
# Without tenant context, its restored FORCE RLS policy must deny the fixture.
runtime_url="postgresql://iam_app_runtime_login@localhost:5432/$target_db"
without_context="$(psql -X --no-password "$runtime_url" -v ON_ERROR_STOP=1 -Atq -c 'SELECT count(*) FROM iam.tenants')"
if [[ "$without_context" != 0 ]]; then
 echo 'BLOCKED: restored RLS permits runtime to see synthetic tenant without context' >&2
 exit 6
fi
echo "PASS: local PostgreSQL 18 full custom pg_dump/pg_restore, synthetic tenant data, 23 owned tables, 41 policies, 20 FORCE RLS, ledger unchanged, runtime deny"
echo "CI-only restore elapsed seconds: $((restore_end-restore_start)); NOT Neon RTO/RPO"
