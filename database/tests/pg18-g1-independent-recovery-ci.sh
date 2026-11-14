#!/usr/bin/env bash
# Only synthetic PostgreSQL 18 CI, never Neon.
set -Eeuo pipefail
umask 077
readonly origin='postgresql://postgres@localhost:5432/iam_source_restore_test'
readonly destination='postgresql://postgres@localhost:5432/peos_g1_recovery_verify'
readonly role=peos_g1_recovery_reader
readonly schema=peos_g1_recovery
readonly db=peos_g1_recovery_verify
if [[ "$DATABASE_URL" != "$origin" || -z "$PGPASSWORD" ]]; then
  echo BLOCKED_G1_SYNTHETIC_ONLY >&2; exit 2
fi
for binary in psql pg_dump pg_restore pg_dumpall grep mktemp; do
  command -v "$binary" >/dev/null || exit 127
done
psql_origin() { psql -X -w -v ON_ERROR_STOP=1 "$origin" "$@"; }
psql_dest() { psql -X -w -v ON_ERROR_STOP=1 "$destination" "$@"; }
identity="$(psql_origin -Atc "SELECT current_user || '|' || current_database() || '|' || current_setting('server_version_num')")"
if [[ ! "$identity" =~ ^postgres\|iam_source_restore_test\|18[0-9]{4}$ ]]; then
  echo BLOCKED_G1_SYNTHETIC_WRONG_IDENTITY >&2; exit 3
fi
collision="$(psql_origin -Atc "SELECT
  (SELECT count(*) FROM pg_roles WHERE rolname='$role') +
  (SELECT count(*) FROM pg_namespace WHERE nspname='$schema') +
  (SELECT count(*) FROM pg_database WHERE datname='$db')")"
if [[ "$collision" != 0 ]]; then
  echo BLOCKED_G1_SYNTHETIC_COLLISION >&2; exit 4
fi
scratch="$(mktemp -d)"
role_created=0
schema_created=0
db_created=0
cleanup() {
  local result=$?
  trap - EXIT
  if [[ "$db_created" == 1 ]]; then
    psql_origin -qc "DROP DATABASE $db WITH (FORCE)" >/dev/null 2>&1 || result=91
  fi
  if [[ "$schema_created" == 1 ]]; then
    psql_origin -qc "DROP SCHEMA $schema CASCADE" >/dev/null 2>&1 || result=92
  fi
  if [[ "$role_created" == 1 ]]; then
    psql_origin -qc "DROP ROLE $role" >/dev/null 2>&1 || result=93
  fi
  local remainder
  remainder="$(psql_origin -Atc "SELECT
    (SELECT count(*) FROM pg_roles WHERE rolname='$role') +
    (SELECT count(*) FROM pg_namespace WHERE nspname='$schema') +
    (SELECT count(*) FROM pg_database WHERE datname='$db')")" || result=94
  if [[ "$remainder" != 0 ]]; then result=95; fi
  rm -rf "$scratch"
  if [[ "$result" == 0 ]]; then
    echo PASS_G1_PG18_RECOVERY_FIXTURE_CLEANUP
  else
    echo BLOCKED_G1_PG18_RECOVERY_CLEANUP >&2
  fi
  exit "$result"
}
trap cleanup EXIT

psql_origin -qc "CREATE ROLE $role NOLOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION"
role_created=1
psql_origin -q <<'SQL'
CREATE SCHEMA peos_g1_recovery;
REVOKE ALL ON SCHEMA peos_g1_recovery FROM PUBLIC;
GRANT USAGE ON SCHEMA peos_g1_recovery TO peos_g1_recovery_reader;
CREATE TABLE peos_g1_recovery.synthetic_document (
  id bigint PRIMARY KEY, label text NOT NULL
);
INSERT INTO peos_g1_recovery.synthetic_document VALUES
  (1,'G1_CI_BASELINE'),(2,'G1_CI_RECOVERY');
