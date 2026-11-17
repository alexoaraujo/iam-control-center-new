#!/usr/bin/env bash
# PEOS G1: PostgreSQL 18 only, synthetic objects; never execute on Neon.
# Demonstrate MAINTAIN/USAGE lease, denial of SELECT/SET ROLE, and
# independent post-COMMIT revocation that restores the exact baseline.
set -Eeuo pipefail
umask 077

readonly expected_url='postgresql://postgres@localhost:5432/iam_source_restore_test'
if [[ "$DATABASE_URL" != "$expected_url" || -z "$PGPASSWORD" ]]; then
  echo 'BLOCKED_G1_SYNTHETIC_ONLY: disposable PG18 CI identity required' >&2
  exit 2
fi
for cmd in psql grep mktemp; do
  command -v "$cmd" >/dev/null || exit 127
done

psql_ci() {
  psql -X -w -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"
}
identity="$(psql_ci -At -c "SELECT current_user || '|' || current_database() || '|' || current_setting('server_version_num')")"
if [[ ! "$identity" =~ ^postgres\|iam_source_restore_test\|18[0-9]{4}$ ]]; then
  echo 'BLOCKED_G1_SYNTHETIC_ONLY: role, database or PG18 mismatch' >&2
  exit 3
fi
collision="$(psql_ci -At -c "
  SELECT
    (SELECT count(*) FROM pg_roles WHERE rolname IN
      ('peos_g1_export_reader','peos_g1_runtime_login','peos_g1_runtime')) +
    (SELECT count(*) FROM pg_namespace WHERE nspname IN
      ('peos_g1_iam','peos_g1_audit','peos_g1_private'))")"
if [[ "$collision" != '0' ]]; then
  echo 'BLOCKED_G1_SYNTHETIC_ONLY: fixture collision, refusing to reuse principals' >&2
  exit 4
fi

scratch="$(mktemp -d)"
created=0
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "$created" == 1 ]]; then
    # Cleanup is independent of the normal rollback and runs on failure too.
    if ! psql_ci -q >/dev/null 2>&1 <<'SQL'
BEGIN;
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private FROM peos_g1_export_reader;
REVOKE USAGE ON SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private FROM peos_g1_export_reader;
REVOKE peos_g1_runtime FROM peos_g1_runtime_login;
DROP SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private CASCADE;
DROP ROLE peos_g1_export_reader,peos_g1_runtime_login,peos_g1_runtime;
COMMIT;
SQL
    then
      echo 'BLOCKED_G1_FIXTURE_CLEANUP: synthetic privileges or roles may remain' >&2
      rm -rf "$scratch"
      exit 90
    fi
    local remain
    remain="$(psql_ci -At -c "
      SELECT (SELECT count(*) FROM pg_roles WHERE rolname IN
        ('peos_g1_export_reader','peos_g1_runtime_login','peos_g1_runtime')) +
        (SELECT count(*) FROM pg_namespace WHERE nspname IN
        ('peos_g1_iam','peos_g1_audit','peos_g1_private'))")" || exit 91
    if [[ "$remain" != '0' ]]; then
      echo 'BLOCKED_G1_FIXTURE_CLEANUP: leaked synthetic principal or schema' >&2
      rm -rf "$scratch"
      exit 92
    fi
    echo 'PASS_G1_PG18_FIXTURE_CLEANUP: zero synthetic principals and schemas'
  fi
  rm -rf "$scratch"
  exit "$result"
}
trap cleanup EXIT

# All fixtures are synthetic, transactionally created, and confined to PG18 CI.
psql_ci -q <<'SQL'
BEGIN;
CREATE ROLE peos_g1_export_reader LOGIN NOINHERIT NOBYPASSRLS
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE peos_g1_runtime NOLOGIN INHERIT NOBYPASSRLS
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE ROLE peos_g1_runtime_login LOGIN NOINHERIT NOBYPASSRLS
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT peos_g1_runtime TO peos_g1_runtime_login
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
CREATE SCHEMA peos_g1_iam;
CREATE SCHEMA peos_g1_audit;
CREATE SCHEMA peos_g1_private;
REVOKE ALL ON SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private FROM PUBLIC;
DO $fixture$
DECLARE i integer;
DECLARE schema_name text;
BEGIN
  FOR i IN 1..23 LOOP
    schema_name := CASE WHEN i <= 8 THEN 'peos_g1_iam'
                        WHEN i <= 16 THEN 'peos_g1_audit'
                        ELSE 'peos_g1_private' END;
    EXECUTE format(
      'CREATE TABLE %I.%I (id bigint PRIMARY KEY, synthetic_payload text NOT NULL)',
      schema_name, 'record_' || lpad(i::text, 2, '0')
    );
  END LOOP;
END
$fixture$;
INSERT INTO peos_g1_iam.record_01 VALUES (1, 'SYNTHETIC_NO_USER_DATA');
COMMIT;
SQL
created=1

