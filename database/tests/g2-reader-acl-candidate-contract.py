#!/usr/bin/env python3
"""Only a fresh local PG18 CI service. Never use Neon or a live credential."""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DB = "peos_g2_acl_fixture"
PLAN = ROOT / "database/review/g2-reader-acl-candidate.json"
PINS = {"forward":"4a1550f739fd38478b71fd0a293903e6a1037e7a1f71468b1e9853b4e5016500",
        "compensation":"f9d3af5134a0859052a1113a7da76a94d80e01405fc122f80576e301553cb8d1"}
FINGERPRINT = """md5(jsonb_build_array(
 (SELECT nspacl::text FROM pg_namespace WHERE nspname='iam'),
 (SELECT relacl::text FROM pg_class WHERE oid='iam.schema_migrations'::regclass),
 (SELECT proacl::text FROM pg_proc WHERE oid='iam.clear_tenant_context()'::regprocedure))::text)"""
def require(ok, code):
    if not ok:
        raise RuntimeError(code)

def main():
    require(os.environ.get("GITHUB_ACTIONS")=="true" and
            os.environ.get("PEOS_G2_ACL_FIXTURE")=="LOCAL_PG18_ONLY",
            "BLOCKED_NON_FIXTURE")
    plan=json.loads(PLAN.read_bytes())
    require(plan["status"]=="REVIEW_ONLY" and plan["execution_authorized"] is False
            and plan["collector_activation_authorized"] is False, "BLOCKED_ACTIVATION")
    payload={}
    for kind, expected in PINS.items():
        require(isinstance(plan[kind],list) and len(plan[kind])==4 and
                all(isinstance(x,str) and "\n" not in x and ";" not in x for x in plan[kind]),
                "BLOCKED_PAYLOAD")
        payload[kind]=";\n".join(plan[kind])+";\n"
        require(hashlib.sha256(payload[kind].encode()).hexdigest()==expected==plan[kind+"_sha256"],
                "BLOCKED_CHECKSUM")
    admin=os.environ.get("POSTGRES_TEST_PASSWORD")
    require(bool(admin),"BLOCKED_MISSING_FIXTURE_PASSWORD")
    passwords={"postgres":admin,"iam_schema_export_reader":secrets.token_hex(32),
               "iam_app_runtime_login":secrets.token_hex(32)}
    def sql(statement,role="postgres",denied=False):
        env={"PATH":"/usr/bin:/bin","LC_ALL":"C","PGHOST":"127.0.0.1",
             "PGPORT":"5432","PGDATABASE":DB,"PGUSER":role,"PGPASSWORD":passwords[role],
             "PGSSLMODE":"disable","PGGSSENCMODE":"disable","PGPASSFILE":"/dev/null",
             "PGCONNECT_TIMEOUT":"5"}
        r=subprocess.run(["/usr/bin/psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1",
                          "-v","VERBOSITY=verbose"],input=statement,text=True,
                         capture_output=True,timeout=20,env=env)
        if denied:
            require(r.returncode!=0 and re.search(r"ERROR:\s+42501:",r.stderr),
                    "BLOCKED_EXPECTED_PERMISSION_DENIAL")
            return ""
        require(r.returncode==0,"BLOCKED_FIXTURE_SQL")
        return r.stdout.strip()
    context="current_database()='peos_g2_acl_fixture' AND session_user='postgres' AND current_user='postgres' AND current_setting('server_version_num')::int BETWEEN 180000 AND 189999 AND nullif(current_setting('neon.branch_id',true),'') IS NULL AND inet_server_addr() IS NOT NULL"
    require(sql("SELECT "+context+" AND to_regnamespace('iam') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname LIKE 'iam_%');")=="t","BLOCKED_WRONG_CONTEXT")
    sql(f"""BEGIN;
CREATE ROLE iam_owner NOLOGIN;
CREATE ROLE iam_app_runtime NOLOGIN;
CREATE ROLE iam_worker NOLOGIN;
CREATE ROLE iam_migrator NOLOGIN;
CREATE ROLE iam_app_runtime_login LOGIN INHERIT PASSWORD '{passwords["iam_app_runtime_login"]}';
CREATE ROLE iam_schema_export_reader LOGIN NOINHERIT PASSWORD '{passwords["iam_schema_export_reader"]}';
GRANT iam_app_runtime TO iam_app_runtime_login;
CREATE SCHEMA iam AUTHORIZATION iam_owner;
SET LOCAL ROLE iam_owner;
REVOKE ALL ON SCHEMA iam FROM PUBLIC;
GRANT USAGE ON SCHEMA iam TO iam_app_runtime, iam_worker, iam_migrator;
CREATE TABLE iam.schema_migrations(migration_id text PRIMARY KEY);
GRANT SELECT ON iam.schema_migrations TO iam_migrator;
CREATE TABLE iam.private_business_fixture(id integer);
CREATE FUNCTION iam.clear_tenant_context() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog
AS $$ SELECT set_config('iam.tenant_id','',true),set_config('iam.identity_id','',true),set_config('iam.expires_at','',true),set_config('iam.nonce','',true),set_config('iam.signature','',true) $$;
GRANT EXECUTE ON FUNCTION iam.clear_tenant_context() TO iam_app_runtime, iam_worker;
RESET ROLE;
COMMIT;""")
    before=sql("SELECT "+FINGERPRINT+";")
    require(re.fullmatch(r"[0-9a-f]{32}",before),"BLOCKED_FINGERPRINT")
    def guarded(kind, expected):
        require(re.fullmatch(r"[0-9a-f]{32}",expected),"BLOCKED_FINGERPRINT")
        sql("BEGIN; DO $g$ BEGIN IF NOT ("+context+") OR "+FINGERPRINT+
            " IS DISTINCT FROM '"+expected+"' OR (SELECT count(*) FROM iam.schema_migrations)<>0 THEN RAISE EXCEPTION 'BLOCKED_FIXTURE_CONTEXT'; END IF; END $g$;\n"+
            "SET LOCAL ROLE iam_owner;\n"+payload[kind]+"RESET ROLE;\nCOMMIT;")
    changed=None
    try:
        guarded("forward",before)
        changed=sql("SELECT "+FINGERPRINT+";")
        require(changed!=before and re.fullmatch(r"[0-9a-f]{32}",changed),"BLOCKED_NO_CHANGE")
        require(sql("BEGIN READ ONLY; SELECT session_user=current_user AND current_user='iam_schema_export_reader' AND (SELECT count(*) FROM iam.schema_migrations)=0 AND NOT has_table_privilege(current_user,'iam.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AND NOT has_schema_privilege(current_user,'iam','CREATE') AND NOT has_function_privilege(current_user,'iam.clear_tenant_context()','EXECUTE'); ROLLBACK;","iam_schema_export_reader")=="t","BLOCKED_READER")
        sql("SELECT iam.clear_tenant_context();","iam_schema_export_reader",True)
        sql("SELECT 1 FROM iam.private_business_fixture LIMIT 0;","iam_schema_export_reader",True)
        keys=["tenant_id","identity_id","expires_at","nonce","signature"]
        runtime="BEGIN READ ONLY; DO $p$ BEGIN "+" ".join("PERFORM set_config('iam."+k+"','synthetic',true);" for k in keys)+" PERFORM iam.clear_tenant_context(); IF NOT ("+" AND ".join("current_setting('iam."+k+"',true)=''" for k in keys)+") THEN RAISE EXCEPTION 'BLOCKED_CONTEXT_CLEAR'; END IF; END $p$; SELECT session_user=current_user AND current_user='iam_app_runtime_login'; ROLLBACK;"
        require(sql(runtime,"iam_app_runtime_login")=="t","BLOCKED_RUNTIME")
        require(sql("SELECT bool_and(has_function_privilege(r,'iam.clear_tenant_context()','EXECUTE')) FROM unnest(ARRAY['iam_owner','iam_app_runtime','iam_worker','iam_migrator']) r;")=="t","BLOCKED_CALLERS")
    finally:
        if changed is not None:
            guarded("compensation",changed)
    require(sql("SELECT "+FINGERPRINT+";")==before,"BLOCKED_COMPENSATION")
    sql("SELECT count(*) FROM iam.schema_migrations;","iam_schema_export_reader",True)
    require(sql("SELECT count(*)=0 FROM iam.schema_migrations;")=="t","BLOCKED_LEDGER")
    print("PASS_G2_ACL_CANDIDATE_SYNTHETIC_PG18_COMPENSATION")
    print("EXECUTION_AUTHORIZED=false COLLECTOR_ACTIVATION_AUTHORIZED=false")

if __name__=="__main__":
    try:
        main()
    except Exception:
        print("BLOCKED_G2_ACL_CANDIDATE_CONTRACT",flush=True)
        raise SystemExit(2) from None
