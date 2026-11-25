"""Local atomic Git reference race + synthetic B2/primary adapter only."""
from concurrent.futures import ThreadPoolExecutor
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/g2-github-b2-custody-contract.py"
spec=importlib.util.spec_from_file_location("g2",p)
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
NOW=dt.datetime(2026,11,25,12,tzinfo=dt.timezone.utc)

def git(path,*args,raw=None,check=True):
    r=subprocess.run(["git","--git-dir",str(path),*args],input=raw,capture_output=True,timeout=15)
    if check and r.returncode:raise RuntimeError("LOCAL_GIT_FIXTURE_FAILED")
    return r

class Fixture:
    def __init__(self,path):
        self.path=path;git(path,"init","--bare")
        tree=git(path,"mktree",raw=b"").stdout.strip().decode()
        self.sha=git(path,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid",
                     "commit-tree",tree,raw=b"synthetic fixture\n").stdout.strip().decode()
        self.lock=threading.Lock();self.archive={};self.consumed=0;self.uploads=0
        self.fail=None;self.ref_calls=0
        self.ctx={"sha":self.sha,"run_id":"123","attempt":1,"nonce":"a"*64,"epoch":"b"*64,
            "receipt_hash":"c"*64,"approval_hash":"d"*64,"observed_at":NOW.isoformat(),
            "valid_until":(NOW+dt.timedelta(minutes=5)).isoformat()}
        self.p={"repository":g.REPO,"public":True,"ruleset":{"target":"tag","enforcement":"active",
            "bypass_actors":[],"conditions":{"ref_name":{"include":[g.PREFIX+"*"],"exclude":[]}},
            "rules":[{"type":"update"},{"type":"deletion"}]},
            "main_only":True,"admin_bypass":False,"secondary_account_required":False,
            "activation_authorized":False,"g1_credentials_reused":False,"github_reserver_isolated":True,
            "neon_consumer_isolated":True,"bucket":{"name":g.BUCKET,"id":"fixture-bucket",
            "private":True,"object_lock":True,"default_mode":"compliance","retention_days":365,
            "lifecycle_rules":[]},"writer":{"id":"fixture-writer","bucket_id":"fixture-bucket",
            "prefix":g.OBJECT_PREFIX,"capabilities":sorted(g.WRITER)},"reader":{"id":"fixture-reader",
            "bucket_id":"fixture-bucket","prefix":g.OBJECT_PREFIX,"capabilities":sorted(g.READER)}}
    def policy(self):return copy.deepcopy(self.p)
    def budget(self):return {"account_wide":True,"provider_caps_attested":True,
        "stored_bytes":g.ACCOUNT_LIMIT if self.fail=="budget" else 1000,
        "free_egress_remaining_bytes":g.MAX_BYTES,"observed_at":NOW.isoformat()}
    def versions(self,name):
        with self.lock:
            return {"complete":self.fail!="pagination","versions":list(self.archive.get(name,{}))}
    def prepare_tag(self,ref,sha,message):
        raw=f"object {sha}\ntype commit\ntag {ref.removeprefix('refs/tags/')}\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\n{message}\n".encode()
        return git(self.path,"mktag",raw=raw).stdout.strip().decode()
    def create_ref(self,ref,sha):
        with self.lock:self.ref_calls+=1
        r=git(self.path,"update-ref",ref,sha,"0"*40,check=False)
        if self.fail=="ambiguous_ref":raise TimeoutError("synthetic lost response")
        return {"status":201 if r.returncode==0 else 422,"ref":ref,"type":"tag","sha":sha}
    def read_ref(self,ref):
        return {"ref":ref,"type":"tag","sha":git(self.path,"rev-parse",ref).stdout.strip().decode()}
    def read_tag(self,tag):
        raw=git(self.path,"cat-file","tag",tag).stdout.decode().splitlines()
        return {"sha":tag,"target":raw[0].split()[1],"type":raw[1].split()[1],
                "name":raw[2][4:],"message_sha256":raw[-1]}
    def upload(self,name,raw):
        with self.lock:
            self.uploads+=1;version=f"fixture-{self.uploads}"
            self.archive.setdefault(name,{})[version]=raw
        if self.fail=="ambiguous_upload":raise TimeoutError("synthetic lost response")
        return {"status":200,"bucket_id":"fixture-bucket","name":name,"version_id":version}
    def read_version(self,name,version):
        raw=self.archive[name][version]
        return {"bucket_id":"fixture-bucket","name":name,"version_id":version,
            "bytes":raw+b"tampered" if self.fail=="bytes" else raw,
            "retention_mode":"governance" if self.fail=="governance" else "compliance",
            "retention_until":(NOW+dt.timedelta(days=364 if self.fail=="short" else 365)).isoformat()}
    def consume_fixture(self,ctx,archive_hash):
        with self.lock:self.consumed+=1
        return self.fail!="primary"

