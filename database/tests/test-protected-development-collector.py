import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("collector",ROOT/"database/scripts/collect-canonical-development.py")
c=importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class Contract(unittest.TestCase):
    def test_disabled_even_with_matching_context(self):
        sha="a"*40
        env={"GITHUB_ACTIONS":"true","GITHUB_REPOSITORY":c.REPO,"GITHUB_REF":"refs/heads/main",
             "GITHUB_EVENT_NAME":"workflow_dispatch","GITHUB_SHA":sha,"IAM_G2_APPROVED_SHA":sha}
        with self.assertRaisesRegex(ValueError,"BLOCKED_ACTIVATION_NOT_AUTHORIZED"):
            c.approved_context(env,sha)
        for key,value in [("GITHUB_REF","refs/heads/other"),("GITHUB_EVENT_NAME","pull_request"),
                          ("IAM_G2_APPROVED_SHA","b"*40),("GITHUB_REPOSITORY","other/repo")]:
            with self.assertRaisesRegex(ValueError,"BLOCKED_TRUSTED_MAIN"):
                c.approved_context(dict(env,**{key:value}),sha)

    def test_direct_tls_and_fixed_branch(self):
        env=c.connection_env("synthetic")
        self.assertEqual(env["PGSSLMODE"],"verify-full")
        self.assertEqual(env["PGSSLROOTCERT"],c.CA)
        self.assertEqual(env["PGCHANNELBINDING"],"require")
        self.assertEqual(env["PGHOST"],c.HOST)
        self.assertNotIn("PGSERVICE",env)
        sql=c.build_sql(c.fixture.MANIFEST.read_bytes()).decode()
        self.assertIn("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",sql)
        self.assertIn("IS DISTINCT FROM '"+c.BRANCH+"'",sql)
        self.assertIn("current_database() <> 'iam_database'",sql)
        self.assertIn("PEOS_EXPECTED_LEDGER_ABSENT",sql)
        self.assertNotIn("br-fixture-only",sql)
        self.assertNotIn("iam_schema_test",sql)
        self.assertIn("p.prosecdef",sql)

    def test_endpoint_projection(self):
        e={"id":c.ENDPOINT,"project_id":c.PROJECT,"branch_id":c.BRANCH,"host":c.HOST,
           "disabled":False,"pooler_enabled":False,"type":"read_write"}
        self.assertEqual(c.verify_endpoint({"endpoint":e})["branch_id"],c.BRANCH)
        for key,value in [("branch_id","br-muddy-snow-b63cepcv"),("host",c.HOST.replace(".c-2","-pooler.c-2")),
                          ("pooler_enabled",True),("disabled",True),("project_id","wrong")]:
            with self.assertRaisesRegex(ValueError,"BLOCKED_ENDPOINT_BINDING"):
                c.verify_endpoint({"endpoint":dict(e,**{key:value})})

    def test_encrypted_cms_roundtrip_and_wrong_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            subprocess.run(["/usr/bin/openssl","req","-x509","-newkey","rsa:3072","-nodes",
                "-subj","/CN=synthetic-only","-days","1","-keyout",str(p/"key.pem"),
                "-out",str(p/"cert.pem")],capture_output=True,check=True)
            cert=p/"cert.pem"
            fingerprint=c.digest(c.openssl(["x509","-in",str(cert),"-outform","DER"]))
            envelope={"scope":"synthetic-only","execution_authorized":False,"value":"private fixture"}
            encrypted=c.seal(envelope,cert,fingerprint)
            self.assertNotIn(b"private fixture",encrypted)
            decrypted=c.openssl(["cms","-decrypt","-binary","-inform","DER",
                         "-recip",str(cert),"-inkey",str(p/"key.pem")],encrypted)
            self.assertEqual(json.loads(decrypted),envelope)
            with self.assertRaisesRegex(ValueError,"BLOCKED_RECIPIENT_PIN"):
                c.seal(envelope,cert,"0"*64)

if __name__=="__main__":
    unittest.main()
