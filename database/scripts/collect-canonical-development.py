#!/usr/bin/env python3
"""Staged G2 Development-only acquisition. No DDL, signing or production mode."""
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REPO = "alexoaraujo/iam-control-center-new"
PROJECT = "tiny-rice-70320263"
BRANCH = "br-ancient-term-b6mmx5ol"
ENDPOINT = "ep-winter-leaf-b6cp8d2c"
HOST = "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"
DB = "iam_database"
ROLE = "iam_schema_export_reader"
CA = "/etc/ssl/certs/ca-certificates.crt"
ENVIRONMENT = "IAM-G2-Development-Evidence-Acquisition"
CONTROL_ENV = "IAM-G2-Neon-Endpoint-Attestation"
POLICY = ROOT / "database/baselines/development-collection-policy.json"
HEX = re.compile(r"[0-9a-f]{64}\Z")
SHA = re.compile(r"[0-9a-f]{40}\Z")
# Shared, reviewed SQL and validation from the fixture. No user-supplied SQL.
spec = importlib.util.spec_from_file_location(
    "fixture_collector", ROOT / "database/tests/baseline-evidence-fixture/collector.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def require(condition, code):
    if not condition:
        raise ValueError(code)

def digest(b):
    return hashlib.sha256(b).hexdigest()

def fixed_replace(sql, before, after):
    require(sql.count(before) == 1, "BLOCKED_SHARED_SQL_CONTRACT")
    return sql.replace(before, after, 1)

def read_policy():
    p = json.loads(POLICY.read_bytes())
    require(p == {"format":"iam-development-evidence-collection-policy/v1",
                  "activation_authorized":False,
                  "target":{"project_id":PROJECT,"branch_id":BRANCH,
                            "endpoint_id":ENDPOINT,"host":HOST,"database":DB,"role":ROLE}},
            "BLOCKED_POLICY_CHANGED")
    # Intentionally no operational activation in this review PR. A follow-up
    # must revise this exact guard and policy under independent approval.
    return p

def approved_context(env, sha):
    require(env.get("GITHUB_ACTIONS") == "true"
            and env.get("GITHUB_REPOSITORY") == REPO
            and env.get("GITHUB_REF") == "refs/heads/main"
            and env.get("GITHUB_EVENT_NAME") == "workflow_dispatch"
            and isinstance(sha,str) and SHA.fullmatch(sha)
            and env.get("GITHUB_SHA") == sha
            and env.get("IAM_G2_APPROVED_SHA") == sha,
            "BLOCKED_TRUSTED_MAIN")
    require(read_policy()["activation_authorized"], "BLOCKED_ACTIVATION_NOT_AUTHORIZED")

def verify_endpoint(doc):
    e = doc.get("endpoint", {})
    require(e.get("id") == ENDPOINT and e.get("project_id") == PROJECT
            and e.get("branch_id") == BRANCH and e.get("host") == HOST
            and e.get("disabled") is False and e.get("pooler_enabled") is False
            and e.get("type") == "read_write", "BLOCKED_ENDPOINT_BINDING")
    return {"project_id":PROJECT,"branch_id":BRANCH,"endpoint_id":ENDPOINT,"host":HOST}

def read_endpoint(token):
    require(isinstance(token,str) and bool(token.strip()), "BLOCKED_CONTROL_PLANE_CREDENTIAL")
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise ValueError("BLOCKED_CONTROL_PLANE_REDIRECT")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=CA)))
    url = "https://console.neon.tech/api/v2/projects/"+PROJECT+"/endpoints/"+ENDPOINT
    req = urllib.request.Request(url,headers={"Accept":"application/json","Authorization":"Bearer "+token},method="GET")
    with opener.open(req,timeout=10) as response:
        require(response.status==200,"BLOCKED_CONTROL_PLANE_RESPONSE")
        raw=response.read(262145)
        require(len(raw)<=262144,"BLOCKED_CONTROL_PLANE_RESPONSE")
    return verify_endpoint(json.loads(raw))

def build_sql(manifest):
    guard=fixture.GUARD
    guard=fixed_replace(guard,"current_database() <> 'iam_schema_test'","current_database() <> 'iam_database'")
    before="""    OR nullif(current_setting('neon.branch_id',true),'') IS NOT NULL
    OR inet_server_addr() IS NULL
    OR NOT (inet_server_addr() <<= inet '127.0.0.0/8'
       OR inet_server_addr() <<= inet '172.16.0.0/12'
       OR inet_server_addr() = inet '::1')
"""
    after="""    OR current_setting('neon.branch_id',true) IS DISTINCT FROM 'br-ancient-term-b6mmx5ol'
    OR NOT has_schema_privilege(current_user,'iam','USAGE')
"""
    guard=fixed_replace(guard,before,after)
    guard=fixed_replace(guard,"iam-fixture-collector-session/v1","iam-development-collector-session/v1")
    ledger=fixed_replace(fixture.LEDGER,"'br-fixture-only'","'br-ancient-term-b6mmx5ol'")
    # Existing ledger must be present on Development; a missing ledger is a blocker.
    ledger=fixed_replace(ledger,"SELECT 'null';","DO $missing$ BEGIN RAISE EXCEPTION 'PEOS_EXPECTED_LEDGER_ABSENT'; END $missing$;")
    return guard.encode()+b"\n"+manifest+b"\n"+ledger.encode()

