"""Pure review-history candidate; no network, no approval or acquisition action."""
import hashlib
import importlib.util
import json
from pathlib import Path
spec=importlib.util.spec_from_file_location("contract",Path(__file__).with_name("g2-maintainer-acquisition-contract.py"))
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
require=c.require
WORKFLOW=".github/workflows/iam-g2-protected-acquisition.yml" # reserved, not deployed

def approval_comment(sha,run_id,nonce,environment_id):
    return f"PEOS_G2_APPROVE sha={sha} run={run_id} attempt=1 nonce={nonce} environment={environment_id}"

def verify(run,history,expected,environment_ids,operator_id,main_sha):
    # expected must come from trusted challenge issuance, never from the submitted receipt.
    require(isinstance(expected,dict) and c.SHA.fullmatch(expected.get("sha","")) and
        c.RUN.fullmatch(expected.get("run_id","")) and c.pin(expected.get("nonce")) and
        expected.get("run_attempt")=="1","CHALLENGE_CONTEXT")
    require(main_sha==expected["sha"],"MAIN_DRIFT")
    require(type(operator_id) is int and operator_id>0 and set(environment_ids)=={c.ATTEST,c.ACQUIRE}
        and all(type(v) is int and v>0 for v in environment_ids.values())
        and len(set(environment_ids.values()))==2,"PROTECTION_CONTEXT")
    def operator(obj):
        return isinstance(obj,dict) and obj.get("login")==c.OPERATOR and obj.get("id")==operator_id and obj.get("type")=="User"
    require(run.get("id")==int(expected["run_id"]) and run.get("run_attempt")==1
        and run.get("event")=="workflow_dispatch" and run.get("head_branch")=="main"
        and run.get("head_sha")==main_sha and run.get("path")==WORKFLOW
        and run.get("repository",{}).get("full_name")==c.REPO
        and run.get("head_repository",{}).get("full_name")==c.REPO
        and operator(run.get("actor")) and operator(run.get("triggering_actor"))
        and run.get("status")=="in_progress","RUN_IDENTITY")
    # API returns run-level history, not per-attempt timestamps. Refuse reruns,
    # extra/rejected/bypassed/ambiguous reviews and multi-environment approvals.
    require(isinstance(history,list) and len(history)==2,"REVIEW_HISTORY_AMBIGUOUS")
    seen=set()
    for row in history:
        require(isinstance(row,dict) and row.get("state")=="approved" and
            operator(row.get("user")),"ACTUAL_MAINTAINER_REVIEW_REQUIRED")
        envs=row.get("environments")
        require(isinstance(envs,list) and len(envs)==1 and isinstance(envs[0],dict),"REVIEW_ENVIRONMENT")
        name=envs[0].get("name");ident=envs[0].get("id")
        require(name in environment_ids and ident==environment_ids[name] and name not in seen,"REVIEW_ENVIRONMENT")
        require(row.get("comment")==approval_comment(main_sha,expected["run_id"],expected["nonce"],ident),"REVIEW_CHALLENGE_BINDING")
        seen.add(name)
    require(seen==set(environment_ids),"MISSING_REVIEW")
    digest=hashlib.sha256(json.dumps(history,sort_keys=True,separators=(",",":")).encode()).hexdigest()
    return {"result":"PASS_SYNTHETIC_REVIEW_HISTORY_CONTRACT_ONLY","approval_history_sha256":digest,
            "live_approval_verified":False,"acquisition_authorized":False}
