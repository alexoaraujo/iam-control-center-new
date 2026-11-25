"""G2 candidate receipt lifecycle, local persistent store only.

Never activates acquisition. No CI credential access, no production connection.
A local SQLite store is not a shared GitHub runner anti-replay service.
"""
import datetime as dt
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sqlite3
import stat
import subprocess
import sys
import tempfile
import warnings

HERE=Path(__file__).resolve().parent
def load(name, path):
    spec=importlib.util.spec_from_file_location(name,HERE/path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

c=load("g2_contract","g2-maintainer-acquisition-contract.py")
o=load("g2_observation","g2-maintainer-endpoint-readback.py")
require=c.require
Blocked=c.Blocked
UTC=dt.timezone.utc

def canonical(doc):
    return json.dumps(doc,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()

def utc_now():
    return dt.datetime.now(UTC)

def context(sha,run_id,attempt,recipient_pin,signer_pin):
    require(isinstance(sha,str) and c.SHA.fullmatch(sha) and
            all(isinstance(x,str) and c.RUN.fullmatch(x) for x in (run_id,attempt))
            and c.pin(recipient_pin) and c.pin(signer_pin),"CHALLENGE_CONTEXT")
    return {"sha":sha,"run_id":run_id,"run_attempt":attempt,
            "recipient_pin":recipient_pin,"signer_pin":signer_pin}

def private_path(path, directory=False):
    p=Path(path)
    require(p.is_absolute() and p.resolve()==p,"PRIVATE_PATH_REQUIRED")
    st=p.lstat()
    require(st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)&0o077==0 and
            (stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode))
            and (directory or st.st_nlink==1),"PRIVATE_PATH_PERMISSIONS")
    return p