def connection_env(password):
    require(isinstance(password,str) and bool(password) and "\0" not in password,"BLOCKED_READER_CREDENTIAL")
    return {"PATH":"/usr/bin:/bin","LC_ALL":"C","PGCONNECT_TIMEOUT":"8",
            "PGHOST":HOST,"PGPORT":"5432","PGDATABASE":DB,"PGUSER":ROLE,
            "PGSSLMODE":"verify-full","PGSSLROOTCERT":CA,"PGGSSENCMODE":"disable",
            "PGCHANNELBINDING":"require","PGPASSWORD":password}

def validate_snapshot(raw,manifest,sha,binding):
    require(len(raw)<=fixture.MAX_OUTPUT,"BLOCKED_OUTPUT_LIMIT")
    lines=raw.splitlines()
    require(len(lines)==4,"BLOCKED_RESULT_CONTRACT")
    session, schema, ledger, final=[json.loads(x) for x in lines]
    require(session.get("format")=="iam-development-collector-session/v1"
            and session.get("database")==DB and session.get("neon_branch_id")==BRANCH
            and session.get("session_user")==session.get("current_user")==ROLE
            and ledger is not None and ledger.get("branch_id")==BRANCH
            and schema.get("database")==DB,"BLOCKED_LIVE_IDENTITY")
    # Reuse the tested strict row/manifest/backend validator using copies;
    # retain exact original live bytes in the sealed package.
    copied=[dict(session,format="iam-fixture-collector-session/v1",
                 database="iam_schema_test",neon_branch_id=None),
            dict(schema,database="iam_schema_test"),dict(ledger,branch_id="br-fixture-only"),final]
    normalized=b"\n".join(json.dumps(x,separators=(",",":")).encode() for x in copied)+b"\n"
    fixture.parse_result(normalized,manifest,sha)
    originals={name:line+b"\n" for name,line in zip(
        ("session.json","schema-manifest.json","ledger.json"),lines[:3])}
    return {"format":"iam-development-acquisition-envelope/v1","source_sha":sha,
            "endpoint_binding":binding,"database":DB,"role":ROLE,
            "manifest_sql_sha256":digest(manifest),
            "artifacts":{name:{"sha256":digest(value),"base64":base64.b64encode(value).decode()}
                         for name,value in originals.items()},
            "ledger_rows":len(ledger["rows"]),"ledger_provenance_authenticated":False,
            "baseline_approved":False,"execution_authorized":False}

def openssl(args, data=None):
    result=subprocess.run(["/usr/bin/openssl",*args],input=data,capture_output=True,
        timeout=30,env={"PATH":"/usr/bin:/bin","LC_ALL":"C"})
    require(result.returncode==0,"BLOCKED_ENCRYPTION")
    return result.stdout

def seal(envelope, cert_path, fingerprint):
    require(isinstance(fingerprint,str) and HEX.fullmatch(fingerprint),"BLOCKED_RECIPIENT_PIN")
    der=openssl(["x509","-in",str(cert_path),"-outform","DER"])
    require(digest(der)==fingerprint,"BLOCKED_RECIPIENT_PIN")
    openssl(["x509","-in",str(cert_path),"-checkend","0","-noout"])
    pem=openssl(["x509","-in",str(cert_path),"-pubkey","-noout"])
    desc=openssl(["rsa","-pubin","-text","-noout"],pem)
    match=re.search(rb"Public-Key: \((\d+) bit\)",desc)
    require(match and int(match[1])>=3072,"BLOCKED_RECIPIENT_KEY")
    payload=json.dumps(envelope,sort_keys=True,separators=(",",":")).encode()
    return openssl(["cms","-encrypt","-aes-256-gcm","-binary","-outform","DER",
                    "-recip",str(cert_path),"-keyopt","rsa_padding_mode:oaep",
                    "-keyopt","rsa_oaep_md:sha256","-keyopt","rsa_mgf1_md:sha256"],payload)

def acquire(sha,binding,cert_path,output):
    approved_context(os.environ,sha)
    require(binding=={"project_id":PROJECT,"branch_id":BRANCH,
                      "endpoint_id":ENDPOINT,"host":HOST},"BLOCKED_ENDPOINT_BINDING")
    manifest=fixture.MANIFEST.read_bytes()
    result=subprocess.run(["/usr/bin/psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1"],
        input=build_sql(manifest),capture_output=True,timeout=45,
        env=connection_env(os.environ.get("IAM_G2_READER_PASSWORD")))
    require(result.returncode==0,"BLOCKED_READONLY_SESSION")
    envelope=validate_snapshot(result.stdout,manifest,sha,binding)
    ciphertext=seal(envelope,cert_path,os.environ.get("IAM_G2_RECIPIENT_CERT_SHA256"))
    # Only ciphertext is ever written. No plaintext artifacts.
    fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as file:
        file.write(ciphertext)
    print("PASS_DEVELOPMENT_ENCRYPTED_EVIDENCE_SHA256="+digest(ciphertext))

def main():
    require(len(sys.argv)==2 and sys.argv[1]=="--check","BLOCKED_ACTIVATION_NOT_AUTHORIZED")
    read_policy()
    build_sql(fixture.MANIFEST.read_bytes())
    print("PASS_PROTECTED_COLLECTOR_STAGED_NO_LIVE_ACCESS")

if __name__=="__main__":
    os.umask(0o077)
    try:
        main()
    except Exception as exc:
        code=str(exc)
        print(code if isinstance(exc,ValueError) and re.fullmatch(r"BLOCKED_[A-Z_]+",code)
              else "BLOCKED_COLLECTOR_FAILURE",file=sys.stderr)
        sys.exit(1)
