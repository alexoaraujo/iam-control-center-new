"""Fixture-only GitHub/B2/PG18 retirement handoff. No network or live CLI.

Normalized adapter replies are synthetic, not provider attestations.
No acquisition authority; no credential values or real provider writes.
"""
import datetime as dt
import hashlib
import json
import re

REPO="alexoaraujo/iam-control-center-new"
PREFIX="refs/tags/peos-g2-retired/"
BUCKET="iam-control-center-g2-retirements"
OBJECT_PREFIX="iam-g2/retired/v1/"
MAX_BYTES=4096
ACCOUNT_LIMIT=9_000_000_000
RETENTION=dt.timedelta(days=365)
UTC=dt.timezone.utc
HEX=re.compile(r"[0-9a-f]{64}")
SHA=re.compile(r"[0-9a-f]{40}")
RUN=re.compile(r"[1-9][0-9]{0,18}")
VERSION=re.compile(r"[A-Za-z0-9._+-]{1,512}")
WRITER={"writeFiles"}
READER={"listBuckets","listFiles","readFiles","readBucketRetentions","readFileRetentions"}

class Blocked(Exception):
    pass
def require(ok,code):
    if not ok:raise Blocked(code)
def full(pattern,value):
    return isinstance(value,str) and pattern.fullmatch(value) is not None
def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()
def digest(value):
    return hashlib.sha256(value).hexdigest()
def time(value):
    require(isinstance(value,str),"TIME")
    try:t=dt.datetime.fromisoformat(value.replace("Z","+00:00"))
    except ValueError:raise Blocked("TIME") from None
    require(t.tzinfo is not None and t.utcoffset()==dt.timedelta(0),"UTC")
    return t
def context(ctx,now):
    require(isinstance(ctx,dict) and set(ctx)=={"sha","run_id","attempt","nonce","epoch",
        "receipt_hash","approval_hash","observed_at","valid_until"},"CONTEXT_FIELDS")
    require(full(SHA,ctx["sha"]) and full(RUN,ctx["run_id"]) and ctx["attempt"]==1 and
        type(ctx["attempt"]) is int and all(full(HEX,ctx[k]) for k in
        ("nonce","epoch","receipt_hash","approval_hash")),"CONTEXT")
    start,end=time(ctx["observed_at"]),time(ctx["valid_until"])
    require(start<=now<end and end-start<=dt.timedelta(minutes=5),"EXPIRED")
    return end
def policy(p):
    require(p.get("repository")==REPO and p.get("public") is True and
        p.get("ruleset")=={"target":"tag","enforcement":"active","bypass_actors":[],
        "conditions":{"ref_name":{"include":[PREFIX+"*"],"exclude":[]}},
        "rules":[{"type":"update"},{"type":"deletion"}]},"TAG_RULESET")
    require(p.get("main_only") is True and p.get("admin_bypass") is False and
        p.get("secondary_account_required") is False and p.get("activation_authorized") is False,
        "PROTECTION")
    b=p.get("bucket",{})
    require(b.get("name")==BUCKET and b.get("private") is True and b.get("object_lock") is True and
        b.get("default_mode")=="compliance" and b.get("retention_days")==365 and
        b.get("lifecycle_rules")==[] and isinstance(b.get("id"),str) and bool(b["id"]),
        "BUCKET_POLICY")
    w,r=p.get("writer",{}),p.get("reader",{})
    for key,cap in ((w,WRITER),(r,READER)):
        require(key.get("bucket_id")==b["id"] and key.get("prefix")==OBJECT_PREFIX and
            isinstance(key.get("id"),str) and bool(key["id"]) and
            isinstance(key.get("capabilities"),list) and set(key["capabilities"])==cap and
            len(key["capabilities"])==len(cap),"KEY_SCOPE")
    require(w["id"]!=r["id"] and p.get("g1_credentials_reused") is False,"KEY_SEGREGATION")
    require(p.get("github_reserver_isolated") is True and p.get("neon_consumer_isolated") is True,
        "BROKER_SEGREGATION")
    return b["id"]
def budget(b,now):
    require(b.get("account_wide") is True and b.get("provider_caps_attested") is True and
        dt.timedelta(0)<=now-time(b.get("observed_at"))<=dt.timedelta(seconds=60),"BUDGET_UNATTESTED")
    used,egress=b.get("stored_bytes"),b.get("free_egress_remaining_bytes")
    require(type(used) is int and 0<=used<=ACCOUNT_LIMIT-MAX_BYTES and
        type(egress) is int and egress>=MAX_BYTES,"FREE_TIER_HEADROOM")
