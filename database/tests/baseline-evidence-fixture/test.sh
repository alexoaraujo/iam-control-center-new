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
admin -c 'REVOKE SELECT ON iam.private_business_fixture FROM iam_schema_export_reader; ALTER ROLE iam_schema_export_reader BYPASSRLS'
fail BLOCKED_READONLY_SESSION run unsafe
for dir in wrong password denied drift excess unsafe; do [[ ! -e "$tmp/$dir" ]]; done
admin -c 'DROP SCHEMA iam CASCADE; REVOKE CONNECT ON DATABASE iam_schema_test FROM iam_schema_export_reader; DROP ROLE iam_schema_export_reader'
echo 'PASS: PG18 authenticated readonly snapshot, absent/empty/populated ledger, private hashes, fail-closed reader guards and no residue'
