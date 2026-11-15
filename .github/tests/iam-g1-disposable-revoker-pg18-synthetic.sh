#!/usr/bin/env bash
# PostgreSQL 18 real fixture, --network none. Never connect to Neon.
set -euo pipefail
umask 077
container="iam-g1-revoke-pg18-$$"
tmp="$(mktemp -d)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$tmp"; }
trap cleanup EXIT

docker run --rm -d --name "$container" --network none \
  -e POSTGRES_PASSWORD=SYNTHETIC_CI_ONLY postgres:18-bookworm >/dev/null
for i in $(seq 1 50); do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U postgres -d postgres <<'SQL'
CREATE ROLE iam_schema_export_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOINHERIT;
CREATE ROLE iam_runtime_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE neondb_owner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE DATABASE iam_database OWNER neondb_owner;
SQL

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U neondb_owner -d iam_database <<'SQL'
CREATE SCHEMA iam;
CREATE SCHEMA audit;
CREATE SCHEMA app_private;
DO $fixture$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY[
  'access_policies','api_keys','group_memberships','group_roles','groups',
  'idempotency_keys','identities','identity_providers','invitations',
  'membership_roles','memberships','organizations','permissions',
  'role_permissions','roles','schema_migrations','security_events',
  'service_accounts','sessions','tenants'] LOOP
   EXECUTE format('CREATE TABLE iam.%I (id int PRIMARY KEY, tenant text NOT NULL)', t);
   IF t NOT IN ('permissions','schema_migrations') THEN
     EXECUTE format('ALTER TABLE iam.%I ENABLE ROW LEVEL SECURITY', t);
     EXECUTE format('ALTER TABLE iam.%I FORCE ROW LEVEL SECURITY', t);
   END IF;
 END LOOP;
END $fixture$;
CREATE TABLE audit.events (id int PRIMARY KEY, tenant text);
CREATE TABLE audit.outbox (id int PRIMARY KEY, tenant text);
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.outbox FORCE ROW LEVEL SECURITY;
CREATE TABLE app_private.context_keys (id text PRIMARY KEY, secret bytea);
INSERT INTO app_private.context_keys VALUES ('fixture',decode('66616b65','hex'));
CREATE VIEW iam.v_effective_membership_permissions AS SELECT id,tenant FROM iam.memberships;
CREATE SEQUENCE audit.events_id_seq;
CREATE SEQUENCE audit.outbox_id_seq;
CREATE SEQUENCE iam.security_events_id_seq;
CREATE POLICY tenant_only ON iam.tenants USING (tenant = current_setting('app.tenant',true));
CREATE POLICY membership_only ON iam.memberships USING (tenant = current_setting('app.tenant',true));
CREATE FUNCTION iam.clear_tenant_context() RETURNS text LANGUAGE sql
 SECURITY DEFINER SET search_path TO pg_catalog AS $$ SELECT 'synthetic'::text $$;
GRANT USAGE ON SCHEMA iam TO iam_runtime_test;
GRANT SELECT ON iam.tenants,iam.memberships TO iam_runtime_test;
SQL

# Fixture seed by synthetic postgres superuser: do not bypass FORCE RLS as the app owner.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U postgres -d iam_database <<'SQL'
INSERT INTO iam.tenants VALUES (1,'A'),(2,'B');
INSERT INTO iam.memberships VALUES (1,'A'),(2,'B');
SQL

python3 - <<'PY' > "$tmp/inventory.sql"
import importlib.util
s=importlib.util.spec_from_file_location("rev",".github/scripts/iam-g1-disposable-emergency-revoke.py")
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(m.INVENTORY)
PY
python3 - <<'PY' > "$tmp/revoke.sql"
import importlib.util
s=importlib.util.spec_from_file_location("rev",".github/scripts/iam-g1-disposable-emergency-revoke.py")
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
print(m.REVOKE_SQL)
PY

