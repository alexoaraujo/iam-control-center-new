#!/usr/bin/env python3
"""PEOS G2: authenticated, read-only evidence acquisition in PG18 CI fixture.

Deliberately no live Neon mode, arbitrary URL, SQL argument, signer or network
destination. Future protected live acquisition needs a separately reviewed
control-plane binding, TLS verify-full and dedicated reader custody.
"""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
MANIFEST = ROOT / "database/scripts/schema-manifest.sql"
ROLE = "iam_schema_export_reader"
URL = "postgresql://iam_schema_export_reader@localhost:5432/iam_schema_test"
FIXTURE = "br-fixture-only"
MAX_OUTPUT = 8 * 1024 * 1024

GUARD = r"""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
SET LOCAL timezone = 'UTC';
DO $guard$
BEGIN
  IF current_database() <> 'iam_schema_test' OR session_user <> 'iam_schema_export_reader'
    OR current_user <> session_user
    OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
    OR current_setting('transaction_read_only') <> 'on'
    OR current_setting('transaction_isolation') <> 'repeatable read'
    OR nullif(current_setting('neon.branch_id',true),'') IS NOT NULL
    OR inet_server_addr() IS NULL
    OR NOT (inet_server_addr() <<= inet '127.0.0.0/8'
       OR inet_server_addr() <<= inet '172.16.0.0/12'
       OR inet_server_addr() = inet '::1')
    OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin
      AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
      AND NOT rolcreatedb AND NOT rolreplication AND rolconfig IS NULL)
    OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member=current_user::regrole)
    OR EXISTS (SELECT 1 FROM pg_db_role_setting WHERE setrole=current_user::regrole)
    OR has_database_privilege(current_user,current_database(),'CREATE,TEMP')
    OR EXISTS (SELECT 1 FROM pg_namespace n WHERE left(n.nspname,3) <> 'pg_'
      AND n.nspname <> 'information_schema' AND has_schema_privilege(current_user,n.oid,'CREATE'))
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE left(n.nspname,3) <> 'pg_' AND n.nspname <> 'information_schema'
        AND CASE WHEN c.relkind IN ('r','p','v','m','f')
          AND NOT (n.nspname='iam' AND c.relname='schema_migrations')
        THEN has_table_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
          OR has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES')
        ELSE false END)
    OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE left(n.nspname,3) <> 'pg_' AND n.nspname <> 'information_schema'
        AND CASE WHEN c.relkind='S'
          THEN has_sequence_privilege(current_user,c.oid,'SELECT,USAGE,UPDATE') ELSE false END)
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE left(n.nspname,3) <> 'pg_' AND n.nspname <> 'information_schema'
        AND p.prosecdef AND (n.nspname='iam' OR has_schema_privilege(current_user,n.oid,'USAGE'))
        AND has_function_privilege(current_user,p.oid,'EXECUTE'))
  THEN RAISE EXCEPTION 'PEOS_READER_GUARD'; END IF;
END $guard$;
SELECT jsonb_build_object(
  'format','iam-fixture-collector-session/v1','database',current_database(),
  'session_user',session_user,'current_user',current_user,
  'pg_version',current_setting('server_version_num')::int,
  'neon_branch_id',nullif(current_setting('neon.branch_id',true),''),
  'read_only',current_setting('transaction_read_only')='on',
  'isolation',current_setting('transaction_isolation'),
  'backend_pid',pg_backend_pid(),
  'captured_at',to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)::text;
"""
LEDGER = r"""
SELECT to_regclass('iam.schema_migrations') IS NOT NULL AS ledger_present \gset
\if :ledger_present
DO $ledger$
DECLARE t oid:=to_regclass('iam.schema_migrations');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid=t AND relkind='r' AND NOT relrowsecurity AND NOT relforcerowsecurity)
     OR NOT COALESCE((((SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text ORDER BY a.attname::text)
       FROM pg_attribute a WHERE a.attrelid=t AND a.attnum>0 AND NOT a.attisdropped) = ARRAY['applied_at:timestamp with time zone:true','checksum_sha256:text:true','execution_role:text:true','migration_id:text:true','source_sha:text:true']::text[] OR (SELECT array_agg(a.attname::text||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::text ORDER BY a.attname::text)
       FROM pg_attribute a WHERE a.attrelid=t AND a.attnum>0 AND NOT a.attisdropped) = ARRAY['applied_at:timestamp with time zone:true','checksum_sha256:character(64):true','execution_role:name:true','migration_id:text:true','source_sha:text:false']::text[]) AND EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attname='migration_id'
      WHERE k.conrelid=t AND k.contype='p' AND k.convalidated AND NOT k.condeferrable
        AND k.conkey=ARRAY[a.attnum]::smallint[]) AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=t AND a.attnum>0 AND NOT a.attisdropped AND (a.attgenerated<>'' OR a.attidentity<>''))),false)
     OR NOT has_schema_privilege(current_user,'iam','USAGE')
     OR NOT has_table_privilege(current_user,t,'SELECT')
     OR has_table_privilege(current_user,t,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
     OR has_any_column_privilege(current_user,t,'INSERT,UPDATE,REFERENCES')
  THEN RAISE EXCEPTION 'PEOS_LEDGER_CONTRACT'; END IF;
  IF EXISTS (SELECT 1 FROM iam.schema_migrations
      WHERE migration_id IS NULL OR migration_id !~ '^[0-9]{4}_[a-z0-9_]+
  THEN RAISE EXCEPTION 'PEOS_LEDGER_LIMIT'; END IF;
END $ledger$;
SELECT jsonb_build_object('format','iam-ledger-provenance/v1','branch_id','br-fixture-only',
  'rows',coalesce(jsonb_agg(jsonb_build_object('migration_id',migration_id,
  'checksum_sha256',checksum_sha256::text,'source_sha',source_sha,'execution_role',execution_role::text,
  'applied_at',to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
  ORDER BY migration_id),'[]'::jsonb))::text FROM iam.schema_migrations;
\else
SELECT 'null';
\endif
SELECT jsonb_build_object('backend_pid',pg_backend_pid(),
 'read_only',current_setting('transaction_read_only')='on',
 'isolation',current_setting('transaction_isolation'))::text;
ROLLBACK;
"""
def require(ok, code):
    if not ok:
        raise ValueError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def parse_result(raw, manifest_bytes, checkout_sha):
    require(len(raw) <= MAX_OUTPUT, "BLOCKED_OUTPUT_LIMIT")
    lines = raw.splitlines()
    require(len(lines) == 4, "BLOCKED_RESULT_CONTRACT")
    session, manifest, ledger, final = [json.loads(line) for line in lines]
    require(session["format"] == "iam-fixture-collector-session/v1"
            and session["database"] == "iam_schema_test"
            and session["session_user"] == session["current_user"] == ROLE
            and session["read_only"] is True
            and session["isolation"] == "repeatable read"
            and session["neon_branch_id"] is None
            and 180000 <= session["pg_version"] < 190000
            and final == {"backend_pid": session["backend_pid"], "read_only": True,
                          "isolation": "repeatable read"}, "BLOCKED_SESSION_CONTRACT")
    require(manifest["format"] == "iam-postgresql-schema-manifest/v1"
            and manifest["database"] == session["database"]
            and manifest["server_version_num"] == session["pg_version"], "BLOCKED_MANIFEST_CONTRACT")
    exists = any(r["schema"] == "iam" and r["name"] == "schema_migrations"
                 and r["kind"] == "r" for r in manifest["relations"])
    require(exists == (ledger is not None), "BLOCKED_LEDGER_PRESENCE")
    if ledger is not None:
        require(ledger["format"] == "iam-ledger-provenance/v1" and ledger["branch_id"] == FIXTURE
                and isinstance(ledger["rows"], list), "BLOCKED_LEDGER_CONTRACT")
        seen = set()
        for row in ledger["rows"]:
            require(set(row) == {"migration_id","checksum_sha256","source_sha","execution_role","applied_at"}
                    and re.fullmatch(r"\d{4}_[a-z0-9_]+", row["migration_id"])
                    and re.fullmatch(r"[0-9a-f]{64}", row["checksum_sha256"])
                    and re.fullmatch(r"[0-9a-f]{40}", row["source_sha"])
                    and re.fullmatch(r"iam_[a-z0-9_]+", row["execution_role"])
                    and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z", row["applied_at"])
                    and datetime.fromisoformat(row["applied_at"]).isoformat(timespec="microseconds").replace("+00:00","Z")==row["applied_at"]
                    and row["migration_id"] not in seen, "BLOCKED_LEDGER_ROW")
            seen.add(row["migration_id"])
    # Preserve the server's exact JSON bytes, without logging catalog definitions.
    artifacts = {"session.json": lines[0]+b"\n", "schema-manifest.json": lines[1]+b"\n",
                 "ledger.json": lines[2]+b"\n"}
    index = {"format":"iam-fixture-collector-index/v1","scope":"PG18_FIXTURE_ONLY",
             "checkout_sha":checkout_sha,"manifest_sql_sha256":digest(manifest_bytes),
             "artifact_sha256":{name:digest(content) for name,content in artifacts.items()},
             "ledger_present":exists,"ledger_rows":None if ledger is None else len(ledger["rows"]),
             "authenticated_fixture_session":True,"ledger_provenance_authenticated":False,"live_neon_attested":False,
             "signed_baseline":False,"execution_authorized":False}
    artifacts["index.json"] = (json.dumps(index,sort_keys=True,indent=2)+"\n").encode()
    return artifacts

