import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

path=Path(__file__).resolve().parents[1]/"scripts/g2-clone-direct-login.py"
spec=importlib.util.spec_from_file_location("probe",path)
p=importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

class Contract(unittest.TestCase):
    def valid(self):
        return dict(branch=p.BRANCH,database=p.DB,session_user=p.ROLE,current_user=p.ROLE,
          pg_version=180007,read_only=True,before_expiry=True,iam_usage=False,
          ledger_select=False,memberships=0,safe_role=True)
    def test_valid(self):
        r=p.validate(json.dumps(self.valid()))
        self.assertFalse(r["remediated_functional_proof"])
        self.assertFalse(r["acquisition_authorized"])
    def test_fail_closed(self):
        for key,val in [("branch","br-ancient-term-b6mmx5ol"),("database","neondb"),
            ("session_user","neondb_owner"),("current_user","iam_owner"),("pg_version",170000),
            ("read_only",False),("before_expiry",False),("iam_usage",True),
            ("ledger_select",True),("memberships",1),("safe_role",False)]:
            with self.subTest(key=key),self.assertRaises(p.Blocked):
                p.validate(json.dumps(dict(self.valid(),**{key:val})))
    def test_fixed_tls(self):
        e=p.conn_env("synthetic")
        self.assertEqual(e["PGHOST"],p.HOST)
        self.assertEqual(e["PGSSLMODE"],"verify-full")
        self.assertEqual(e["PGCHANNELBINDING"],"require")
        self.assertEqual(e["PGGSSENCMODE"],"disable")
        self.assertNotIn("PGSERVICE",e)
        self.assertNotIn("PGHOSTADDR",e)
        with self.assertRaises(p.Blocked): p.conn_env("")
    def test_expiry(self):
        p.check_expiry(p.EXPIRY-dt.timedelta(seconds=1))
        with self.assertRaises(p.Blocked): p.check_expiry(p.EXPIRY)
    def test_no_ddl(self):
        self.assertIn("BEGIN READ ONLY",p.SQL)
        self.assertIn("ROLLBACK",p.SQL)
        for word in ("GRANT ","REVOKE ","INSERT ","UPDATE ","DELETE ","SET ROLE"):
            self.assertNotIn(word,p.SQL)
    def test_platform_block(self):
        with patch.object(p.sys,"platform","win32"):
            with self.assertRaisesRegex(p.Blocked,"LINUX_OR_WSL_REQUIRED"):
                p.live("a"*40)
    def test_missing_clients(self):
        with patch.object(p.sys,"platform","linux"), patch.object(p.os.path,"isfile",return_value=False):
            with self.assertRaisesRegex(p.Blocked,"GIT_CLIENT_MISSING"):
                p.check_local_dependencies()
        with patch.object(p.sys,"platform","linux"), patch.object(p.os.path,"isfile",side_effect=[True,False]), patch.object(p.os,"access",return_value=True):
            with self.assertRaisesRegex(p.Blocked,"PSQL_CLIENT_MISSING"):
                p.check_local_dependencies()
    def test_missing_ca(self):
        with patch.object(p.sys,"platform","linux"), patch.object(p.os.path,"isfile",side_effect=[True,True,False]), patch.object(p.os,"access",return_value=True):
            with self.assertRaisesRegex(p.Blocked,"SYSTEM_CA_MISSING"):
                p.check_local_dependencies()
    def test_git_query_error_redacted(self):
        with patch.object(p.subprocess,"run",side_effect=FileNotFoundError("synthetic-sensitive")):
            with self.assertRaisesRegex(p.Blocked,"^GIT_CHECKOUT_QUERY_FAILED$"):
                p.verify_checkout("a"*40)
if __name__=="__main__": unittest.main()