# Include role options, membership options, table privileges and schema ACLs.
# A literal fingerprint comparison checks the state in *different sessions*
# before the temporary lease and after an independently committed revocation.
catalog_sql="$(cat <<'SQL'
SELECT concat_ws('|',
  (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('peos_g1_iam','peos_g1_audit','peos_g1_private')
      AND c.relkind='r'),
  (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('peos_g1_iam','peos_g1_audit','peos_g1_private')
      AND c.relkind='r'
      AND has_table_privilege('peos_g1_export_reader',c.oid,'MAINTAIN')),
  (SELECT count(*)::text FROM pg_namespace n
    WHERE n.nspname IN ('peos_g1_iam','peos_g1_audit','peos_g1_private')
      AND has_schema_privilege('peos_g1_export_reader',n.oid,'USAGE')),
  (SELECT count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('peos_g1_iam','peos_g1_audit','peos_g1_private')
      AND c.relkind='r'
      AND (has_table_privilege('peos_g1_export_reader',c.oid,'SELECT')
        OR has_table_privilege('peos_g1_export_reader',c.oid,'INSERT')
        OR has_table_privilege('peos_g1_export_reader',c.oid,'UPDATE')
        OR has_table_privilege('peos_g1_export_reader',c.oid,'DELETE')
        OR has_table_privilege('peos_g1_export_reader',c.oid,'TRUNCATE')
        OR has_table_privilege('peos_g1_export_reader',c.oid,'REFERENCES')
        OR has_table_privilege('peos_g1_export_reader',c.oid,'TRIGGER'))),
  (SELECT count(*)::text FROM pg_namespace n
    WHERE n.nspname IN ('peos_g1_iam','peos_g1_audit','peos_g1_private')
      AND has_schema_privilege('peos_g1_export_reader',n.oid,'CREATE')),
  (SELECT count(*)::text FROM pg_auth_members m
    JOIN pg_roles u ON u.oid=m.member
    WHERE u.rolname='peos_g1_export_reader'),
  (SELECT rolinherit::text FROM pg_roles WHERE rolname='peos_g1_runtime_login'),
  (SELECT admin_option::text || ':' || inherit_option::text || ':' || set_option::text
    FROM pg_auth_members m
    JOIN pg_roles u ON u.oid=m.member
    JOIN pg_roles v ON v.oid=m.roleid
    WHERE u.rolname='peos_g1_runtime_login' AND v.rolname='peos_g1_runtime'),
  (SELECT (NOT rolbypassrls AND NOT rolsuper AND rolcanlogin)::text
    FROM pg_roles WHERE rolname='peos_g1_export_reader')
)
SQL
)"
catalog() { psql_ci -At -c "$catalog_sql"; }
baseline="$(catalog)"
readonly expected_initial='23|0|0|0|0|0|false|false:true:true|true'
if [[ "$baseline" != "$expected_initial" ]]; then
  echo 'BLOCKED_G1_PG18_BASELINE: synthetic catalog differs before lease' >&2
  exit 5
fi
echo 'PASS_G1_PG18_BASELINE: 23 tables, no reader grants, non-bypass login'

# COMMIT intentionally persists the synthetic privilege lease to demonstrate
# that a crash/restart cannot rely on rolling back the *first* transaction.
psql_ci -q <<'SQL'
BEGIN;
GRANT USAGE ON SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private TO peos_g1_export_reader;
GRANT MAINTAIN ON ALL TABLES IN SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private TO peos_g1_export_reader;
ALTER ROLE peos_g1_runtime_login INHERIT;
GRANT peos_g1_runtime TO peos_g1_runtime_login
  WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
COMMIT;
SQL
during="$(catalog)"
readonly expected_during='23|23|3|0|0|0|true|false:true:false|true'
if [[ "$during" != "$expected_during" ]]; then
  echo 'BLOCKED_G1_PG18_LEASE: wrong privileges or runtime role flags' >&2
  exit 6
fi
echo 'PASS_G1_PG18_LEASE_AFTER_COMMIT: MAINTAIN=23/23, USAGE=3/3, SELECT/DML=0'

# Prove actual denial under the reader identity; no application rows accessed.
if psql_ci -q -c \
    "SET SESSION AUTHORIZATION peos_g1_export_reader; SELECT synthetic_payload FROM peos_g1_iam.record_01" \
    >"$scratch/read.out" 2>"$scratch/read.err"; then
  echo 'BLOCKED_G1_PG18_READER_READ: MAINTAIN principal unexpectedly read data' >&2
  exit 7
fi
if ! grep -qi 'permission denied' "$scratch/read.err"; then
  echo 'BLOCKED_G1_PG18_READER_READ: denial reason was not privilege restriction' >&2
  exit 8
fi
echo 'PASS_G1_PG18_READER_SELECT_DENIED'

# Runtime must not be able to SET the group role while canonical SET=false.
if psql_ci -q -c \
    "SET SESSION AUTHORIZATION peos_g1_runtime_login; SET ROLE peos_g1_runtime" \
    >"$scratch/set.out" 2>"$scratch/set.err"; then
  echo 'BLOCKED_G1_PG18_RUNTIME_ESCALATION: SET ROLE unexpectedly succeeded' >&2
  exit 9
fi
echo 'PASS_G1_PG18_RUNTIME_SET_ROLE_DENIED'

# Independent psql connection commits the inverse after the lease COMMIT.
# This proves the revoker need not share a session/savepoint with the issuer.
psql_ci -q <<'SQL'
BEGIN;
REVOKE MAINTAIN ON ALL TABLES IN SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private FROM peos_g1_export_reader;
REVOKE USAGE ON SCHEMA peos_g1_iam,peos_g1_audit,peos_g1_private FROM peos_g1_export_reader;
ALTER ROLE peos_g1_runtime_login NOINHERIT;
GRANT peos_g1_runtime TO peos_g1_runtime_login
  WITH ADMIN FALSE, INHERIT TRUE, SET TRUE;
COMMIT;
SQL

# A new independent connection checks exact round-trip, not just zero rows.
after="$(catalog)"
if [[ "$after" != "$baseline" ]]; then
  echo 'BLOCKED_G1_PG18_POSTCOMMIT_REVOCATION: catalog differs from baseline' >&2
  exit 10
fi
echo 'PASS_G1_PG18_POSTCOMMIT_REVOCATION: independent COMMIT restored exact baseline'
echo 'REVIEW_REQUIRED: synthetic PG18 proof only; Neon grant/restore/rollback remain unauthorized'
