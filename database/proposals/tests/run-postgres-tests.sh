#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${IAM_ALLOW_DISPOSABLE_DB_TESTS:-}" != "1" ]]; then
  echo "Refusing database tests: set IAM_ALLOW_DISPOSABLE_DB_TESTS=1 explicitly." >&2
  exit 64
fi
case "${PGHOST:-127.0.0.1}" in
  localhost|127.0.0.1|::1) ;;
  *) echo "Refusing database tests on non-loopback PGHOST=${PGHOST}." >&2; exit 64 ;;
esac
if [[ "${PGPORT:-5432}" != "5432" ]]; then
  echo "Refusing database tests on unexpected PGPORT=${PGPORT}." >&2
  exit 64
fi
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${PGDATABASE:-}" != "postgres" ]]; then
  echo "Refusing database tests outside the GitHub Actions ephemeral PostgreSQL service (PGDATABASE must be postgres)." >&2
  exit 64
fi

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"
export PGHOST="${PGHOST:-127.0.0.1}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-postgres}"
export PGPASSWORD="${PGPASSWORD:-postgres}"

psql_admin() {
  psql -X --host="${PGHOST}" --port="${PGPORT}" --username="${PGUSER}" --set=ON_ERROR_STOP=1 "$@"
}

# This script is designed for the ephemeral CI service. Recreate only named
# disposable databases and test-only roles on this loopback server.
for db in iam_migration_test iam_migration_failure_test; do
  psql_admin --dbname=postgres --command="DROP DATABASE IF EXISTS ${db} WITH (FORCE)" >/dev/null
done

psql_admin --dbname=postgres <<'SQL'
DROP ROLE IF EXISTS iam_runtime_test;
DROP ROLE IF EXISTS iam_app_runtime;
DROP ROLE IF EXISTS iam_migrator;
DROP ROLE IF EXISTS iam_owner;
CREATE ROLE iam_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE iam_app_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE iam_migrator NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE iam_runtime_test LOGIN PASSWORD 'test-only'
  NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
GRANT iam_app_runtime TO iam_runtime_test;
CREATE DATABASE iam_migration_test OWNER iam_owner;
CREATE DATABASE iam_migration_failure_test OWNER iam_owner;
SQL

MIGRATION="${ROOT}/database/proposals/0001-initial-iam-schema.sql"
APPLIER="${ROOT}/database/proposals/tests/apply-candidate.sh"
RUNTIME_TEST="${ROOT}/database/proposals/tests/0001-initial-iam-schema.test.sql"
EXPECTED_CHECKSUM="$(sha256sum -- "${MIGRATION}" | awk '{print $1}')"
TEST_LOG_A="$(mktemp)"
TEST_LOG_B="$(mktemp)"
BAD_MIGRATION="$(mktemp)"
DRIFT_MIGRATION="$(mktemp)"
trap 'rm -f "${TEST_LOG_A}" "${TEST_LOG_B}" "${BAD_MIGRATION}" "${DRIFT_MIGRATION}"' EXIT

echo "PostgreSQL server version:"
psql_admin --dbname=postgres --tuples-only --no-align --command='SHOW server_version'

echo "Applying in parallel to prove advisory-lock serialization..."
(
  IAM_ALLOW_DISPOSABLE_DB_TESTS=1 PGDATABASE=iam_migration_test MIGRATION_FILE="${MIGRATION}" \
    bash "${APPLIER}"
) >"${TEST_LOG_A}" 2>&1 &
PID_A=$!
(
  IAM_ALLOW_DISPOSABLE_DB_TESTS=1 PGDATABASE=iam_migration_test MIGRATION_FILE="${MIGRATION}" \
    bash "${APPLIER}"
) >"${TEST_LOG_B}" 2>&1 &
PID_B=$!

if ! wait "${PID_A}"; then
  cat "${TEST_LOG_A}" >&2
  cat "${TEST_LOG_B}" >&2
  exit 1
fi
if ! wait "${PID_B}"; then
  cat "${TEST_LOG_A}" >&2
  cat "${TEST_LOG_B}" >&2
  exit 1
fi
cat "${TEST_LOG_A}"
cat "${TEST_LOG_B}"
if ! grep -q 'IDEMPOTENCE: existing version and checksum match; skipping apply.' "${TEST_LOG_A}" "${TEST_LOG_B}"; then
  echo "Expected one concurrent invocation to skip via the verified ledger." >&2
  exit 1
fi

echo "Checking ledger checksum and effective runtime role attributes..."
LEDGER_CHECKSUM="$(psql_admin --dbname=iam_migration_test --tuples-only --no-align \
  --command="SELECT checksum FROM iam.schema_migrations WHERE version = '0001_initial_iam_schema'")"
