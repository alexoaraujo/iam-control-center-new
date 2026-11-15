#!/usr/bin/env bash
# Offline PostgreSQL 18 privilege lease rehearsal, entirely inside ephemeral CI Docker.
# NEVER connect to Neon or use GitHub protected environments/secrets.
set -euo pipefail
umask 077
container="iam-g1-pg18-synthetic"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --rm --name "$container" --network none \
  --env POSTGRES_PASSWORD=SYNTHETIC_TEST_ONLY_NOT_A_SECRET \
  postgres:18-bookworm >/dev/null
ready=0
for i in $(seq 1 45); do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  echo "::error::BLOCKED_PG18_SYNTHETIC_STARTUP"
  exit 2
fi
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U postgres -d postgres >/dev/null <<'SQL'
CREATE ROLE iam_schema_export_reader LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE ROLE iam_runtime_test LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
CREATE DATABASE iam_database;
SQL

docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U postgres -d iam_database >/dev/null <<'SQL'
CREATE SCHEMA iam;
CREATE SCHEMA audit;
CREATE SCHEMA app_private;
CREATE TABLE iam.tenant_demo(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant text NOT NULL);
INSERT INTO iam.tenant_demo(tenant) VALUES ('A'),('B');
ALTER TABLE iam.tenant_demo ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.tenant_demo FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON iam.tenant_demo
  USING (tenant = current_setting('app.tenant', true));
CREATE VIEW iam.tenant_view AS SELECT id,tenant FROM iam.tenant_demo;
CREATE TABLE audit.audit_event(id bigint PRIMARY KEY);
CREATE TABLE app_private.context_keys(key_id text PRIMARY KEY, secret bytea NOT NULL);
INSERT INTO app_private.context_keys VALUES ('synthetic', decode('73696d756c61746564','hex'));
CREATE FUNCTION iam.synthetic_definer() RETURNS text LANGUAGE sql
  SECURITY DEFINER SET search_path TO 'pg_catalog'
  AS $$ SELECT 'synthetic'; $$;
GRANT USAGE ON SCHEMA iam TO iam_runtime_test;
GRANT SELECT ON iam.tenant_demo TO iam_runtime_test;
SQL

# Independent authenticated runtime sessions must prove synthetic A/B RLS.
for tenant in A B; do
  result="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U iam_runtime_test -d iam_database \
    -c "SET app.tenant TO '$tenant'; SELECT string_agg(tenant,',') FROM iam.tenant_demo" | tail -n 1)"
  if [ "$result" != "$tenant" ]; then
    echo "::error::BLOCKED_PG18_SYNTHETIC_RLS_TENANT"
    exit 2
  fi
done
no_context="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U iam_runtime_test -d iam_database \
  -c 'SELECT count(*) FROM iam.tenant_demo' | tail -n 1)"
test "$no_context" = "0" || { echo "::error::BLOCKED_PG18_SYNTHETIC_RLS_NO_CONTEXT"; exit 2; }
echo "PASS_G1_SYNTHETIC_RLS_A_B_AND_NO_CONTEXT"

# Before lease: schema and table access denied, and no dump.
if docker exec "$container" pg_dump -w -U iam_schema_export_reader -d iam_database \
  --schema-only --format=custom --schema=iam --schema=audit --schema=app_private \
  --file=/tmp/g1-lease.dump >/dev/null 2>&1; then
  echo "::error::BLOCKED_G1_UNPRIVILEGED_DUMP_UNEXPECTEDLY_SUCCEEDED"
  exit 2
fi
if docker exec "$container" psql -X -v ON_ERROR_STOP=1 -q -U iam_schema_export_reader -d iam_database \
  -c "SELECT count(*) FROM app_private.context_keys" >/dev/null 2>&1; then
  echo "::error::BLOCKED_G1_UNPRIVILEGED_SECRET_READ"
  exit 2
fi
if docker exec "$container" psql -X -v ON_ERROR_STOP=1 -q -U iam_schema_export_reader -d iam_database \
  -c "SELECT iam.synthetic_definer()" >/dev/null 2>&1; then
  echo "::error::BLOCKED_G1_UNPRIVILEGED_FUNCTION_EXECUTION"
  exit 2
fi
echo "PASS_G1_SYNTHETIC_ZERO_PRIVILEGES_DENIED"

# DISPOSABLE CI FIXTURE ONLY. DO NOT COPY THESE GRANTS INTO NEON.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U postgres -d iam_database >/dev/null <<'SQL'
GRANT USAGE ON SCHEMA iam, audit, app_private TO iam_schema_export_reader;
GRANT MAINTAIN ON TABLE iam.tenant_demo, iam.tenant_view, audit.audit_event, app_private.context_keys
  TO iam_schema_export_reader;
SQL

