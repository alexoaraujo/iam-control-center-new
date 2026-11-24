#!/usr/bin/env bash
# Runs only after role reconciliation on the independent disposable PG18 job.
set -euo pipefail
[[ "${GITHUB_ACTIONS:-}" == true ]]
[[ "${DATABASE_URL:-}" == "postgresql://postgres@localhost:5432/iam_schema_test" ]]
: "${POSTGRES_TEST_PASSWORD:?}"
export PEOS_BASELINE_COLLECTOR=PG18_DISPOSABLE_ONLY
export COLLECTOR_DATABASE_URL=postgresql://iam_schema_export_reader@localhost:5432/iam_schema_test
export COLLECTOR_TEST_PASSWORD="$(openssl rand -hex 32)"
collector=database/tests/baseline-evidence-fixture/collector.py
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
admin() {
  env -i PATH="$PATH" LC_ALL=C PGCONNECT_TIMEOUT=5 PGPASSWORD="$POSTGRES_TEST_PASSWORD" \
    COLLECTOR_TEST_PASSWORD="$COLLECTOR_TEST_PASSWORD" \
    psql -X -w -qAt -v ON_ERROR_STOP=1 "$DATABASE_URL" "$@"
}
[[ "$(admin -c "SELECT current_database()='iam_schema_test' AND current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 180000 AND 189999 AND nullif(current_setting('neon.branch_id',true),'') IS NULL AND to_regnamespace('iam') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='iam_schema_export_reader')")" == t ]]
admin <<'SQL'
\getenv reader_password COLLECTOR_TEST_PASSWORD
CREATE ROLE iam_schema_export_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'reader_password';
GRANT CONNECT ON DATABASE iam_schema_test TO iam_schema_export_reader;
CREATE SCHEMA iam AUTHORIZATION iam_owner;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
GRANT USAGE ON SCHEMA iam TO iam_schema_export_reader;
CREATE TABLE iam.private_business_fixture(secret text);
INSERT INTO iam.private_business_fixture VALUES ('PEOS_PRIVATE_ROW_MUST_NOT_BE_EXPORTED');
SQL
run() { python3 "$collector" --fixture-output "$tmp/$1"; }
fail() {
  local expected="$1"; shift
  if "$@" >"$tmp/failure" 2>&1; then echo "ERROR: expected $expected" >&2; exit 1; fi
  grep -Fxq "$expected" "$tmp/failure"
}
run absent
admin <<'SQL'
CREATE TABLE iam.schema_migrations(migration_id text PRIMARY KEY,checksum_sha256 text NOT NULL,
  source_sha text NOT NULL,execution_role text NOT NULL,applied_at timestamptz NOT NULL);
ALTER TABLE iam.schema_migrations OWNER TO iam_owner;
GRANT SELECT ON iam.schema_migrations TO iam_schema_export_reader;
SQL
run empty
admin -c "INSERT INTO iam.schema_migrations VALUES ('1001_fixture',repeat('a',64),repeat('b',40),'iam_migrator_login','2026-01-01T00:00:00Z')"
run populated
python3 - "$tmp" <<'PY'
import hashlib,json,pathlib,stat,sys
root=pathlib.Path(sys.argv[1])
for name,count in [("absent",None),("empty",0),("populated",1)]:
    folder=root/name
    assert stat.S_IMODE(folder.stat().st_mode)==0o700
    index=json.loads((folder/"index.json").read_bytes())
    assert index["scope"]=="PG18_FIXTURE_ONLY"
    assert index["ledger_rows"]==count
    assert not index["live_neon_attested"] and not index["signed_baseline"] and not index["execution_authorized"]
    for file,checksum in index["artifact_sha256"].items():
        data=(folder/file).read_bytes()
        assert stat.S_IMODE((folder/file).stat().st_mode)==0o600
        assert hashlib.sha256(data).hexdigest()==checksum
        assert b"PEOS_PRIVATE_ROW_MUST_NOT_BE_EXPORTED" not in data
    ledger=json.loads((folder/"ledger.json").read_bytes())
    assert (ledger is None)==(count is None)
    if ledger is not None: assert ledger["branch_id"]=="br-fixture-only" and len(ledger["rows"])==count