if [[ "${LEDGER_CHECKSUM}" != "${EXPECTED_CHECKSUM}" ]]; then
  echo "Ledger checksum mismatch: expected ${EXPECTED_CHECKSUM}; got ${LEDGER_CHECKSUM}" >&2
  exit 1
fi

RUNTIME_FLAGS="$(psql_admin --dbname=iam_migration_test --tuples-only --no-align --command="
SELECT (
  NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole
  AND pg_has_role('iam_runtime_test', 'iam_app_runtime', 'MEMBER')
)
FROM pg_roles WHERE rolname = 'iam_runtime_test'")"
if [[ "${RUNTIME_FLAGS}" != "t" ]]; then
  echo "Runtime test login has unexpected attributes or is not a member of iam_app_runtime." >&2
  exit 1
fi

echo "Seeding two tenants and testing composite tenant integrity..."
psql_admin --dbname=iam_migration_test <<'SQL'
INSERT INTO app_private.tenant_context_keys (key_id, secret, active)
VALUES ('test-v1', decode(repeat('42', 32), 'hex'), true);

INSERT INTO iam.tenants (id, slug, name, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'tenant-a', 'Tenant A', 'active'),
  ('00000000-0000-0000-0000-000000000002', 'tenant-b', 'Tenant B', 'active');

INSERT INTO iam.identities (id, issuer, subject, email, display_name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'https://issuer.example/', 'subject-a', 'same@example.test', 'Test User A'),
  ('00000000-0000-0000-0000-000000000102', 'https://issuer.example/', 'subject-b', 'same@example.test', 'Test User B');

INSERT INTO iam.memberships (id, identity_id, tenant_id, status) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'active'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000002', 'active');

INSERT INTO iam.roles (id, tenant_id, role_key, display_name) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000001', 'admin', 'Tenant A Admin'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000002', 'admin', 'Tenant B Admin');

INSERT INTO iam.permissions (key, description) VALUES
  ('iam.control_center.read', 'Read IAM Control Center'),
  ('iam.production.deploy', 'Deploy production');

INSERT INTO iam.membership_roles (membership_id, role_id, tenant_id) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000002');

INSERT INTO iam.role_permissions (role_id, permission_key) VALUES
  ('00000000-0000-0000-0000-000000000301', 'iam.control_center.read'),
  ('00000000-0000-0000-0000-000000000302', 'iam.production.deploy');

INSERT INTO audit.events
  (id, tenant_id, actor_identity_id, actor_membership_id, event_key, outcome, metadata)
VALUES
  ('00000000-0000-0000-0000-000000000401',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000201',
   'fixture.seed', 'success', '{}'::jsonb),
  ('00000000-0000-0000-0000-000000000402',
   '00000000-0000-0000-0000-000000000002',
   '00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000202',
   'fixture.seed', 'success', '{}'::jsonb);

DO $composite_fk$
BEGIN
  BEGIN
    INSERT INTO iam.membership_roles (membership_id, role_id, tenant_id)
    VALUES (
      '00000000-0000-0000-0000-000000000201',
      '00000000-0000-0000-0000-000000000302',
      '00000000-0000-0000-0000-000000000001'
    );
    RAISE EXCEPTION 'cross-tenant membership-role assignment unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS: composite FKs reject membership A → role B';
  END;
END;
$composite_fk$;
SQL

make_context() {
  local tenant_id="$1"
  local identity_id="$2"
  local membership_id="$3"
  local expires_epoch="$4"
  local payload signature
  payload="test-v1|$tenant_id|$identity_id|$membership_id|$expires_epoch"
  signature="$(psql_admin --dbname=iam_migration_test --tuples-only --no-align \
    --command="SELECT pg_catalog.encode(public.hmac(pg_catalog.convert_to('$payload', 'UTF8'), secret, 'sha256'), 'hex') FROM app_private.tenant_context_keys WHERE key_id = 'test-v1' AND active = true")"
  printf '%s|%s' "$payload" "$signature"
}

NOW_EPOCH="$(date -u +%s)"
TENANT_A_CONTEXT="$(make_context '00000000-0000-0000-0000-000000000001' '00000000-0000-0000-0000-000000000101' '00000000-0000-0000-0000-000000000201' "$((NOW_EPOCH + 60))")"
TENANT_B_CONTEXT="$(make_context '00000000-0000-0000-0000-000000000002' '00000000-0000-0000-0000-000000000102' '00000000-0000-0000-0000-000000000202' "$((NOW_EPOCH + 60))")"
EXPIRED_CONTEXT="$(make_context '00000000-0000-0000-0000-000000000001' '00000000-0000-0000-0000-000000000101' '00000000-0000-0000-0000-000000000201' "$((NOW_EPOCH - 60))")"
LONG_LIVED_CONTEXT="$(make_context '00000000-0000-0000-0000-000000000001' '00000000-0000-0000-0000-000000000101' '00000000-0000-0000-0000-000000000201' "$((NOW_EPOCH + 3600))")"

