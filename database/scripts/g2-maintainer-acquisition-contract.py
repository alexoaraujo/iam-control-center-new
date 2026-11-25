"""G2 v2 candidate contracts only; no live acquisition or administrative writes.

The legacy v1 environment verifier and activation lock are intentionally unchanged.
"""
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("legacy_g2",
    ROOT / ".github/scripts/iam-g2-environment-preflight.py")
v1 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v1)
REPO = v1.REPO
OPERATOR = "alexoaraujo"
ATTEST, ACQUIRE = v1.ATTEST, v1.ACQUIRE
PROJECT = "tiny-rice-70320263"
BRANCH = "br-ancient-term-b6mmx5ol"
ENDPOINT = "ep-winter-leaf-b6cp8d2c"
HOST = "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"
TARGET = {"project_id":PROJECT,"branch_id":BRANCH,"endpoint_id":ENDPOINT,
          "host":HOST,"database":"iam_database","role":"iam_schema_export_reader"}
CONTRACT = {
    ATTEST: (set(), {"IAM_G2_APPROVED_SHA"}),
    ACQUIRE: ({"IAM_G2_READER_PASSWORD"}, {"IAM_G2_APPROVED_SHA",
             "IAM_G2_RECIPIENT_CERT_SHA256","IAM_G2_OPERATOR_SIGNER_SPKI_SHA256"}),
}
SHA = re.compile(r"[0-9a-f]{40}")
HEX = re.compile(r"[0-9a-f]{64}")
RUN = re.compile(r"[1-9][0-9]{0,19}")
Blocked = v1.Blocked
require = v1.require

def pin(value):
    return isinstance(value,str) and HEX.fullmatch(value) is not None

def verify_protection(snapshot, sha):
    require(isinstance(sha,str) and SHA.fullmatch(sha), "INVALID_APPROVED_SHA")
    require(isinstance(snapshot,dict) and all(snapshot.get(k)==sha for k in
        ("checkout_sha","main_before","main_after")), "MAIN_SHA_DRIFT")
    repo = snapshot.get("repository",{})
    require(repo.get("full_name")==REPO and repo.get("default_branch")=="main" and
        repo.get("owner",{}).get("type")=="User", "REPO_SCOPE")
    for field,key in (("repository_secrets","secrets"),("repository_variables","variables")):
        require(not any(n.startswith("IAM_G2_") for n in v1.names(snapshot.get(field),key)),
                "INHERITED_G2_CREDENTIAL")
    envs=snapshot.get("environments",{})
    require(set(envs)==set(CONTRACT), "ENVIRONMENT_SET")
    ids={}
    pins={}
    for name,(expected_secrets,expected_vars) in CONTRACT.items():
        bundle=envs[name]
        env=bundle.get("environment",{})
        require(env.get("name")==name and type(env.get("id")) is int and env["id"]>0,
                "ENVIRONMENT_ID")
        ids[name]=env["id"]
        require(env.get("can_admins_bypass") is False and env.get("deployment_branch_policy")==
            {"protected_branches":False,"custom_branch_policies":True}, "PROTECTION")
        rules=env.get("protection_rules",[])
        require(isinstance(rules,list) and all(isinstance(r,dict) for r in rules), "RULES")
        types=[r.get("type") for r in rules]
        require(types.count("branch_policy")==1 and types.count("required_reviewers")==1 and
            types.count("wait_timer")<=1 and all(x in ("branch_policy","required_reviewers","wait_timer")
            for x in types), "RULE_SET")
        review=next(r for r in rules if r["type"]=="required_reviewers")
        people=review.get("reviewers")
        # Explicit future transition: actual Environment approval by the sole
        # maintainer, not an admin bypass or a fabricated independent review.
        require(review.get("prevent_self_review") is False and isinstance(people,list)
            and len(people)==1 and people[0].get("type")=="User" and
            people[0].get("reviewer",{}).get("login")==OPERATOR, "SOLE_MAINTAINER_REVIEW")
        require(all(r.get("wait_timer")==0 for r in rules if r["type"]=="wait_timer"),"TIMER")
        policies=v1.rows(bundle.get("branches"),"branch_policies")
        require(len(policies)==1 and policies[0].get("name")=="main" and
            policies[0].get("type")=="branch","EXACT_MAIN_ONLY")
        require(v1.rows(bundle.get("custom"),"custom_deployment_protection_rules")==[],
            "CUSTOM_PROTECTION_UNREVIEWED")
        secrets=v1.names(bundle.get("secrets"),"secrets")
        variables=v1.names(bundle.get("variables"),"variables")
        require(set(secrets)==expected_secrets and set(variables)==expected_vars,"CREDENTIAL_SCOPE")
        require(variables["IAM_G2_APPROVED_SHA"].get("value")==sha,"ENVIRONMENT_SHA")
        if name==ACQUIRE:
            for key in ("IAM_G2_RECIPIENT_CERT_SHA256","IAM_G2_OPERATOR_SIGNER_SPKI_SHA256"):
                value=variables[key].get("value")
                require(pin(value),"PIN_INVALID")
                pins[key]=value
    require(len(set(ids.values()))==2,"ENVIRONMENT_COLLISION")
    return {"format":"peos/g2-single-maintainer-protection-candidate/v2",
            "result":"PASS_CANDIDATE_METADATA_ONLY","sha":sha,"environment_ids":ids,
            "pins":pins,"secret_values_verified":False,"operator_approval_verified":False,
            "acquisition_authorized":False,"activation_authorized":False}