PY
fail BLOCKED_OUTPUT_EXISTS run populated
fail BLOCKED_NON_FIXTURE_CONTEXT env COLLECTOR_DATABASE_URL=postgresql://iam_schema_export_reader@example.invalid/iam_database python3 "$collector" --fixture-output "$tmp/wrong"
fail BLOCKED_READONLY_SESSION env COLLECTOR_TEST_PASSWORD=invalid python3 "$collector" --fixture-output "$tmp/password"
admin -c 'REVOKE SELECT ON iam.schema_migrations FROM iam_schema_export_reader'
fail BLOCKED_READONLY_SESSION run denied
admin -c 'GRANT SELECT ON iam.schema_migrations TO iam_schema_export_reader; ALTER TABLE iam.schema_migrations ADD COLUMN unexpected text'
fail BLOCKED_READONLY_SESSION run drift
admin -c 'ALTER TABLE iam.schema_migrations DROP COLUMN unexpected; GRANT SELECT ON iam.private_business_fixture TO iam_schema_export_reader'
fail BLOCKED_READONLY_SESSION run excess
admin -c 'REVOKE SELECT ON iam.private_business_fixture FROM iam_schema_export_reader'
preflight=database/scripts/iam-collector-reader-preflight.sql
check_preflight() {
  admin -f "$preflight" > "$tmp/preflight.json"
  python3 - "$tmp/preflight.json" "$1" "$2" "$3" <<'PY'
import json,sys
p=json.load(open(sys.argv[1]))
assert p["format"]=="iam-collector-reader-preflight/v1"
assert p["database"]=="iam_schema_test" and p["branch_id"] is None
assert p["ledger_present"] and p["ledger_contract"]
assert p["authenticated_reader_proof"] is False and p["execution_authorized"] is False
r=p["reader"]
assert r["other_relation_access"]==int(sys.argv[2])
assert r["sequence_access"]==int(sys.argv[3])
assert r["projected_definer_execute"]==int(sys.argv[4])
PY
}
check_preflight 0 0 0
# Only the synthetic local ledger is altered to reproduce the observed Neon profile.
admin <<'SQL'
ALTER TABLE iam.schema_migrations
  ALTER COLUMN checksum_sha256 TYPE character(64),
  ALTER COLUMN execution_role TYPE name,
  ALTER COLUMN source_sha DROP NOT NULL;
UPDATE iam.schema_migrations SET applied_at='2026-01-01T00:00:00.123456Z';
SQL
check_preflight 0 0 0
run canonical
python3 - "$tmp/canonical" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1])
row=json.loads((p/"ledger.json").read_bytes())["rows"][0]
assert row["checksum_sha256"]=="a"*64 and row["source_sha"]=="b"*40
assert row["execution_role"]=="iam_migrator_login"
assert row["applied_at"]=="2026-01-01T00:00:00.123456Z"
assert json.loads((p/"index.json").read_bytes())["ledger_provenance_authenticated"] is False
PY
admin -c 'UPDATE iam.schema_migrations SET source_sha=NULL'
fail BLOCKED_READONLY_SESSION run nullsource
admin -c "UPDATE iam.schema_migrations SET source_sha='unverified'"
fail BLOCKED_READONLY_SESSION run badsource
admin -c "UPDATE iam.schema_migrations SET source_sha=repeat('b',40),checksum_sha256='short'"
fail BLOCKED_READONLY_SESSION run badchecksum
admin -c "UPDATE iam.schema_migrations SET checksum_sha256=repeat('a',64),execution_role='invalid'"
fail BLOCKED_READONLY_SESSION run badrole
admin -c "UPDATE iam.schema_migrations SET execution_role='iam_migrator_login',applied_at='infinity'"
fail BLOCKED_READONLY_SESSION run badtime
admin -c "UPDATE iam.schema_migrations SET applied_at='2026-01-01T00:00:00.123456Z'; ALTER TABLE iam.schema_migrations ALTER COLUMN checksum_sha256 TYPE character(65)"
fail BLOCKED_READONLY_SESSION run badtype
admin -c 'ALTER TABLE iam.schema_migrations ALTER COLUMN checksum_sha256 TYPE character(64)'
run canonical_recovered
# Reconciliation of the synthetic routine preserves explicit runtime access.
admin <<'SQL'
CREATE FUNCTION iam.clear_tenant_context_fixture() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1';
ALTER FUNCTION iam.clear_tenant_context_fixture() OWNER TO iam_owner;
GRANT USAGE ON SCHEMA iam TO iam_app_runtime;
GRANT EXECUTE ON FUNCTION iam.clear_tenant_context_fixture() TO iam_app_runtime;
BEGIN;
REVOKE EXECUTE ON FUNCTION iam.clear_tenant_context_fixture() FROM PUBLIC;
DO $assert$
BEGIN
  IF has_function_privilege('iam_schema_export_reader','iam.clear_tenant_context_fixture()','EXECUTE')
    OR NOT has_function_privilege('iam_app_runtime_login','iam.clear_tenant_context_fixture()','EXECUTE')
  THEN RAISE EXCEPTION 'PEOS_ACL_RECONCILIATION'; END IF;