def collect(output):
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("PEOS_BASELINE_COLLECTOR") == "PG18_DISPOSABLE_ONLY"
            and os.environ.get("COLLECTOR_DATABASE_URL") == URL
            and bool(os.environ.get("COLLECTOR_TEST_PASSWORD")), "BLOCKED_NON_FIXTURE_CONTEXT")
    require(not output.exists() and not output.is_symlink(), "BLOCKED_OUTPUT_EXISTS")
    checkout = subprocess.run(["git","-C",str(ROOT),"rev-parse","HEAD"],check=True,
                              capture_output=True,text=True,timeout=5).stdout.strip()
    require(re.fullmatch(r"[0-9a-f]{40}",checkout), "BLOCKED_CHECKOUT")
    # No inherited libpq service files, PGOPTIONS, URL overrides or user rc.
    env={"PATH":os.environ["PATH"],"LC_ALL":"C","PGCONNECT_TIMEOUT":"5",
         "PGSSLMODE":"disable","PGPASSWORD":os.environ["COLLECTOR_TEST_PASSWORD"]}
    sql_bytes=MANIFEST.read_bytes()
    sql=(GUARD.encode()+b"\n"+sql_bytes+b"\n"+LEDGER.encode())
    r=subprocess.run(["psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1",URL],
                     input=sql,env=env,capture_output=True,timeout=30)
    require(r.returncode == 0, "BLOCKED_READONLY_SESSION")
    artifacts=parse_result(r.stdout,sql_bytes,checkout)
    # Exclusive private directory; never overwrite another evidence package.
    output.mkdir(mode=0o700)
    try:
        for name,data in artifacts.items():
            fd=os.open(output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"wb") as f:
                f.write(data)
    except Exception:
        for name in artifacts:
            (output/name).unlink(missing_ok=True)
        output.rmdir()
        raise
    print("PASS_AUTHENTICATED_PG18_READONLY_FIXTURE_COLLECTION")