def parse_time(value):
    require(isinstance(value,str),"TIME_INVALID")
    try:
        t=dt.datetime.fromisoformat(value.replace("Z","+00:00"))
    except ValueError:
        raise Blocked("TIME_INVALID") from None
    require(t.tzinfo is not None and t.utcoffset()==dt.timedelta(0),"UTC_REQUIRED")
    return t

def openssl(args, data=None):
    try:
        result=subprocess.run(["/usr/bin/openssl",*args],input=data,capture_output=True,
            timeout=10,env={"PATH":"/usr/bin:/bin","LC_ALL":"C"})
    except (OSError,subprocess.SubprocessError):
        raise Blocked("SIGNATURE_TOOL_FAILED") from None
    require(result.returncode==0,"SIGNATURE_INVALID")
    return result.stdout

def verify_receipt(payload, signature, public_der, expected, now):
    """Offline signature/claims only. No trusted clock, live provider readback,
    protected approval, nonce issuance/consumption or execution authority here."""
    require(isinstance(payload,bytes) and 0<len(payload)<=16384 and
        isinstance(signature,bytes) and len(signature)==64 and
        isinstance(public_der,bytes) and len(public_der)==44,"RECEIPT_SIZE")
    # Canonical DER Ed25519 SubjectPublicKeyInfo: fixed algorithm and bit string.
    require(public_der.startswith(bytes.fromhex("302a300506032b6570032100")),"ED25519_REQUIRED")
    require(isinstance(expected,dict) and set(expected)=={
        "sha","run_id","run_attempt","nonce","recipient_pin","signer_pin"},"EXPECTED_CONTEXT")
    require(pin(expected["signer_pin"]) and hashlib.sha256(public_der).hexdigest()==
        expected["signer_pin"],"SIGNER_PIN")
    require(isinstance(expected["sha"],str) and SHA.fullmatch(expected["sha"]) and
        all(isinstance(expected[k],str) and RUN.fullmatch(expected[k]) for k in
        ("run_id","run_attempt")) and pin(expected["nonce"]) and pin(expected["recipient_pin"]),
        "EXPECTED_CONTEXT")
    try:
        doc=json.loads(payload,object_pairs_hook=v1.unique_object)
    except (ValueError,UnicodeError):
        raise Blocked("RECEIPT_JSON") from None
    require(isinstance(doc,dict) and set(doc)=={
        "format","operator","repository","sha","run_id","run_attempt","nonce",
        "target","recipient_pin","observed_at","valid_until","control_plane_permission",
        "metadata_only","acquisition_authorized"},"RECEIPT_FIELDS")
    require(json.dumps(doc,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()==payload,
        "RECEIPT_CANONICAL_BYTES")
    require(doc["format"]=="peos/g2-endpoint-receipt/v2" and doc["operator"]==OPERATOR and
        doc["repository"]==REPO and doc["target"]==TARGET and
        doc["control_plane_permission"]=="ADMIN" and doc["metadata_only"] is True and
        doc["acquisition_authorized"] is False,"RECEIPT_SCOPE")
    require(all(doc[k]==expected[k] for k in
        ("sha","run_id","run_attempt","nonce","recipient_pin")),"RECEIPT_CONTEXT_DRIFT")
    start,end=parse_time(doc["observed_at"]),parse_time(doc["valid_until"])
    require(now.tzinfo is not None and start<=now<end and
        dt.timedelta(0)<end-start<=dt.timedelta(minutes=5),"RECEIPT_EXPIRED_OR_FUTURE")
    with tempfile.TemporaryDirectory(prefix="g2-receipt-") as directory:
        p=Path(directory)
        for name,data in (("key.der",public_der),("receipt.json",payload),("sig",signature)):
            (p/name).write_bytes(data)
        openssl(["pkeyutl","-verify","-pubin","-keyform","DER","-inkey",str(p/"key.der"),
                 "-rawin","-in",str(p/"receipt.json"),"-sigfile",str(p/"sig")])
    return {"result":"PASS_OFFLINE_RECEIPT_SIGNATURE_AND_CLAIMS_ONLY","sha":doc["sha"],
            "receipt_sha256":hashlib.sha256(payload).hexdigest(),"nonce_consumed":False,
            "live_endpoint_verified":False,"protected_approval_verified":False,
            "acquisition_authorized":False,"activation_authorized":False}