GRANT SELECT ON peos_g1_recovery.synthetic_document TO peos_g1_recovery_reader;
ALTER TABLE peos_g1_recovery.synthetic_document ENABLE ROW LEVEL SECURITY;
ALTER TABLE peos_g1_recovery.synthetic_document FORCE ROW LEVEL SECURITY;
CREATE POLICY read_synthetic ON peos_g1_recovery.synthetic_document
  FOR SELECT TO peos_g1_recovery_reader USING (id > 0);
SQL
schema_created=1
baseline="$(psql_origin -Atc "SELECT md5(string_agg(id::text || ':' || label, ',' ORDER BY id)) FROM $schema.synthetic_document")"
test -n "$baseline"
flags="$(psql_origin -Atc "SELECT rolcanlogin::text || ':' || rolinherit::text || ':' || rolbypassrls::text FROM pg_roles WHERE rolname='$role'")"
if [[ "$flags" != 'false:false:false' ]]; then
  echo BLOCKED_G1_SYNTHETIC_ROLE_ATTRIBUTES >&2; exit 5
fi

pg_dump -w --format=custom --schema="$schema" --file="$scratch/backup.dump" "$origin"
test -s "$scratch/backup.dump"
pg_restore --list "$scratch/backup.dump" > "$scratch/toc"
grep -Eq 'TABLE DATA.+synthetic_document' "$scratch/toc" || {
  echo BLOCKED_G1_BACKUP_NO_DATA >&2; exit 6;
}
grep -Eq 'POLICY.+read_synthetic' "$scratch/toc" || {
  echo BLOCKED_G1_BACKUP_NO_POLICY >&2; exit 7;
}
pg_dumpall --globals-only --no-role-passwords -w -f "$scratch/globals.sql"
grep -Fq "$role" "$scratch/globals.sql" || {
  echo BLOCKED_G1_BACKUP_NO_ROLE >&2; exit 8;
}
echo PASS_G1_PG18_BACKUP_SYNTHETIC_SCHEMA_DATA_GLOBALS

# Committed change in source must not appear in isolated recovered database.
psql_origin -qc "UPDATE $schema.synthetic_document SET label='G1_CI_CHANGED_AFTER_BACKUP' WHERE id=1"
changed="$(psql_origin -Atc "SELECT md5(string_agg(id::text || ':' || label, ',' ORDER BY id)) FROM $schema.synthetic_document")"
if [[ "$changed" == "$baseline" ]]; then
  echo BLOCKED_G1_NO_COMMITTED_CHANGE >&2; exit 9
fi
psql_origin -qc "CREATE DATABASE $db"
db_created=1
if ! pg_restore --exit-on-error --single-transaction -w --dbname="$destination" "$scratch/backup.dump" >"$scratch/restore.out" 2>"$scratch/restore.err"; then
  echo BLOCKED_G1_ISOLATED_RESTORE >&2; exit 10
fi
restored="$(psql_dest -Atc "SELECT md5(string_agg(id::text || ':' || label, ',' ORDER BY id)) FROM $schema.synthetic_document")"
if [[ "$restored" != "$baseline" || "$restored" == "$changed" ]]; then
  echo BLOCKED_G1_RECOVERED_CONTENT_MISMATCH >&2; exit 11
fi
contract="$(psql_dest -Atc "SELECT
  (SELECT count(*) FROM pg_policies WHERE schemaname='$schema' AND policyname='read_synthetic')::text || '|' ||
  (SELECT relforcerowsecurity::text FROM pg_class WHERE oid='$schema.synthetic_document'::regclass) || '|' ||
  has_schema_privilege('$role','$schema','USAGE')::text || '|' ||
  has_table_privilege('$role','$schema.synthetic_document','SELECT')::text || '|' ||
  (SELECT rolbypassrls::text FROM pg_roles WHERE rolname='$role')")"
if [[ "$contract" != '1|true|true|true|false' ]]; then
  echo BLOCKED_G1_RESTORED_ACL_RLS_MISMATCH >&2; exit 12
fi
echo PASS_G1_PG18_RECOVERY_INDEPENDENT_RESTORE
echo REVIEW_REQUIRED_SYNTHETIC_ONLY_NO_NEON_BACKUP_OR_ROLE_RESTORE