END $assert$;
ROLLBACK;
DO $assert$
BEGIN
  IF NOT has_function_privilege('iam_schema_export_reader','iam.clear_tenant_context_fixture()','EXECUTE')
  THEN RAISE EXCEPTION 'PEOS_ACL_ROLLBACK'; END IF;
END $assert$;
SQL
fail BLOCKED_READONLY_SESSION run aclrollback
admin -c 'REVOKE EXECUTE ON FUNCTION iam.clear_tenant_context_fixture() FROM PUBLIC'
run acl_reconciled
[[ "$(admin -c 'SET ROLE iam_app_runtime_login; SELECT iam.clear_tenant_context_fixture(); RESET ROLE;')" == 1 ]]
admin -c 'DROP FUNCTION iam.clear_tenant_context_fixture(); REVOKE USAGE ON SCHEMA iam FROM iam_app_runtime'
check_preflight 0 0 0
admin <<'SQL'
CREATE FUNCTION iam.collector_guard_probe() RETURNS integer
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT 1';
GRANT EXECUTE ON FUNCTION iam.collector_guard_probe() TO PUBLIC;
REVOKE USAGE ON SCHEMA iam FROM iam_schema_export_reader;
SQL
check_preflight 0 0 1
admin -c 'GRANT USAGE ON SCHEMA iam TO iam_schema_export_reader'
fail BLOCKED_READONLY_SESSION run definer
admin -c 'REVOKE EXECUTE ON FUNCTION iam.collector_guard_probe() FROM PUBLIC; GRANT EXECUTE ON FUNCTION iam.collector_guard_probe() TO iam_schema_export_reader'
fail BLOCKED_READONLY_SESSION run directdefiner
admin -c 'REVOKE EXECUTE ON FUNCTION iam.collector_guard_probe() FROM iam_schema_export_reader'
check_preflight 0 0 0
admin <<'SQL'
CREATE SCHEMA collector_guard_fixture;
GRANT USAGE ON SCHEMA collector_guard_fixture TO iam_schema_export_reader;
CREATE TABLE collector_guard_fixture.private_row(secret text);
GRANT SELECT(secret) ON collector_guard_fixture.private_row TO iam_schema_export_reader;
SQL
check_preflight 1 0 0
fail BLOCKED_READONLY_SESSION run outside
admin -c 'REVOKE SELECT(secret) ON collector_guard_fixture.private_row FROM iam_schema_export_reader; CREATE SEQUENCE collector_guard_fixture.counter; GRANT USAGE ON SEQUENCE collector_guard_fixture.counter TO iam_schema_export_reader'
check_preflight 0 1 0
fail BLOCKED_READONLY_SESSION run sequence
admin -c 'DROP SCHEMA collector_guard_fixture CASCADE'
check_preflight 0 0 0
run recovered
admin -c 'ALTER ROLE iam_schema_export_reader BYPASSRLS'
fail BLOCKED_READONLY_SESSION run unsafe
for dir in wrong password denied drift excess definer directdefiner outside sequence unsafe nullsource badsource badchecksum badrole badtime badtype aclrollback; do [[ ! -e "$tmp/$dir" ]]; done
admin -c 'DROP SCHEMA iam CASCADE; REVOKE CONNECT ON DATABASE iam_schema_test FROM iam_schema_export_reader; DROP ROLE iam_schema_export_reader'
echo 'PASS: PG18 canonical ledger adapter, strict row provenance, microsecond timestamps, ACL rollback and preserved runtime access'
echo 'PASS: PG18 reader privilege projection, PUBLIC/direct SECURITY DEFINER, cross-schema column ACL, sequence ACL and recovery'
echo 'PASS: PG18 authenticated readonly snapshot, absent/empty/populated ledger, private hashes, fail-closed reader guards and no residue'
