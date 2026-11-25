import copy
import importlib.util
from pathlib import Path
import unittest
p=Path(__file__).resolve().parents[1]/"scripts/g2-maintainer-approval-contract.py"
spec=importlib.util.spec_from_file_location("approval",p)
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
SHA="a"*40; nonce="b"*64; uid=42
expected={"sha":SHA,"run_id":"123","run_attempt":"1","nonce":nonce}
ids={g.c.ATTEST:1,g.c.ACQUIRE:2}
def fixture():
    actor={"login":g.c.OPERATOR,"id":uid,"type":"User"}
    run={"id":123,"run_attempt":1,"event":"workflow_dispatch","head_branch":"main","head_sha":SHA,
         "path":g.WORKFLOW,"repository":{"full_name":g.c.REPO},"head_repository":{"full_name":g.c.REPO},
         "actor":actor,"triggering_actor":actor,"status":"in_progress"}
    reviews=[{"state":"approved","user":dict(actor),"environments":[{"name":name,"id":ident}],
             "comment":g.approval_comment(SHA,"123",nonce,ident)} for name,ident in ids.items()]
    return run,reviews
class Test(unittest.TestCase):
    def test_success_is_not_authorization(self):
        r,h=fixture();x=g.verify(r,h,expected,ids,uid,SHA)
        self.assertFalse(x["acquisition_authorized"]);self.assertFalse(x["live_approval_verified"])
    def test_wrong_run(self):
        for change in ({"run_attempt":2},{"event":"pull_request"},{"head_sha":"c"*40},{"head_branch":"other"},
                       {"path":"other.yml"},{"id":124},{"triggering_actor":{"login":"other"}},{"status":"completed"}):
            r,h=fixture()
            with self.assertRaises(g.c.Blocked):g.verify({**r,**change},h,expected,ids,uid,SHA)
    def test_wrong_approval(self):
        for change in ({"state":"rejected"},{"state":"bypassed"},{"comment":"approved"},
                       {"user":{"login":g.c.OPERATOR,"id":43,"type":"User"}},
                       {"environments":[{"name":g.c.ACQUIRE,"id":99}]}):
            r,h=fixture();h[0].update(change)
            with self.assertRaises(g.c.Blocked):g.verify(r,h,expected,ids,uid,SHA)
        r,h=fixture()
        for history in ([],h[:1],h+h,h[:1]*2):
            with self.assertRaises(g.c.Blocked):g.verify(r,history,expected,ids,uid,SHA)
if __name__=="__main__":unittest.main()