if __name__ == "__main__":
    os.umask(0o077)
    try:
        require(len(sys.argv)==3 and sys.argv[1]=="--fixture-output","BLOCKED_USAGE")
        collect(Path(sys.argv[2]))
    except Exception as exc:
        # Only fixed safe codes, never psql stderr, paths, SQL or credentials.
        code=str(exc)
        print(code if isinstance(exc,ValueError) and re.fullmatch(r"BLOCKED_[A-Z_]+",code)
              else "BLOCKED_COLLECTOR_FAILURE",file=sys.stderr)
        sys.exit(1)

        OR checksum_sha256 IS NULL OR checksum_sha256::text !~ '^[0-9a-f]{64}
  THEN RAISE EXCEPTION 'PEOS_LEDGER_LIMIT'; END IF;
END $ledger$;
SELECT jsonb_build_object('format','iam-ledger-provenance/v1','branch_id','br-fixture-only',
  'rows',coalesce(jsonb_agg(jsonb_build_object('migration_id',migration_id,
  'checksum_sha256',checksum_sha256,'source_sha',source_sha,'execution_role',execution_role,
  'applied_at',to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ORDER BY migration_id),'[]'::jsonb))::text FROM iam.schema_migrations;
\else
SELECT 'null';
\endif
SELECT jsonb_build_object('backend_pid',pg_backend_pid(),
 'read_only',current_setting('transaction_read_only')='on',
 'isolation',current_setting('transaction_isolation'))::text;
ROLLBACK;
"""
def require(ok, code):
    if not ok:
        raise ValueError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def parse_result(raw, manifest_bytes, checkout_sha):
    require(len(raw) <= MAX_OUTPUT, "BLOCKED_OUTPUT_LIMIT")
    lines = raw.splitlines()
    require(len(lines) == 4, "BLOCKED_RESULT_CONTRACT")
    session, manifest, ledger, final = [json.loads(line) for line in lines]
    require(session["format"] == "iam-fixture-collector-session/v1"
            and session["database"] == "iam_schema_test"
            and session["session_user"] == session["current_user"] == ROLE
            and session["read_only"] is True
            and session["isolation"] == "repeatable read"
            and session["neon_branch_id"] is None
            and 180000 <= session["pg_version"] < 190000
            and final == {"backend_pid": session["backend_pid"], "read_only": True,
                          "isolation": "repeatable read"}, "BLOCKED_SESSION_CONTRACT")
    require(manifest["format"] == "iam-postgresql-schema-manifest/v1"
            and manifest["database"] == session["database"]
            and manifest["server_version_num"] == session["pg_version"], "BLOCKED_MANIFEST_CONTRACT")
    exists = any(r["schema"] == "iam" and r["name"] == "schema_migrations"
                 and r["kind"] == "r" for r in manifest["relations"])
    require(exists == (ledger is not None), "BLOCKED_LEDGER_PRESENCE")
    if ledger is not None:
        require(ledger["format"] == "iam-ledger-provenance/v1" and ledger["branch_id"] == FIXTURE
                and isinstance(ledger["rows"], list), "BLOCKED_LEDGER_CONTRACT")
        seen = set()
        for row in ledger["rows"]:
            require(set(row) == {"migration_id","checksum_sha256","source_sha","execution_role","applied_at"}
                    and re.fullmatch(r"\d{4}_[a-z0-9_]+", row["migration_id"])
                    and re.fullmatch(r"[0-9a-f]{64}", row["checksum_sha256"])
                    and re.fullmatch(r"[0-9a-f]{40}", row["source_sha"])
                    and re.fullmatch(r"iam_[a-z0-9_]+", row["execution_role"])
                    and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", row["applied_at"])
                    and row["migration_id"] not in seen, "BLOCKED_LEDGER_ROW")
            seen.add(row["migration_id"])
    # Preserve the server's exact JSON bytes, without logging catalog definitions.
    artifacts = {"session.json": lines[0]+b"\n", "schema-manifest.json": lines[1]+b"\n",
                 "ledger.json": lines[2]+b"\n"}
    index = {"format":"iam-fixture-collector-index/v1","scope":"PG18_FIXTURE_ONLY",
             "checkout_sha":checkout_sha,"manifest_sql_sha256":digest(manifest_bytes),
             "artifact_sha256":{name:digest(content) for name,content in artifacts.items()},
             "ledger_present":exists,"ledger_rows":None if ledger is None else len(ledger["rows"]),
             "authenticated_fixture_session":True,"live_neon_attested":False,
             "signed_baseline":False,"execution_authorized":False}
    artifacts["index.json"] = (json.dumps(index,sort_keys=True,indent=2)+"\n").encode()
    return artifacts

def collect(output):
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("PEOS_BASELINE_COLLECTOR") == "PG18_DISPOSABLE_ONLY"
            and os.environ.get("COLLECTOR_DATABASE_URL") == URL
            and bool(os.environ.get("COLLECTOR_TEST_PASSWORD")), "BLOCKED_NON_FIXTURE_CONTEXT")
    require(not output.exists() and not output.is_symlink(), "BLOCKED_OUTPUT_EXISTS")
    checkout = subprocess.run(["git","-C",str(ROOT),"rev-parse","HEAD"],check=True,
                              capture_output=True,text=True,timeout=5).stdout.strip()
    require(re.fullmatch(r"[0-9a-f]{40}",checkout), "BLOCKED_CHECKOUT")
    # No inherited libpq service files, PGOPTIONS, URL overrides or user rc.
    env={"PATH":os.environ["PATH"],"LC_ALL":"C","PGCONNECT_TIMEOUT":"5",
         "PGSSLMODE":"disable","PGPASSWORD":os.environ["COLLECTOR_TEST_PASSWORD"]}
    sql_bytes=MANIFEST.read_bytes()
    sql=(GUARD.encode()+b"\n"+sql_bytes+b"\n"+LEDGER.encode())
    r=subprocess.run(["psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1",URL],
                     input=sql,env=env,capture_output=True,timeout=30)
    require(r.returncode == 0, "BLOCKED_READONLY_SESSION")
    artifacts=parse_result(r.stdout,sql_bytes,checkout)
    # Exclusive private directory; never overwrite another evidence package.
    output.mkdir(mode=0o700)
    try:
        for name,data in artifacts.items():
            fd=os.open(output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"wb") as f:
                f.write(data)
    except Exception:
        for name in artifacts:
            (output/name).unlink(missing_ok=True)
        output.rmdir()
        raise
    print("PASS_AUTHENTICATED_PG18_READONLY_FIXTURE_COLLECTION")

if __name__ == "__main__":
    os.umask(0o077)
    try:
        require(len(sys.argv)==3 and sys.argv[1]=="--fixture-output","BLOCKED_USAGE")
        collect(Path(sys.argv[2]))
    except Exception as exc:
        # Only fixed safe codes, never psql stderr, paths, SQL or credentials.
        code=str(exc)
        print(code if isinstance(exc,ValueError) and re.fullmatch(r"BLOCKED_[A-Z_]+",code)
              else "BLOCKED_COLLECTOR_FAILURE",file=sys.stderr)
        sys.exit(1)

        OR source_sha IS NULL OR source_sha !~ '^[0-9a-f]{40}
  THEN RAISE EXCEPTION 'PEOS_LEDGER_LIMIT'; END IF;
END $ledger$;
SELECT jsonb_build_object('format','iam-ledger-provenance/v1','branch_id','br-fixture-only',
  'rows',coalesce(jsonb_agg(jsonb_build_object('migration_id',migration_id,
  'checksum_sha256',checksum_sha256,'source_sha',source_sha,'execution_role',execution_role,
  'applied_at',to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ORDER BY migration_id),'[]'::jsonb))::text FROM iam.schema_migrations;
\else
SELECT 'null';
\endif
SELECT jsonb_build_object('backend_pid',pg_backend_pid(),
 'read_only',current_setting('transaction_read_only')='on',
 'isolation',current_setting('transaction_isolation'))::text;
ROLLBACK;
"""
def require(ok, code):
    if not ok:
        raise ValueError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def parse_result(raw, manifest_bytes, checkout_sha):
    require(len(raw) <= MAX_OUTPUT, "BLOCKED_OUTPUT_LIMIT")
    lines = raw.splitlines()
    require(len(lines) == 4, "BLOCKED_RESULT_CONTRACT")
    session, manifest, ledger, final = [json.loads(line) for line in lines]
    require(session["format"] == "iam-fixture-collector-session/v1"
            and session["database"] == "iam_schema_test"
            and session["session_user"] == session["current_user"] == ROLE
            and session["read_only"] is True
            and session["isolation"] == "repeatable read"
            and session["neon_branch_id"] is None
            and 180000 <= session["pg_version"] < 190000
            and final == {"backend_pid": session["backend_pid"], "read_only": True,
                          "isolation": "repeatable read"}, "BLOCKED_SESSION_CONTRACT")
    require(manifest["format"] == "iam-postgresql-schema-manifest/v1"
            and manifest["database"] == session["database"]
            and manifest["server_version_num"] == session["pg_version"], "BLOCKED_MANIFEST_CONTRACT")
    exists = any(r["schema"] == "iam" and r["name"] == "schema_migrations"
                 and r["kind"] == "r" for r in manifest["relations"])
    require(exists == (ledger is not None), "BLOCKED_LEDGER_PRESENCE")
    if ledger is not None:
        require(ledger["format"] == "iam-ledger-provenance/v1" and ledger["branch_id"] == FIXTURE
                and isinstance(ledger["rows"], list), "BLOCKED_LEDGER_CONTRACT")
        seen = set()
        for row in ledger["rows"]:
            require(set(row) == {"migration_id","checksum_sha256","source_sha","execution_role","applied_at"}
                    and re.fullmatch(r"\d{4}_[a-z0-9_]+", row["migration_id"])
                    and re.fullmatch(r"[0-9a-f]{64}", row["checksum_sha256"])
                    and re.fullmatch(r"[0-9a-f]{40}", row["source_sha"])
                    and re.fullmatch(r"iam_[a-z0-9_]+", row["execution_role"])
                    and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", row["applied_at"])
                    and row["migration_id"] not in seen, "BLOCKED_LEDGER_ROW")
            seen.add(row["migration_id"])
    # Preserve the server's exact JSON bytes, without logging catalog definitions.
    artifacts = {"session.json": lines[0]+b"\n", "schema-manifest.json": lines[1]+b"\n",
                 "ledger.json": lines[2]+b"\n"}
    index = {"format":"iam-fixture-collector-index/v1","scope":"PG18_FIXTURE_ONLY",
             "checkout_sha":checkout_sha,"manifest_sql_sha256":digest(manifest_bytes),
             "artifact_sha256":{name:digest(content) for name,content in artifacts.items()},
             "ledger_present":exists,"ledger_rows":None if ledger is None else len(ledger["rows"]),
             "authenticated_fixture_session":True,"live_neon_attested":False,
             "signed_baseline":False,"execution_authorized":False}
    artifacts["index.json"] = (json.dumps(index,sort_keys=True,indent=2)+"\n").encode()
    return artifacts

def collect(output):
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("PEOS_BASELINE_COLLECTOR") == "PG18_DISPOSABLE_ONLY"
            and os.environ.get("COLLECTOR_DATABASE_URL") == URL
            and bool(os.environ.get("COLLECTOR_TEST_PASSWORD")), "BLOCKED_NON_FIXTURE_CONTEXT")
    require(not output.exists() and not output.is_symlink(), "BLOCKED_OUTPUT_EXISTS")
    checkout = subprocess.run(["git","-C",str(ROOT),"rev-parse","HEAD"],check=True,
                              capture_output=True,text=True,timeout=5).stdout.strip()
    require(re.fullmatch(r"[0-9a-f]{40}",checkout), "BLOCKED_CHECKOUT")
    # No inherited libpq service files, PGOPTIONS, URL overrides or user rc.
    env={"PATH":os.environ["PATH"],"LC_ALL":"C","PGCONNECT_TIMEOUT":"5",
         "PGSSLMODE":"disable","PGPASSWORD":os.environ["COLLECTOR_TEST_PASSWORD"]}
    sql_bytes=MANIFEST.read_bytes()
    sql=(GUARD.encode()+b"\n"+sql_bytes+b"\n"+LEDGER.encode())
    r=subprocess.run(["psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1",URL],
                     input=sql,env=env,capture_output=True,timeout=30)
    require(r.returncode == 0, "BLOCKED_READONLY_SESSION")
    artifacts=parse_result(r.stdout,sql_bytes,checkout)
    # Exclusive private directory; never overwrite another evidence package.
    output.mkdir(mode=0o700)
    try:
        for name,data in artifacts.items():
            fd=os.open(output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"wb") as f:
                f.write(data)
    except Exception:
        for name in artifacts:
            (output/name).unlink(missing_ok=True)
        output.rmdir()
        raise
    print("PASS_AUTHENTICATED_PG18_READONLY_FIXTURE_COLLECTION")