# USAGE exposes any function with ambient EXECUTE; document rather than hide risk.
fn="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 \
  -U iam_schema_export_reader -d iam_database -c 'SELECT iam.synthetic_definer()' | tail -n 1)"
test "$fn" = "synthetic" || { echo "::error::BLOCKED_G1_FUNCTION_SURFACE_UNEXPECTED"; exit 2; }
echo "PASS_G1_SYNTHETIC_USAGE_EXPOSES_PUBLIC_SECURITY_DEFINER"

# The lease must not confer data SELECT, including on the synthetic secret table.
for table in iam.tenant_demo iam.tenant_view audit.audit_event app_private.context_keys; do
  if docker exec "$container" psql -X -v ON_ERROR_STOP=1 -q -U iam_schema_export_reader -d iam_database \
    -c "SELECT * FROM $table LIMIT 1" >/dev/null 2>&1; then
    echo "::error::BLOCKED_G1_SYNTHETIC_DATA_READ_AFTER_LEASE"
    exit 2
  fi
done
echo "PASS_G1_SYNTHETIC_LEASE_NO_DATA_SELECT"

# Actual PG18 schema-only dump, untrusted SQL and data never leave the container.
if ! docker exec "$container" pg_dump -w -U iam_schema_export_reader -d iam_database \
  --schema-only --format=custom --schema=iam --schema=audit --schema=app_private \
  --lock-wait-timeout=5s --file=/tmp/g1-lease.dump >/dev/null 2>&1; then
  echo "::error::BLOCKED_G1_SYNTHETIC_SCHEMA_DUMP_FAILED_AFTER_LEASE"
  exit 2
fi
docker exec "$container" pg_restore --list /tmp/g1-lease.dump >/tmp/g1-synthetic-toc.txt
if grep -Eq 'TABLE DATA |BLOB DATA ' /tmp/g1-synthetic-toc.txt; then
  echo "::error::BLOCKED_G1_SYNTHETIC_ARCHIVE_CONTAINS_DATA"
  exit 2
fi
grep -Eq ' TABLE ' /tmp/g1-synthetic-toc.txt || { echo "::error::BLOCKED_G1_SYNTHETIC_TOC_MISSING_TABLE"; exit 2; }
grep -Eq ' VIEW ' /tmp/g1-synthetic-toc.txt || { echo "::error::BLOCKED_G1_SYNTHETIC_TOC_MISSING_VIEW"; exit 2; }
rm -f /tmp/g1-synthetic-toc.txt
echo "PASS_G1_SYNTHETIC_PG18_SCHEMA_ONLY_DUMP"

# REVOKE is committed in a separate session; subsequent proof uses another.
docker exec -i "$container" psql -X -v ON_ERROR_STOP=1 -q -U postgres -d iam_database >/dev/null <<'SQL'
REVOKE MAINTAIN ON TABLE iam.tenant_demo, iam.tenant_view, audit.audit_event, app_private.context_keys
  FROM iam_schema_export_reader;
REVOKE USAGE ON SCHEMA iam, audit, app_private FROM iam_schema_export_reader;
SQL
proof="$(docker exec "$container" psql -X -A -t -v ON_ERROR_STOP=1 -U postgres -d iam_database \
  -c "SELECT (SELECT count(*) FROM pg_namespace WHERE nspname IN ('iam','audit','app_private') AND has_schema_privilege('iam_schema_export_reader',oid,'USAGE')),
             (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p','v') AND has_table_privilege('iam_schema_export_reader',c.oid,'MAINTAIN')),
             (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p','v') AND has_table_privilege('iam_schema_export_reader',c.oid,'SELECT'))" | tail -n 1)"
test "$proof" = "0|0|0" || { echo "::error::BLOCKED_G1_SYNTHETIC_REVOKE_PARITY"; exit 2; }
if docker exec "$container" pg_dump -w -U iam_schema_export_reader -d iam_database \
  --schema-only --format=custom --schema=iam --schema=audit --schema=app_private \
  --file=/tmp/g1-after-revoke.dump >/dev/null 2>&1; then
  echo "::error::BLOCKED_G1_SYNTHETIC_DUMP_ALLOWED_POST_REVOKE"
  exit 2
fi
if docker exec "$container" psql -X -v ON_ERROR_STOP=1 -q -U iam_schema_export_reader -d iam_database \
  -c 'SELECT iam.synthetic_definer()' >/dev/null 2>&1; then
  echo "::error::BLOCKED_G1_SYNTHETIC_FUNCTION_ALLOWED_POST_REVOKE"
  exit 2
fi
echo "PASS_G1_SYNTHETIC_POST_COMMIT_REVOKE_INDEPENDENT_SESSION"
echo "PASS_G1_SYNTHETIC_FINAL: local PostgreSQL 18 only; no Neon access, no data exported"
