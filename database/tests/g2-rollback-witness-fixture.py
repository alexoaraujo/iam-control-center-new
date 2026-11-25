"""Disposable PG18 only. Two logical databases, NOT independent provider custody."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import secrets
import subprocess
from threading import Lock

ROOT=Path(__file__).resolve().parents[2]
PRIMARY="peos_g2_replay_fixture"
WITNESS="peos_g2_witness_fixture"
REPO="alexoaraujo/iam-control-center-new"
SHA="a"*40
EPOCH="e"*64
NONCE="a"*64
RECIP="b"*64
SIGNER="c"*64
RECEIPT="d"*64
APPROVAL="f"*64
def require(ok,msg):
    if not ok:raise RuntimeError(msg)
def main():
    require(os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("PEOS_G2_WITNESS_FIXTURE")=="LOCAL_PG18_ONLY","BLOCKED_NON_FIXTURE")
    admin=os.environ.get("POSTGRES_TEST_PASSWORD")
    require(bool(admin),"MISSING_FIXTURE_PASSWORD")
    passwords={"postgres":admin,"g2_fixture_issue":secrets.token_hex(32),
        "g2_fixture_consume":secrets.token_hex(32),"g2_fixture_reserve":secrets.token_hex(32)}
    def sql(statement,db=PRIMARY,role="postgres",denied=False):
        require(db in (PRIMARY,WITNESS),"FIXTURE_DB")
        env={"PATH":"/usr/bin:/bin","LC_ALL":"C","PGHOST":"127.0.0.1","PGPORT":"5432","PGDATABASE":db,
             "PGUSER":role,"PGPASSWORD":passwords[role],"PGSSLMODE":"disable","PGGSSENCMODE":"disable",
             "PGPASSFILE":"/dev/null","PGCONNECT_TIMEOUT":"5"}
        result=subprocess.run(["/usr/bin/psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose"],
            input=statement,text=True,capture_output=True,timeout=30,env=env)
        if denied:
            require(result.returncode!=0 and re.search(r"ERROR:\s+42501:",result.stderr),"EXPECTED_PERMISSION_DENIAL")
            return ""
        require(result.returncode==0,"FIXTURE_SQL_FAILED")
        return result.stdout.strip()
    require(sql("SELECT current_database()='peos_g2_replay_fixture' AND session_user='postgres' AND current_setting('server_version_num')::int BETWEEN 180000 AND 189999 AND nullif(current_setting('neon.branch_id',true),'') IS NULL AND to_regnamespace('g2_replay') IS NULL AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='peos_g2_witness_fixture');")=="t","WRONG_FIXTURE")
    sql((ROOT/"database/review/g2-shared-replay-fixture.sql").read_text())
    sql("CREATE DATABASE peos_g2_witness_fixture;")
    sql((ROOT/"database/review/g2-rollback-witness-fixture.sql").read_text(),WITNESS)
    sql(f"""CREATE ROLE g2_fixture_issue LOGIN INHERIT PASSWORD '{passwords['g2_fixture_issue']}';
CREATE ROLE g2_fixture_consume LOGIN INHERIT PASSWORD '{passwords['g2_fixture_consume']}';
CREATE ROLE g2_fixture_reserve LOGIN INHERIT PASSWORD '{passwords['g2_fixture_reserve']}';
GRANT g2_replay_issuer TO g2_fixture_issue;
GRANT g2_replay_consumer TO g2_fixture_consume;
GRANT g2_witness_reserver TO g2_fixture_reserve;
REVOKE CONNECT ON DATABASE peos_g2_replay_fixture,peos_g2_witness_fixture FROM PUBLIC;
GRANT CONNECT ON DATABASE peos_g2_replay_fixture TO g2_fixture_issue,g2_fixture_consume;
GRANT CONNECT ON DATABASE peos_g2_witness_fixture TO g2_fixture_reserve;""")
    def issue(nonce,run):
        end=sql(f"SELECT g2_replay.issue('{nonce}','{SHA}',{run},1,'{RECIP}','{SIGNER}',clock_timestamp()+interval '4 minutes');",role="g2_fixture_issue")
        observed=sql("SELECT clock_timestamp();")
        return observed,end
    observed,end=issue(NONCE,123)
    def reserve(nonce=NONCE,run=123,epoch=EPOCH,valid=end):
        return sql(f"SELECT g2_witness.reserve('{epoch}','{REPO}',{run},1,'{nonce}','{SHA}','{RECEIPT}','{APPROVAL}','{valid}'::timestamptz);",WITNESS,"g2_fixture_reserve")
    def consume(nonce=NONCE,run=123,when=observed,valid=end):
        return sql(f"SELECT g2_replay.consume('{nonce}','{SHA}',{run},1,'{RECIP}','{SIGNER}','{when}'::timestamptz,'{valid}'::timestamptz,'{RECEIPT}','{APPROVAL}');",role="g2_fixture_consume")
    for statement in ("SELECT * FROM g2_witness.retired_run;","DELETE FROM g2_witness.retired_run;",
        "TRUNCATE g2_witness.retired_run;","UPDATE g2_witness.epoch_pin SET epoch=repeat('a',64);"):
        sql(statement,WITNESS,"g2_fixture_reserve",denied=True)
    require(reserve(epoch="1"*64)=="f","EPOCH_DRIFT_NOT_REJECTED")
    # Simulate the service boundary: committed reservation before any primary call.
    # Never retry or undo an ambiguous reservation. No production service in this PR.
    primary_calls=[]
    lock=Lock()
    def handoff(reserve_fn,consume_fn):
        if reserve_fn()!="t":return False
        with lock:primary_calls.append(1)
        return consume_fn()=="t"
    with ThreadPoolExecutor(max_workers=8) as pool:
        winners=list(pool.map(lambda _:handoff(reserve,consume),range(8)))
    require(winners.count(True)==1 and len(primary_calls)==1,"WITNESS_CONCURRENCY")
    # Simulate owner restore of pre-consumption primary row. This is deliberate
    # privileged mutation of disposable fixture ONLY; the witness stays untouched.
    sql("UPDATE g2_replay.challenge SET consumed=NULL,receipt_hash=NULL,approval_hash=NULL WHERE run_id=123;")
    require(sql("SELECT count(*) FROM g2_replay.challenge WHERE run_id=123 AND consumed IS NULL;")=="1","RESTORE_SIMULATION")
    require(not handoff(reserve,consume) and len(primary_calls)==1,"PRIMARY_ROLLBACK_REPLAY")
    require(reserve(nonce="9"*64)=="f","RUN_REISSUE_REPLAY")
    # Crash after committed witness reservation but before primary consume burns run.
    other="8"*64;when2,end2=issue(other,124)
    require(reserve(other,124,valid=end2)=="t","BURN_BEFORE_PRIMARY")
    require(not handoff(lambda:reserve(other,124,valid=end2),
        lambda:consume(other,124,when2,end2)),"AMBIGUOUS_BURN_REPLAY")
    require(sql("SELECT count(*) FROM g2_replay.challenge WHERE run_id=124 AND consumed IS NULL;")=="1","NO_PRIMARY_AFTER_BURN")
    # Retirements survive primary rollback; no direct UPDATE/DELETE by reserver.
    require(sql("SELECT count(*) FROM g2_witness.retired_run;",WITNESS)=="2","WITNESS_DURABILITY")
    print("PASS_G2_PG18_FIXTURE_WITNESS_ONE_WINNER_PRIMARY_ROLLBACK_REJECTED_BURNED_RUN_REJECTED")
if __name__=="__main__":main()