inventory() { docker exec -i "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d iam_database < "$tmp/inventory.sql" | tail -1; }
zero='G1_STATE|1|3|23|1|3|20|0|0|0|0|0'
lease='G1_STATE|1|3|23|1|3|20|3|24|0|0|0'
test "$(inventory)" = "$zero" || { echo 'BLOCKED_G1_PG18_BASELINE'; exit 2; }
echo 'PASS_G1_PG18_BRANCH_SHAPE_BASELINE'
if docker exec "$container" pg_dump -w -U iam_schema_export_reader -d iam_database \
  --schema-only --format=custom -n iam -n audit -n app_private \
  -f /tmp/g1-before.dump >/dev/null 2>&1; then
  echo 'BLOCKED_G1_PG18_PRELEASE_DUMP_ALLOWED'; exit 2
fi

runtime_check() {
  for tenant in A B; do
    got="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 \
      -U iam_runtime_test -d iam_database \
      -c "SET app.tenant TO '$tenant'; SELECT string_agg(tenant,',') FROM iam.tenants" | tail -1)"
    test "$got" = "$tenant" || { echo 'BLOCKED_G1_PG18_RLS_A_B'; exit 2; }
  done
  none="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 \
    -U iam_runtime_test -d iam_database -c 'SELECT count(*) FROM iam.tenants' | tail -1)"
  test "$none" = 0 || { echo 'BLOCKED_G1_PG18_RLS_NO_CONTEXT'; exit 2; }
}
runtime_check
echo 'PASS_G1_PG18_SYNTHETIC_RLS_A_B_NO_CONTEXT'

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U neondb_owner -d iam_database <<'SQL'
BEGIN;
GRANT USAGE ON SCHEMA iam,audit,app_private TO iam_schema_export_reader;
DO $grant$
DECLARE r record;
BEGIN
 FOR r IN SELECT n.nspname,c.relname FROM pg_class c
 JOIN pg_namespace n ON c.relnamespace=n.oid
 WHERE n.nspname IN ('iam','audit','app_private')
 AND c.relkind IN ('r','p','v') ORDER BY n.nspname,c.relname
 LOOP
  EXECUTE format('GRANT MAINTAIN ON TABLE %I.%I TO iam_schema_export_reader',
                 r.nspname,r.relname);
 END LOOP;
END $grant$;
COMMIT;
SQL
test "$(inventory)" = "$lease" || { echo 'BLOCKED_G1_PG18_LEASE_SHAPE'; exit 2; }
if docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U iam_schema_export_reader \
  -d iam_database -c "SELECT * FROM app_private.context_keys" >/dev/null 2>&1; then
  echo 'BLOCKED_G1_PG18_SECRET_SELECT'; exit 2
fi
test "$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U iam_schema_export_reader \
  -d iam_database -c 'SELECT iam.clear_tenant_context()' | tail -1)" = synthetic
echo 'PASS_G1_PG18_LEASE_NO_SELECT_DEFNER_SURFACE'

docker exec "$container" pg_dump -w -U iam_schema_export_reader -d iam_database \
  --schema-only --format=custom -n iam -n audit -n app_private \
  --lock-wait-timeout=5s -f /tmp/g1-schema-only.dump >/dev/null
docker exec "$container" pg_restore --list /tmp/g1-schema-only.dump > "$tmp/toc"
grep -Eq ' VIEW ' "$tmp/toc"
if grep -Eq 'TABLE DATA |BLOB DATA ' "$tmp/toc"; then
  echo 'BLOCKED_G1_PG18_ARCHIVE_HAS_DATA'; exit 2
fi
echo 'PASS_G1_PG18_SYNTHETIC_SCHEMA_ONLY_EXPORT'

# Independent privileged revoker connection; exact SQL pulled from proposed source.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U neondb_owner \
  -d iam_database < "$tmp/revoke.sql" >/dev/null
# New session after committed revocation must match 0 privileges including view.
test "$(inventory)" = "$zero" || { echo 'BLOCKED_G1_PG18_POSTCOMMIT_PARITY'; exit 2; }
if docker exec "$container" pg_dump -w -U iam_schema_export_reader -d iam_database \
  --schema-only --format=custom -n iam -n audit -n app_private \
  -f /tmp/g1-after.dump >/dev/null 2>&1; then
  echo 'BLOCKED_G1_PG18_POSTREVOKE_DUMP_ALLOWED'; exit 2
fi
if docker exec "$container" psql -X -q -v ON_ERROR_STOP=1 -U iam_schema_export_reader \
  -d iam_database -c 'SELECT iam.clear_tenant_context()' >/dev/null 2>&1; then
  echo 'BLOCKED_G1_PG18_POSTREVOKE_DEFINER_CALL'; exit 2
fi
runtime_check
echo 'PASS_G1_PG18_POSTCOMMIT_REVOKE_AND_RLS_UNCHANGED'
echo 'PASS_G1_PG18_DISPOSABLE_REVOKER_SYNTHETIC_FINAL_NO_NEON'