def empty_inventory(reply):
    require(reply=={"complete":True,"versions":[]},"B2_PRIOR_VERSION_OR_INCOMPLETE")
def execute_fixture(adapter,ctx,clock):
    """Adapter is a test double ONLY. No actual API/SQL implementations shipped.

    Caller cannot turn a synthetic PASS into operational authorization.
    A successful create MUST be a fresh 201; any other/ambiguous outcome burns
    this attempt. Never retry, update, delete, unburn, or accept existing refs.
    """
    now=clock();end=context(ctx,now)
    bucket_id=policy(adapter.policy())
    budget(adapter.budget(),now)
    ref=PREFIX+"run-"+ctx["run_id"]
    name=OBJECT_PREFIX+"run-"+ctx["run_id"]+".json"
    record={"format":"peos/g2-retirement/v1","repository":REPO,"sha":ctx["sha"],
        "run_id":ctx["run_id"],"attempt":1,"epoch":ctx["epoch"],
        "nonce_sha256":digest(ctx["nonce"].encode()),"receipt_sha256":ctx["receipt_hash"],
        "approval_sha256":ctx["approval_hash"],"observed_at":ctx["observed_at"],
        "valid_until":ctx["valid_until"],"acquisition_authorized":False}
    raw=canonical(record)
    require(len(raw)<=MAX_BYTES,"SIZE")
    empty_inventory(adapter.versions(name))
    # Annotated tag object may be created before ref; only digests and
    # non-sensitive run/SHA metadata are allowed on public GitHub.
    tag=adapter.prepare_tag(ref,ctx["sha"],digest(raw))
    require(full(SHA,tag),"TAG_OBJECT")
    require(clock()<end,"EXPIRED")
    created=adapter.create_ref(ref,tag)
    require(created=={"status":201,"ref":ref,"type":"tag","sha":tag},"REF_NOT_FRESH_OR_AMBIGUOUS")
    require(adapter.read_ref(ref)=={"ref":ref,"type":"tag","sha":tag},"REF_DRIFT")
    require(adapter.read_tag(tag)=={"sha":tag,"target":ctx["sha"],"type":"commit",
        "name":ref.removeprefix("refs/tags/"),"message_sha256":digest(raw)},"TAG_BINDING")
    empty_inventory(adapter.versions(name))
    budget(adapter.budget(),clock())
    require(clock()<end,"EXPIRED")
    archive=canonical({"record":record,"git_ref":ref,"git_tag_sha":tag,"record_sha256":digest(raw)})
    require(len(archive)<=MAX_BYTES,"SIZE")
    uploaded=adapter.upload(name,archive)
    require(isinstance(uploaded,dict) and uploaded.get("status")==200 and
        uploaded.get("bucket_id")==bucket_id and uploaded.get("name")==name and
        full(VERSION,uploaded.get("version_id")),"B2_UPLOAD_AMBIGUOUS")
    version=uploaded["version_id"]
    # Independent reader: exact version, not current/latest. Require retention
    # observed on that version, not merely bucket default or upload response.
    read=adapter.read_version(name,version)
    require(read.get("bucket_id")==bucket_id and read.get("name")==name and
        read.get("version_id")==version and read.get("bytes")==archive and
        read.get("retention_mode")=="compliance" and
        time(read.get("retention_until"))>=now+RETENTION,"B2_READBACK_OR_RETENTION")
    require(adapter.versions(name)=={"complete":True,"versions":[version]},"B2_VERSION_DRIFT")
    require(policy(adapter.policy())==bucket_id and adapter.read_ref(ref)==
        {"ref":ref,"type":"tag","sha":tag},"CUSTODY_DRIFT")
    require(clock()<end,"EXPIRED")
    # Mock primary handoff only. A live consumer must independently verify
    # actual provider policies, Ed25519, approvals and identity; cannot call
    # this candidate with live credentials. No SQL or acquisition here.
    require(adapter.consume_fixture(ctx,digest(archive)) is True,"PRIMARY_REFUSED")
    return {"result":"PASS_SYNTHETIC_GITHUB_B2_PG18_HANDOFF_ONLY","ref":ref,
        "version_id":version,"archive_sha256":digest(archive),
        "live_provider_verified":False,"acquisition_authorized":False,
        "production_authorized":False}
