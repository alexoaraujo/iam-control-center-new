#!/usr/bin/env python3
"""Clone-only, read-only, private direct-login proof. No ACL changes."""
import datetime as dt
import getpass
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import tempfile
import sys
import urllib.request
import warnings

ROOT = Path(__file__).resolve().parents[2]
BRANCH = "br-solitary-sunset-b681d15f"
HOST = "ep-polished-sound-b6pydcfq.c-2.sa-east-1.aws.neon.tech"
DB = "iam_database"
ROLE = "iam_schema_export_reader"
EXPIRY = dt.datetime(2026,11,26,3,tzinfo=dt.timezone.utc)
CA = "/etc/ssl/certs/ca-certificates.crt"
MAIN = "https://api.github.com/repos/alexoaraujo/iam-control-center-new/git/ref/heads/main"
SHA = re.compile(r"[0-9a-f]{40}\Z")

class Blocked(Exception):
    pass

def require(ok, code):
    if not ok:
        raise Blocked(code)

def check_expiry(now):
    require(now.tzinfo is not None and now < EXPIRY, "CLONE_EXPIRED")

def conn_env(password, private_dir=None):
    require(isinstance(password,str) and password and "\0" not in password, "PASSWORD_INVALID")
    return {"PATH":"/usr/bin:/bin","LC_ALL":"C","PGHOST":HOST,"PGPORT":"5432",
            "PGDATABASE":DB,"PGUSER":ROLE,"PGCONNECT_TIMEOUT":"8",
            "PGSSLMODE":"verify-full","PGSSLROOTCERT":CA,
            "PGGSSENCMODE":"disable","PGCHANNELBINDING":"require",
            "PGPASSWORD":password,"PGPASSFILE":"/dev/null",
            "PGSSLCERT":str(Path(private_dir or "/nonexistent")/"no-client.crt"),
            "PGSSLKEY":str(Path(private_dir or "/nonexistent")/"no-client.key"),
            "PGOPTIONS":"-c default_transaction_read_only=on -c statement_timeout=10000"}

SQL = r"""
BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
SELECT json_build_object(
 'branch',current_setting('neon.branch_id',true),
 'database',current_database(),'session_user',session_user,'current_user',current_user,
 'pg_version',current_setting('server_version_num')::int,
 'read_only',current_setting('transaction_read_only')='on',
 'before_expiry',clock_timestamp()<timestamptz '2026-11-26 03:00:00+00',
 'iam_usage',has_schema_privilege(current_user,'iam','USAGE'),
 'ledger_select',(SELECT has_table_privilege(current_user,c.oid,'SELECT')
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='iam' AND c.relname='schema_migrations'),
 'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=current_user::regrole),
 'safe_role',EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcanlogin
 AND NOT rolinherit AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole
 AND NOT rolcreatedb AND NOT rolreplication)
)::text;
ROLLBACK;
"""

def validate(raw):
    require(len(raw)<=8192,"OUTPUT_LIMIT")
    obj=json.loads(raw)
    require(isinstance(obj,dict) and set(obj)=={
      "branch","database","session_user","current_user","pg_version","read_only",
      "before_expiry","iam_usage","ledger_select","memberships","safe_role"},"OUTPUT_CONTRACT")
    require(obj["branch"]==BRANCH and obj["database"]==DB
      and obj["session_user"]==obj["current_user"]==ROLE
      and type(obj["pg_version"]) is int and 180000<=obj["pg_version"]<=189999
      and obj["read_only"] is True and obj["before_expiry"] is True
      and obj["iam_usage"] is False and obj["ledger_select"] is False
      and type(obj["memberships"]) is int and obj["memberships"]==0
      and obj["safe_role"] is True,"SESSION_OR_BASELINE_MISMATCH")
    return {"result":"PASS_CLONE_DIRECT_LOGIN_READONLY_BASELINE",
            "branch":BRANCH,"database":DB,"role":ROLE,"pg_version":obj["pg_version"],
            "sslmode":"verify-full","channel_binding":"require",
            "remediated_functional_proof":False,"acquisition_authorized":False,
            "production_authorized":False}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None

def verify_main(sha):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect(),
      urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=CA)))
    req=urllib.request.Request(MAIN,headers={"Accept":"application/vnd.github+json",
      "User-Agent":"iam-g2-readonly-clone-proof"})
    with opener.open(req,timeout=10) as resp:
        require(resp.status==200,"MAIN_HTTP")
        raw=resp.read(65537)
    require(len(raw)<=65536,"MAIN_LIMIT")
    obj=json.loads(raw)
    require(obj.get("ref")=="refs/heads/main" and obj.get("object",{}).get("type")=="commit"
      and obj["object"].get("sha")==sha,"MAIN_SHA_CHANGED")

def verify_checkout(sha):
    require(SHA.fullmatch(sha) is not None,"APPROVED_SHA_INVALID")
    def git(*args):
        return subprocess.run(["/usr/bin/git","-C",str(ROOT),*args],capture_output=True,
          text=True,check=True,timeout=10).stdout.strip()
    require(Path(git("rev-parse","--show-toplevel")).resolve()==ROOT
      and git("rev-parse","HEAD")==sha and git("status","--porcelain","--untracked-files=normal")=="",
      "CHECKOUT_NOT_EXACT_CLEAN")

def live(sha):
    require(not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS")
      and sys.stdin.isatty() and sys.stdout.isatty(),"PRIVATE_TTY_REQUIRED")
    check_expiry(dt.datetime.now(dt.timezone.utc))
    verify_checkout(sha)
    verify_main(sha)
    with warnings.catch_warnings():
        warnings.simplefilter("error",getpass.GetPassWarning)
        password=getpass.getpass("Existing clone reader password (not stored): ")
    check_expiry(dt.datetime.now(dt.timezone.utc))
    with tempfile.TemporaryDirectory(prefix="g2-login-") as private_dir:
        proc=subprocess.run(["/usr/bin/psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1"],
          input=SQL,text=True,capture_output=True,timeout=20,env=conn_env(password,private_dir))
    del password
    require(proc.returncode==0,"DIRECT_LOGIN_OR_TLS_FAILED")
    result=validate(proc.stdout.strip())
    verify_checkout(sha)
    verify_main(sha)
    check_expiry(dt.datetime.now(dt.timezone.utc))
    return dict(result,source_sha=sha)

if __name__=="__main__":
    try:
        require(len(sys.argv)==2,"USAGE_APPROVED_MAIN_SHA")
        print(json.dumps(live(sys.argv[1]),sort_keys=True))
    except Blocked as exc:
        print("BLOCKED_G2_CLONE_PREFLIGHT "+str(exc),file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("BLOCKED_G2_CLONE_PREFLIGHT_UNVERIFIED",file=sys.stderr)
        sys.exit(2)
