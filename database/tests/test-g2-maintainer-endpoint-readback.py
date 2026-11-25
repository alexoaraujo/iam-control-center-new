import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

p = Path(__file__).resolve().parents[1] / "scripts" / "g2-maintainer-endpoint-readback.py"
spec = importlib.util.spec_from_file_location("g2_maintainer", p)
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
SHA = "a" * 40
NOW = g.EXPIRY - dt.timedelta(minutes=10)

def fixture():
    docs = {"project":{"project":{"id":g.PROJECT,"org_id":g.ORG,
            "pg_version":18,"effective_project_permission":"ADMIN"}},
            "clone":{"branch":{"id":g.CLONE,"project_id":g.PROJECT,
            "parent_id":g.DEV,"current_state":"ready","expires_at":g.EXPIRY.isoformat()}}}
    for key, branch in (("development",g.DEV),("clone_endpoint",g.CLONE)):
        ident,host = g.ENDPOINTS[branch]
        docs[key] = {"endpoint":{"id":ident,"project_id":g.PROJECT,"branch_id":branch,
                    "host":host,"type":"read_write","disabled":False}}
    return docs

class Contract(unittest.TestCase):
    def test_exact_metadata_is_not_viewer_or_execution_authority(self):
        result = g.verify(fixture(), SHA, NOW)
        self.assertEqual(result["result"],"PASS_ADMIN_GET_METADATA_ONLY")
        self.assertEqual(result["main_sha"],SHA)
        for key in ("viewer_attested","signed","acquisition_authorized","execution_authorized","production_authorized"):
            self.assertIs(result[key],False)
        self.assertEqual(g.expiry(result["valid_until"]),NOW+dt.timedelta(minutes=5))
    def test_rejects_identity_or_scope_drift(self):
        for section,key,value in [
            ("project","id","other"),("project","org_id","other"),("project","pg_version",17),
            ("project","effective_project_permission","VIEWER"),("clone","parent_id","production"),
            ("clone","expires_at","2026-11-27T03:00:00Z"),("clone","current_state","archived"),
            ("development","branch_id",g.CLONE),("development","host","untrusted.invalid"),
            ("clone_endpoint","id","ep-other"),("clone_endpoint","disabled",True),
            ("clone_endpoint","type","read_only")]:
            with self.subTest(section=section,key=key,value=value):
                docs=fixture()
                inner="project" if section=="project" else "branch" if section=="clone" else "endpoint"
                docs[section][inner][key]=value
                with self.assertRaises(g.Blocked):
                    g.verify(docs,SHA,NOW)
    def test_lease_cannot_extend_receipt(self):
        now=g.EXPIRY-dt.timedelta(seconds=30)
        self.assertEqual(g.expiry(g.verify(fixture(),SHA,now)["valid_until"]),g.EXPIRY)
        with self.assertRaises(g.Blocked):
            g.verify(fixture(),SHA,g.EXPIRY)
    def test_missing_and_bad_sha(self):
        with self.assertRaises(g.Blocked):
            g.verify(fixture(),"short",NOW)
        docs=fixture();del docs["clone"]
        with self.assertRaises(g.Blocked):
            g.verify(docs,SHA,NOW)
    def test_network_scope_fails_before_network(self):
        for url,token in [(g.MAIN,"private"),("https://example.invalid","private"),(g.URLS["clone"],None)]:
            with self.assertRaises(g.Blocked):
                g.read_json(url,token)
    def test_ci_cannot_use_live_prompt(self):
        with patch.dict(g.os.environ,{"CI":"true"}),patch.object(g.getpass,"getpass") as prompt:
            with self.assertRaises(g.Blocked):
                g.live(SHA)
            prompt.assert_not_called()
    def test_duplicate_keys_and_redirect(self):
        with self.assertRaises(g.Blocked):
            g.unique([("x",1),("x",2)])
        with self.assertRaises(g.Blocked):
            g.NoRedirect().redirect_request(None,None,None,None,None,"https://example.invalid")

if __name__ == "__main__":
    unittest.main()