class Contract(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.f=Fixture(Path(self.tmp.name)/"git")
    def execute(self):return g.execute_fixture(self.f,self.f.ctx,lambda:NOW)
    def test_eight_concurrent_local_git_cas(self):
        def attempt():
            try:return self.execute()["result"].startswith("PASS_")
            except g.Blocked:return False
        with ThreadPoolExecutor(max_workers=8) as pool:
            self.assertEqual(sum(pool.map(lambda _:attempt(),range(8))),1)
        self.assertEqual((self.f.uploads,self.f.consumed),(1,1))
        with self.assertRaises(g.Blocked):self.execute()
    def test_independent_archive_blocks_ref_rollback(self):
        result=self.execute()
        self.assertFalse(result["acquisition_authorized"])
        # Administrative deletion only inside disposable local repository.
        git(self.f.path,"update-ref","-d",result["ref"])
        with self.assertRaises(g.Blocked):self.execute()
        self.assertEqual(self.f.consumed,1)
    def test_ambiguous_reservation_burns_run(self):
        self.f.fail="ambiguous_ref"
        with self.assertRaises(TimeoutError):self.execute()
        self.f.fail=None
        with self.assertRaises(g.Blocked):self.execute()
        self.assertEqual((self.f.uploads,self.f.consumed),(0,0))
    def test_ambiguous_upload_never_consumes(self):
        self.f.fail="ambiguous_upload"
        with self.assertRaises(TimeoutError):self.execute()
        self.f.fail=None
        with self.assertRaises(g.Blocked):self.execute()
        self.assertEqual((self.f.uploads,self.f.consumed),(1,0))
    def test_readback_negative(self):
        for reason in ("bytes","governance","short"):
            with self.subTest(reason=reason):
                with tempfile.TemporaryDirectory() as tmp:
                    f=Fixture(Path(tmp)/"git");f.fail=reason
                    with self.assertRaises(g.Blocked):g.execute_fixture(f,f.ctx,lambda:NOW)
                    self.assertEqual(f.consumed,0)
    def test_policy_and_budget(self):
        for reason in ("budget","pagination"):
            self.f.fail=reason
            with self.assertRaises(g.Blocked):self.execute()
        self.f.fail=None
        for field,value in (("admin_bypass",True),("g1_credentials_reused",True),
                            ("github_reserver_isolated",False)):
            p=copy.deepcopy(self.f.p);self.f.p[field]=value
            with self.assertRaises(g.Blocked):self.execute()
            self.f.p=p
        self.f.p["writer"]["capabilities"].append("deleteFiles")
        with self.assertRaises(g.Blocked):self.execute()
        self.assertEqual(self.f.ref_calls,0)
    def test_expired_and_wrong_version(self):
        with self.assertRaises(g.Blocked):
            g.execute_fixture(self.f,self.f.ctx,lambda:NOW+dt.timedelta(minutes=5))
        original=self.f.read_version
        self.f.read_version=lambda name,version:{**original(name,version),"version_id":"other"}
        with self.assertRaises(g.Blocked):self.execute()
        self.assertEqual(self.f.consumed,0)
if __name__=="__main__":unittest.main()
