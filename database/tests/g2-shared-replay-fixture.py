"""PG18 local service only; no Neon or IAM connection."""
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import secrets
import subprocess

DB="peos_g2_replay_fixture"
ROOT=Path(__file__).resolve().parents[2]
def require(ok,msg):
    if not ok:raise RuntimeError(msg)
def main():
    require(os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("PEOS_G2_REPLAY_FIXTURE")=="LOCAL_PG18_ONLY","BLOCKED_NON_FIXTURE")
    admin=os.environ.get("POSTGRES_TEST_PASSWORD")
    require(bool(admin),"MISSING_FIXTURE_PASSWORD")
    passwords={"postgres":admin,"g2_fixture_issue":secrets.token_hex(32),"g2_fixture_consume":secrets.token_hex(32)}
    def sql(s,role="postgres",denied=False):
        env={"PATH":"/usr/bin:/bin","LC_ALL":"C","PGHOST":"127.0.0.1","PGPORT":"5432","PGDATABASE":DB,"PGUSER":role,"PGPASSWORD":passwords[role],"PGSSLMODE":"disable","PGGSSENCMODE":"disable","PGPASSFILE":"/dev/null","PGCONNECT_TIMEOUT":"5"}
        r=subprocess.run(["/usr/bin/psql","-X","-w","-qAt","-v","ON_ERROR_STOP=1","-v","VERBOSITY=verbose"],input=s,text=True,capture_output=True,timeout=30,env=env)
        if denied:
            require(r.returncode!=0 and re.search(r"ERROR:\s+42501:",r.stderr),"EXPECTED_DENIAL")
            return ""
        require(r.returncode==0,"FIXTURE_SQL_FAILED")
        return r.stdout.strip()
    require(sql("SELECT current_database()='peos_g2_replay_fixture' AND session_user='postgres' AND current_setting('server_version_num')::int BETWEEN 180000 AND 189999 AND nullif(current_setting('neon.branch_id',true),'') IS NULL AND to_regnamespace('g2_replay') IS NULL;")=="t","WRONG_FIXTURE")
    sql((ROOT/"database/review/g2-shared-replay-fixture.sql").read_text())
    sql(f"""CREATE ROLE g2_fixture_issue LOGIN INHERIT PASSWORD '{passwords['g2_fixture_issue']}';
CREATE ROLE g2_fixture_consume LOGIN INHERIT PASSWORD '{passwords['g2_fixture_consume']}';
GRANT g2_replay_issuer TO g2_fixture_issue;
GRANT g2_replay_consumer TO g2_fixture_consume;""")
    a,b,c,d,e,f=[x*64 for x in "abcdef"];sha="a"*40
    issue=lambda nonce,run,lease="clock_timestamp()+interval '5 minutes'":f"SELECT g2_replay.issue('{nonce}','{sha}',{run},1,'{b}','{c}',{lease});"
    expiry=sql(issue(a,123),"g2_fixture_issue")
    observed=sql("SELECT clock_timestamp();")
    def command(nonce=a,run=123,valid=expiry,when=observed,receipt=d,approval=e):
        return f"SELECT g2_replay.consume('{nonce}','{sha}',{run},1,'{b}','{c}','{when}'::timestamptz,'{valid}'::timestamptz,'{receipt}','{approval}');"
    sql(command(),"g2_fixture_issue",denied=True)
    sql(issue(f,124),"g2_fixture_consume",denied=True)
    for role in ("g2_fixture_issue","g2_fixture_consume"):
        for statement in ("SELECT * FROM g2_replay.challenge;","DELETE FROM g2_replay.challenge;","UPDATE g2_replay.challenge SET consumed=NULL;","TRUNCATE g2_replay.challenge;"):
            sql(statement,role,denied=True)
    require(sql(command(run=999),"g2_fixture_consume")=="f","CONTEXT_MISMATCH")
    require(sql(command(receipt="bad"),"g2_fixture_consume")=="f","BAD_HASH")
    require(sql(command(valid="2000-01-01T00:00:00Z"),"g2_fixture_consume")=="f","EXPIRED_RECEIPT")
    with ThreadPoolExecutor(max_workers=8) as pool:
        winners=list(pool.map(lambda _:sql(command(),"g2_fixture_consume"),range(8)))
    require(winners.count("t")==1 and winners.count("f")==7,"CONCURRENT_REPLAY")
    require(sql(command(),"g2_fixture_consume")=="f","PERSISTENT_REPLAY")
    require(sql("SELECT count(*) FROM g2_replay.challenge WHERE consumed IS NOT NULL;")=="1","DURABLE_COUNT")
    second=sql(issue(f,124,"clock_timestamp()+interval '1 second'"),"g2_fixture_issue")
    sql("SELECT pg_sleep(1.2);")
    require(sql(command(nonce=f,run=124,valid=second),"g2_fixture_consume")=="f","SERVER_CLOCK_EXPIRY")
    print("PASS_G2_SHARED_PG18_FIXTURE_ATOMIC_CONSUMPTION_AND_ROLE_DENIALS_ONLY")
if __name__=="__main__":main()