def create_store(path):
    p=Path(path)
    require(p.is_absolute(),"PRIVATE_PATH_REQUIRED")
    private_path(p.parent,True)
    fd=os.open(p,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    os.close(fd)
    with sqlite3.connect(p) as db:
        db.execute("""CREATE TABLE challenges(
          nonce TEXT PRIMARY KEY, context BLOB NOT NULL,
          run_id TEXT NOT NULL, attempt TEXT NOT NULL,
          created TEXT NOT NULL, expires TEXT NOT NULL,
          consumed TEXT, receipt_sha TEXT,
          UNIQUE(run_id,attempt))""")
        db.execute("PRAGMA user_version=1")
    return p

def connect(path):
    p=private_path(path)
    private_path(p.parent,True)
    # mode=rw refuses a missing store; no silent recreation/reset.
    db=sqlite3.connect(p.as_uri()+"?mode=rw",uri=True,timeout=10,isolation_level=None)
    try:
        require(db.execute("PRAGMA user_version").fetchone()==(1,),"STORE_VERSION")
        return db
    except BaseException:
        db.close()
        raise

def create_challenge(path, sha, run_id, attempt, recipient_pin, signer_pin, now):
    expected=context(sha,run_id,attempt,recipient_pin,signer_pin)
    require(now.tzinfo is not None and now.utcoffset()==dt.timedelta(0) and
            now<o.EXPIRY,"CHALLENGE_EXPIRED")
    nonce=secrets.token_hex(32)
    expected["nonce"]=nonce
    expires=min(now+dt.timedelta(minutes=5),o.EXPIRY)
    db=connect(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT INTO challenges(nonce,context,run_id,attempt,created,expires) VALUES(?,?,?,?,?,?)",
            (nonce,canonical(expected),run_id,attempt,now.isoformat(),expires.isoformat()))
        db.commit()
    except sqlite3.IntegrityError:
        db.rollback()
        raise Blocked("CHALLENGE_ALREADY_ISSUED") from None
    finally:
        db.close()
    return {"context":expected,"created":now.isoformat(),"expires":expires.isoformat(),
            "acquisition_authorized":False}

def get_challenge(db, nonce, now):
    require(c.pin(nonce),"NONCE_INVALID")
    row=db.execute("SELECT context,created,expires,consumed FROM challenges WHERE nonce=?",
                   (nonce,)).fetchone()
    require(row is not None,"NONCE_UNKNOWN")
    raw,created,expires,consumed=row
    require(consumed is None,"NONCE_ALREADY_CONSUMED")
    start,end=c.parse_time(created),c.parse_time(expires)
    require(now.tzinfo is not None and now.utcoffset()==dt.timedelta(0) and
            start<=now<end<=o.EXPIRY,"CHALLENGE_EXPIRED")
    expected=json.loads(raw,object_pairs_hook=c.v1.unique_object)
    require(expected.get("nonce")==nonce,"STORE_CONTEXT_DRIFT")
    return expected,start,end

def receipt_bytes(observation, expected, start, end, now):
    """Pure construction; live issuer obtains observation itself, never from a file."""
    require(observation.get("result")=="PASS_ADMIN_GET_METADATA_ONLY" and
            observation.get("main_sha")==expected["sha"] and
            observation.get("project_id")==c.PROJECT and
            observation.get("organization_id")==o.ORG and observation.get("pg_version")==18 and
            observation.get("control_plane_permission")=="ADMIN" and
            all(observation.get(k) is False for k in ("signed","viewer_attested",
                "acquisition_authorized","execution_authorized","production_authorized")),
            "OBSERVATION_SCOPE")
    require({"branch_id":c.BRANCH,"endpoint_id":c.ENDPOINT,"host":c.HOST} in
            observation.get("endpoints",[]),"OBSERVATION_ENDPOINT")
    observed=c.parse_time(observation["observed_at"])
    expiry=c.parse_time(observation["valid_until"])
    until=min(expiry,end,o.EXPIRY)
    require(start<=observed<=now<until and expiry<=observed+dt.timedelta(minutes=5)
            and c.parse_time(observation["clone_expiry"])==o.EXPIRY,"OBSERVATION_STALE")
    return canonical({"format":"peos/g2-endpoint-receipt/v2","operator":c.OPERATOR,
        "repository":c.REPO,**{k:v for k,v in expected.items() if k!="signer_pin"},
        "target":c.TARGET,"observed_at":observed.isoformat(),"valid_until":until.isoformat(),
        "control_plane_permission":"ADMIN","metadata_only":True,"acquisition_authorized":False})

def sign_private(payload,key_path,public_der):
    # Only the local operator's encrypted PEM, owner-only, never a CI key.
    p=private_path(key_path)
    require(p.stat().st_size<=16384,"KEY_SIZE")
    with p.open("rb") as f:
        require(f.readline().strip()==b"-----BEGIN ENCRYPTED PRIVATE KEY-----","ENCRYPTED_KEY_REQUIRED")
    with warnings.catch_warnings():
        warnings.simplefilter("error",getpass.GetPassWarning)
        password=getpass.getpass("Local Ed25519 key passphrase (private): ")
    require(bool(password) and "\n" not in password and "\r" not in password,"PASSPHRASE_INVALID")
    with tempfile.TemporaryDirectory(prefix="g2-sign-") as tmp:
        f=Path(tmp)/"receipt.json";f.write_bytes(payload)
        try:
            cmd=["/usr/bin/openssl","pkeyutl","-sign","-rawin","-inkey",str(p),
                "-passin","stdin","-in",str(f)]
            r=subprocess.run(cmd,input=(password+"\n").encode(),capture_output=True,timeout=30,
                env={"PATH":"/usr/bin:/bin","LC_ALL":"C"})
            require(r.returncode==0 and len(r.stdout)==64,"SIGNING_FAILED")
            return r.stdout
        finally:
            del password

def issue_live(path,nonce,key_path,public_der):
    """Candidate local emission only; require clean merged main and live metadata."""
    require(not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS")
            and sys.platform.startswith("linux") and sys.stdin.isatty() and sys.stderr.isatty(),
            "PRIVATE_LINUX_TTY_REQUIRED")
    db=connect(path)
    try:
        expected,start,end=get_challenge(db,nonce,utc_now())
    finally:
        db.close()
    require(isinstance(public_der,bytes) and len(public_der)==44 and
            public_der.startswith(bytes.fromhex("302a300506032b6570032100")) and
            hashlib.sha256(public_der).hexdigest()==expected["signer_pin"],"SIGNER_PIN")
    observation=o.live(expected["sha"])
    raw=receipt_bytes(observation,expected,start,end,utc_now())
    sig=sign_private(raw,key_path,public_der)
    o.checkout(expected["sha"])
    c.verify_receipt(raw,sig,public_der,expected,utc_now())
    return raw,sig

def consume(path,nonce,payload,signature,public_der,now):
    """Verify and atomically consume in ONE existing local store; no acquisition."""
    db=connect(path)
    try:
        db.execute("BEGIN IMMEDIATE")
        expected,start,end=get_challenge(db,nonce,now)
        result=c.verify_receipt(payload,signature,public_der,expected,now)
        doc=json.loads(payload,object_pairs_hook=c.v1.unique_object)
        require(start<=c.parse_time(doc["observed_at"]) and
                c.parse_time(doc["valid_until"])<=end,"RECEIPT_OUTSIDE_CHALLENGE")
        changed=db.execute("UPDATE challenges SET consumed=?,receipt_sha=? WHERE nonce=? AND consumed IS NULL",
            (now.isoformat(),result["receipt_sha256"],nonce)).rowcount
        require(changed==1,"NONCE_ALREADY_CONSUMED")
        db.commit()
        return {**result,"result":"PASS_LOCAL_ATOMIC_RECEIPT_CONSUMPTION_ONLY",
                "nonce_consumed":True,"acquisition_authorized":False}
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()