if __name__ == "__main__":
    os.umask(0o077)
    try:
        require(len(sys.argv)==3 and sys.argv[1]=="--fixture-output","BLOCKED_USAGE")
        collect(Path(sys.argv[2]))
    except Exception as exc:
        # Only fixed safe codes, never psql stderr, paths, SQL or credentials.
        code=str(exc)
        print(code if isinstance(exc,ValueError) and re.fullmatch(r"BLOCKED_[A-Z_]+",code)
              else "BLOCKED_COLLECTOR_FAILURE",file=sys.stderr)
        sys.exit(1)

        OR execution_role IS NULL OR execution_role::text !~ '^iam_[a-z0-9_]+
  THEN RAISE EXCEPTION 'PEOS_LEDGER_LIMIT'; END IF;
END $ledger$;
SELECT jsonb_build_object('format','iam-ledger-provenance/v1','branch_id','br-fixture-only',
  'rows',coalesce(jsonb_agg(jsonb_build_object('migration_id',migration_id,
  'checksum_sha256',checksum_sha256,'source_sha',source_sha,'execution_role',execution_role,
  'applied_at',to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ORDER BY migration_id),'[]'::jsonb))::text FROM iam.schema_migrations;
\else
SELECT 'null';
\endif
SELECT jsonb_build_object('backend_pid',pg_backend_pid(),
 'read_only',current_setting('transaction_read_only')='on',
 'isolation',current_setting('transaction_isolation'))::text;
ROLLBACK;
"""
def require(ok, code):
    if not ok:
        raise ValueError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def parse_result(raw, manifest_bytes, checkout_sha):
    require(len(raw) <= MAX_OUTPUT, "BLOCKED_OUTPUT_LIMIT")
    lines = raw.splitlines()
    require(len(lines) == 4, "BLOCKED_RESULT_CONTRACT")
    session, manifest, ledger, final = [json.loads(line) for line in lines]
    require(session["format"] == "iam-fixture-collector-session/v1"
            and session["database"] == "iam_schema_test"
            and session["session_user"] == session["current_user"] == ROLE
            and session["read_only"] is True
            and session["isolation"] == "repeatable read"
            and session["neon_branch_id"] is None
            and 180000 <= session["pg_version"] < 190000
            and final == {"backend_pid": session["backend_pid"], "read_only": True,
                          "isolation": "repeatable read"}, "BLOCKED_SESSION_CONTRACT")
    require(manifest["format"] == "iam-postgresql-schema-manifest/v1"
            and manifest["database"] == session["database"]
            and manifest["server_version_num"] == session["pg_version"], "BLOCKED_MANIFEST_CONTRACT")
    exists = any(r["schema"] == "iam" and r["name"] == "schema_migrations"
                 and r["kind"] == "r" for r in manifest["relations"])
    require(exists == (ledger is not None), "BLOCKED_LEDGER_PRESENCE")
    if ledger is not None:
        require(ledger["format"] == "iam-ledger-provenance/v1" and ledger["branch_id"] == FIXTURE
                and isinstance(ledger["rows"], list), "BLOCKED_LEDGER_CONTRACT")
        seen = set()
        for row in ledger["rows"]:
            require(set(row) == {"migration_id","checksum_sha256","source_sha","execution_role","applied_at"}
                    and re.fullmatch(r"\d{4}_[a-z0-9_]+", row["migration_id"])
                    and re.fullmatch(r"[0-9a-f]{64}", row["checksum_sha256"])
                    and re.fullmatch(r"[0-9a-f]{40}", row["source_sha"])
                    and re.fullmatch(r"iam_[a-z0-9_]+", row["execution_role"])
                    and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", row["applied_at"])
                    and row["migration_id"] not in seen, "BLOCKED_LEDGER_ROW")
            seen.add(row["migration_id"])
    # Preserve the server's exact JSON bytes, without logging catalog definitions.
    artifacts = {"session.json": lines[0]+b"\n", "schema-manifest.json": lines[1]+b"\n",
                 "ledger.json": lines[2]+b"\n"}
    index = {"format":"iam-fixture-collector-index/v1","scope":"PG18_FIXTURE_ONLY",
             "checkout_sha":checkout_sha,"manifest_sql_sha256":digest(manifest_bytes),
             "artifact_sha256":{name:digest(content) for name,content in artifacts.items()},
             "ledger_present":exists,"ledger_rows":None if ledger is None else len(ledger["rows"]),
             "authenticated_fixture_session":True,"live_neon_attested":False,
             "signed_baseline":False,"execution_authorized":False}
    artifacts["index.json"] = (json.dumps(index,sort_keys=True,indent=2)+"\n").encode()
    return artifacts

def collect(output):
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("PEOS_BASELINE_COLLECTOR") == "PG18_DISPOSABLE_ONLY"
            and os.environ.get("COLLECTOR_DATABASE_URL") == URL
            and bool(os.environ.get("COLLECTOR_TEST_PASSWORD")), "BLOCKED_NON_FIXTURE_CONTEXT")
    require(not output.exists() and not output.is_symlink(), "BLOCKED_OUTPUT_EXISTS")
    checkout = subprocess.run(["git","-C",str(ROOT),"rev-parse","HEAD"],check=True,
                              capture_output=True,text=True,timeout=5).stdout.strip()
    require(re.fullmatch(r"[0-9a-f]{40}",checkout), "BLOCKED_CHECKOUT")
    # No inherited libpq service files, PGOPTIONS, URL overrides or user rc.
    env={"PATH":os.environ["PATH"],"LC_ALL":"C","PGCONNECT_TIMEOUT":"5",
         "PGSSLMODE":"disable","PGPASSWORD":os.environ["COLLECTOR_TEST_PASSWORD"]}
    sql_bytes=MANIFEST.read_bytes()
    sql=(GUARD.encode()+b"\n"+sql_bytes+b"\n"+LEDGER.encode())
    r=subprocess.run(["psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1",URL],
                     input=sql,env=env,capture_output=True,timeout=30)
    require(r.returncode == 0, "BLOCKED_READONLY_SESSION")
    artifacts=parse_result(r.stdout,sql_bytes,checkout)
    # Exclusive private directory; never overwrite another evidence package.
    output.mkdir(mode=0o700)
    try:
        for name,data in artifacts.items():
            fd=os.open(output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"wb") as f:
                f.write(data)
    except Exception:
        for name in artifacts:
            (output/name).unlink(missing_ok=True)
        output.rmdir()
        raise
    print("PASS_AUTHENTICATED_PG18_READONLY_FIXTURE_COLLECTION")

if __name__ == "__main__":
    os.umask(0o077)
    try:
        require(len(sys.argv)==3 and sys.argv[1]=="--fixture-output","BLOCKED_USAGE")
        collect(Path(sys.argv[2]))
    except Exception as exc:
        # Only fixed safe codes, never psql stderr, paths, SQL or credentials.
        code=str(exc)
        print(code if isinstance(exc,ValueError) and re.fullmatch(r"BLOCKED_[A-Z_]+",code)
              else "BLOCKED_COLLECTOR_FAILURE",file=sys.stderr)
        sys.exit(1)

        OR applied_at IS NULL OR NOT isfinite(applied_at))
  THEN RAISE EXCEPTION 'PEOS_LEDGER_ROW_PROVENANCE'; END IF;
  IF (SELECT count(*) FROM iam.schema_migrations)>10000
  THEN RAISE EXCEPTION 'PEOS_LEDGER_LIMIT'; END IF;
END $ledger$;
SELECT jsonb_build_object('format','iam-ledger-provenance/v1','branch_id','br-fixture-only',
  'rows',coalesce(jsonb_agg(jsonb_build_object('migration_id',migration_id,
  'checksum_sha256',checksum_sha256,'source_sha',source_sha,'execution_role',execution_role,
  'applied_at',to_char(applied_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  ORDER BY migration_id),'[]'::jsonb))::text FROM iam.schema_migrations;
\else
SELECT 'null';
\endif
SELECT jsonb_build_object('backend_pid',pg_backend_pid(),
 'read_only',current_setting('transaction_read_only')='on',
 'isolation',current_setting('transaction_isolation'))::text;
ROLLBACK;
"""
def require(ok, code):
    if not ok:
        raise ValueError(code)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def parse_result(raw, manifest_bytes, checkout_sha):
    require(len(raw) <= MAX_OUTPUT, "BLOCKED_OUTPUT_LIMIT")
    lines = raw.splitlines()
    require(len(lines) == 4, "BLOCKED_RESULT_CONTRACT")
    session, manifest, ledger, final = [json.loads(line) for line in lines]
    require(session["format"] == "iam-fixture-collector-session/v1"
            and session["database"] == "iam_schema_test"
            and session["session_user"] == session["current_user"] == ROLE
            and session["read_only"] is True
            and session["isolation"] == "repeatable read"
            and session["neon_branch_id"] is None
            and 180000 <= session["pg_version"] < 190000
            and final == {"backend_pid": session["backend_pid"], "read_only": True,
                          "isolation": "repeatable read"}, "BLOCKED_SESSION_CONTRACT")
    require(manifest["format"] == "iam-postgresql-schema-manifest/v1"
            and manifest["database"] == session["database"]
            and manifest["server_version_num"] == session["pg_version"], "BLOCKED_MANIFEST_CONTRACT")
    exists = any(r["schema"] == "iam" and r["name"] == "schema_migrations"
                 and r["kind"] == "r" for r in manifest["relations"])
    require(exists == (ledger is not None), "BLOCKED_LEDGER_PRESENCE")
    if ledger is not None:
        require(ledger["format"] == "iam-ledger-provenance/v1" and ledger["branch_id"] == FIXTURE
                and isinstance(ledger["rows"], list), "BLOCKED_LEDGER_CONTRACT")
        seen = set()
        for row in ledger["rows"]:
            require(set(row) == {"migration_id","checksum_sha256","source_sha","execution_role","applied_at"}
                    and re.fullmatch(r"\d{4}_[a-z0-9_]+", row["migration_id"])
                    and re.fullmatch(r"[0-9a-f]{64}", row["checksum_sha256"])
                    and re.fullmatch(r"[0-9a-f]{40}", row["source_sha"])
                    and re.fullmatch(r"iam_[a-z0-9_]+", row["execution_role"])
                    and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", row["applied_at"])
                    and row["migration_id"] not in seen, "BLOCKED_LEDGER_ROW")
            seen.add(row["migration_id"])
    # Preserve the server's exact JSON bytes, without logging catalog definitions.
    artifacts = {"session.json": lines[0]+b"\n", "schema-manifest.json": lines[1]+b"\n",
                 "ledger.json": lines[2]+b"\n"}
    index = {"format":"iam-fixture-collector-index/v1","scope":"PG18_FIXTURE_ONLY",
             "checkout_sha":checkout_sha,"manifest_sql_sha256":digest(manifest_bytes),
             "artifact_sha256":{name:digest(content) for name,content in artifacts.items()},
             "ledger_present":exists,"ledger_rows":None if ledger is None else len(ledger["rows"]),
             "authenticated_fixture_session":True,"live_neon_attested":False,
             "signed_baseline":False,"execution_authorized":False}
    artifacts["index.json"] = (json.dumps(index,sort_keys=True,indent=2)+"\n").encode()
    return artifacts

def collect(output):
    require(os.environ.get("GITHUB_ACTIONS") == "true"
            and os.environ.get("PEOS_BASELINE_COLLECTOR") == "PG18_DISPOSABLE_ONLY"
            and os.environ.get("COLLECTOR_DATABASE_URL") == URL
            and bool(os.environ.get("COLLECTOR_TEST_PASSWORD")), "BLOCKED_NON_FIXTURE_CONTEXT")
    require(not output.exists() and not output.is_symlink(), "BLOCKED_OUTPUT_EXISTS")
    checkout = subprocess.run(["git","-C",str(ROOT),"rev-parse","HEAD"],check=True,
                              capture_output=True,text=True,timeout=5).stdout.strip()
    require(re.fullmatch(r"[0-9a-f]{40}",checkout), "BLOCKED_CHECKOUT")
    # No inherited libpq service files, PGOPTIONS, URL overrides or user rc.
    env={"PATH":os.environ["PATH"],"LC_ALL":"C","PGCONNECT_TIMEOUT":"5",
         "PGSSLMODE":"disable","PGPASSWORD":os.environ["COLLECTOR_TEST_PASSWORD"]}
    sql_bytes=MANIFEST.read_bytes()
    sql=(GUARD.encode()+b"\n"+sql_bytes+b"\n"+LEDGER.encode())
    r=subprocess.run(["psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1",URL],
                     input=sql,env=env,capture_output=True,timeout=30)
    require(r.returncode == 0, "BLOCKED_READONLY_SESSION")
    artifacts=parse_result(r.stdout,sql_bytes,checkout)
    # Exclusive private directory; never overwrite another evidence package.
    output.mkdir(mode=0o700)
    try:
        for name,data in artifacts.items():
            fd=os.open(output/name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(fd,"wb") as f:
                f.write(data)
    except Exception:
        for name in artifacts:
            (output/name).unlink(missing_ok=True)
        output.rmdir()
        raise
    print("PASS_AUTHENTICATED_PG18_READONLY_FIXTURE_COLLECTION")

if __name__ == "__main__":
    os.umask(0o077)
    try:
        require(len(sys.argv)==3 and sys.argv[1]=="--fixture-output","BLOCKED_USAGE")
        collect(Path(sys.argv[2]))
    except Exception as exc:
        # Only fixed safe codes, never psql stderr, paths, SQL or credentials.
        code=str(exc)
        print(code if isinstance(exc,ValueError) and re.fullmatch(r"BLOCKED_[A-Z_]+",code)
              else "BLOCKED_COLLECTOR_FAILURE",file=sys.stderr)
        sys.exit(1)