echo "Running signed-context tests over an actual disposable runtime LOGIN..."
PGUSER=iam_runtime_test PGPASSWORD=test-only PGDATABASE=iam_migration_test \
  psql -X --host="${PGHOST}" --port="${PGPORT}" \
    --set=ON_ERROR_STOP=1 \
    --set=tenant_a_context="${TENANT_A_CONTEXT}" \
    --set=tenant_b_context="${TENANT_B_CONTEXT}" \
    --set=expired_context="${EXPIRED_CONTEXT}" \
    --set=long_lived_context="${LONG_LIVED_CONTEXT}" \
    --file="${RUNTIME_TEST}"

echo "Testing changed-checksum refusal..."
printf '\n-- deliberate checksum drift for negative test only\n' > "${DRIFT_MIGRATION}"
cat "${MIGRATION}" >> "${DRIFT_MIGRATION}"
if IAM_ALLOW_DISPOSABLE_DB_TESTS=1 PGDATABASE=iam_migration_test MIGRATION_FILE="${DRIFT_MIGRATION}" \
  bash "${APPLIER}" >"${TEST_LOG_A}" 2>&1; then
  echo "Checksum drift was not rejected." >&2
  cat "${TEST_LOG_A}" >&2
  exit 1
fi
grep -q 'different checksum' "${TEST_LOG_A}"
echo "PASS: changed checksum rejected."

echo "Testing failed-apply rollback and forward recovery..."
cp "${MIGRATION}" "${BAD_MIGRATION}"
printf '\nSELECT 1 / 0; -- injected failure after all proposal DDL\n' >> "${BAD_MIGRATION}"
if IAM_ALLOW_DISPOSABLE_DB_TESTS=1 PGDATABASE=iam_migration_failure_test MIGRATION_FILE="${BAD_MIGRATION}" \
  bash "${APPLIER}" >"${TEST_LOG_A}" 2>&1; then
  echo "Injected failure unexpectedly succeeded." >&2
  cat "${TEST_LOG_A}" >&2
  exit 1
fi

ROLLBACK_STATE="$(psql_admin --dbname=iam_migration_failure_test --tuples-only --no-align --command="
SELECT (
  to_regnamespace('iam') IS NULL
  AND to_regnamespace('audit') IS NULL
  AND to_regnamespace('app_private') IS NULL
  AND to_regclass('iam.schema_migrations') IS NULL
)")"
if [[ "${ROLLBACK_STATE}" != "t" ]]; then
  echo "Injected failure left schema objects behind; atomic rollback failed." >&2
  exit 1
fi
echo "PASS: injected DDL failure rolled back all candidate schema objects."

IAM_ALLOW_DISPOSABLE_DB_TESTS=1 PGDATABASE=iam_migration_failure_test MIGRATION_FILE="${MIGRATION}" \
  bash "${APPLIER}"
RECOVERY_CHECK="$(psql_admin --dbname=iam_migration_failure_test --tuples-only --no-align \
  --command="SELECT count(*) = 1 FROM iam.schema_migrations WHERE version = '0001_initial_iam_schema'")"
if [[ "${RECOVERY_CHECK}" != "t" ]]; then
  echo "Forward recovery did not create exactly one baseline ledger row." >&2
  exit 1
fi
echo "PASS: valid proposal recovered successfully after failed transaction."

{
  echo "## Database proposal test evidence"
  echo
  echo "- Reviewed Git SHA: ${REVIEWED_SHA:-${GITHUB_SHA:-unavailable}}"
  echo "- Candidate: database/proposals/0001-initial-iam-schema.sql"
  echo "- Candidate SHA-256: ${EXPECTED_CHECKSUM}"
  echo "- PostgreSQL: $(psql_admin --dbname=iam_migration_test --tuples-only --no-align --command='SHOW server_version')"
  echo "- Empty apply, checksum ledger, concurrent/idempotent apply, checksum drift refusal, injected-failure rollback, and forward recovery: **PASS**."
  echo "- Composite tenant FK and disposable real-login RLS tests: **PASS**."
  echo "- Signed-context HMAC, tampering/expiry rejection, plain-GUC spoof resistance, and runtime key-table denial: **PASS in disposable prototype only**; real secret provisioning and application signing remain unverified."
  echo "- No shared Neon database was used; this test ran only on a loopback PostgreSQL service."
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

echo "DATABASE PROPOSAL TESTS PASSED; review/security approval remains BLOCKED."
