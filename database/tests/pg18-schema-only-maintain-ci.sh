#!/usr/bin/env bash
# PEOS: isolated PG18 experiment; NEVER run this script against Neon.
# Empirically check whether a NOLOGIN/NOBYPASSRLS role with schema USAGE and
# table MAINTAIN (not SELECT) can create a schema-only pg_dump archive.
# MAINTAIN allows powerful maintenance and locks; a PASS is NOT grant approval.
set -Eeuo pipefail
umask 077

readonly expected_url='postgresql://postgres@localhost:5432/iam_source_restore_test'
if [[ "${DATABASE_URL:-}" != "$expected_url" || -z "${PGPASSWORD:-}" ]]; then
  echo 'BLOCKED_PG18_SYNTHETIC_ONLY: not the disposable localhost test database' >&2
  exit 2
fi
for binary in psql pg_dump pg_restore mktemp grep; do
  command -v "$binary" >/dev/null || exit 127
done
identity="$(psql -X -w -At -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "SELECT current_user || '|' || current_database() || '|' || current_setting('server_version_num')")"
if [[ ! "$identity" =~ ^postgres\|iam_source_restore_test\|18[0-9]{4}$ ]]; then
  echo 'BLOCKED_PG18_SYNTHETIC_ONLY: wrong role, database, or server version' >&2
  exit 3
fi

readonly schema='peos_dump_probe'
readonly limited_role='peos_dump_probe_role'
# Refuse reuse of a colliding fixture, even in the disposable CI service.
collision="$(psql -X -w -At -v ON_ERROR_STOP=1 "$DATABASE_URL" -c \
  "SELECT (SELECT count(*) FROM pg_namespace WHERE nspname='$schema') + (SELECT count(*) FROM pg_roles WHERE rolname='$limited_role')")"
if [[ "$collision" != '0' ]]; then
  echo 'BLOCKED_PG18_SYNTHETIC_ONLY: test schema or role already exists' >&2
  exit 4
fi

scratch="$(mktemp -d)"
created=0
cleanup() {
  if [[ "$created" == 1 ]]; then
    psql -X -w -q -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL' >/dev/null 2>&1 || true
DROP SCHEMA IF EXISTS peos_dump_probe CASCADE;
DROP ROLE IF EXISTS peos_dump_probe_role;
SQL
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT

# Fixture only: no IAM tables, identities, personal data, credentials or Neon DB.
psql -X -w -q -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
CREATE ROLE peos_dump_probe_role NOLOGIN NOINHERIT NOBYPASSRLS
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE SCHEMA peos_dump_probe;
REVOKE ALL ON SCHEMA peos_dump_probe FROM PUBLIC;
GRANT USAGE ON SCHEMA peos_dump_probe TO peos_dump_probe_role;
CREATE TABLE peos_dump_probe.synthetic_record (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  synthetic_payload text NOT NULL
);
INSERT INTO peos_dump_probe.synthetic_record (synthetic_payload)
  VALUES ('CI_SYNTHETIC_ROW_NOT_A_SECRET');
ALTER TABLE peos_dump_probe.synthetic_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE peos_dump_probe.synthetic_record FORCE ROW LEVEL SECURITY;
CREATE POLICY peos_probe_denied ON peos_dump_probe.synthetic_record
  FOR SELECT TO PUBLIC USING (false);
SQL
created=1

# A role without SELECT or MAINTAIN must not be able to acquire the
# ACCESS SHARE lock pg_dump requires. No command dumps synthetic data here.
if pg_dump -w --role="$limited_role" --schema-only \
    --schema="$schema" --format=custom --lock-wait-timeout=2000 \
    --file="$scratch/without-maintain.dump" "$DATABASE_URL" \
    >/dev/null 2>"$scratch/baseline.err"; then
  echo 'BLOCKED_PG18_PROBE: schema dump unexpectedly worked without table rights' >&2
  exit 5
fi
if [[ -f "$scratch/without-maintain.dump" ]]; then
  rm -f "$scratch/without-maintain.dump"
fi
echo 'PASS_PG18_DENY_WITHOUT_LOCK_PRIVILEGE'

# PostgreSQL 18 LOCK documentation allows MAINTAIN to acquire ACCESS SHARE.
# This is a powerful maintenance capability, not a narrow LOCK-only grant.
psql -X -w -q -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
GRANT MAINTAIN ON ALL TABLES IN SCHEMA peos_dump_probe TO peos_dump_probe_role;
DO $guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname='peos_dump_probe_role'
      AND (rolcanlogin OR rolsuper OR rolbypassrls OR rolinherit)
  ) OR NOT has_table_privilege('peos_dump_probe_role',
          'peos_dump_probe.synthetic_record','MAINTAIN')
    OR has_table_privilege('peos_dump_probe_role',
          'peos_dump_probe.synthetic_record','SELECT')
    OR has_table_privilege('peos_dump_probe_role',
          'peos_dump_probe.synthetic_record','UPDATE')
    OR has_table_privilege('peos_dump_probe_role',
          'peos_dump_probe.synthetic_record','DELETE')
    OR has_table_privilege('peos_dump_probe_role',
          'peos_dump_probe.synthetic_record','TRUNCATE')
    OR EXISTS (
      SELECT 1 FROM pg_auth_members m
      JOIN pg_roles r ON r.oid=m.member
      WHERE r.rolname='peos_dump_probe_role'
    )
  THEN
    RAISE EXCEPTION 'synthetic privilege contract not met';
  END IF;
END $guard$;
SQL

# Verify a real permission-denied error, not merely a catalog flag.
# SET ROLE reduces privileges despite the postgres connection to the fixture.
if psql -X -w -q -v ON_ERROR_STOP=1 "$DATABASE_URL" \
  -c "SET ROLE peos_dump_probe_role; SELECT synthetic_payload FROM peos_dump_probe.synthetic_record" \
  >/dev/null 2>"$scratch/select.err"; then
  echo 'BLOCKED_PG18_PROBE: MAINTAIN principal unexpectedly read synthetic rows' >&2
  exit 6
fi
echo 'PASS_PG18_MAINTAIN_WITHOUT_DATA_SELECT'

pg_dump -w --role="$limited_role" --schema-only \
  --schema="$schema" --format=custom --lock-wait-timeout=2000 \
  --file="$scratch/maintain-only.dump" "$DATABASE_URL" \
  >/dev/null 2>"$scratch/dump.err" || {
    echo 'BLOCKED_PG18_MAINTAIN_SCHEMA_DUMP: insufficient schema-only permissions' >&2
    exit 7
  }
test -s "$scratch/maintain-only.dump"
pg_restore --list "$scratch/maintain-only.dump" > "$scratch/toc.txt"
if grep -Eq ' TABLE DATA | SEQUENCE SET | BLOB DATA ' "$scratch/toc.txt"; then
  echo 'BLOCKED_PG18_PROBE: schema-only archive included application data' >&2
  exit 8
fi

# A PG18 fixture success does not prove production least-privilege or RLS A/B.
echo 'PASS_PG18_MAINTAIN_ONLY_SCHEMA_DUMP_SYNTHETIC: no data exported'
echo 'REVIEW_REQUIRED: MAINTAIN also permits maintenance operations and stronger locks; no Neon grants authorized'
