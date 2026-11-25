import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

p=Path(__file__).resolve().parents[1]/"scripts/g2-maintainer-acquisition-contract.py"
spec=importlib.util.spec_from_file_location("g2",p)
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
SHA="a"*40
NOW=dt.datetime(2026,11,25,9,tzinfo=dt.timezone.utc)
def listing(key,items):return {"total_count":len(items),key:items}
def snapshot():
    envs={}
    for i,(name,(secrets,variables)) in enumerate(g.CONTRACT.items(),1):
        envs[name]={"environment":{"name":name,"id":i,"can_admins_bypass":False,
           "deployment_branch_policy":{"protected_branches":False,"custom_branch_policies":True},
           "protection_rules":[{"type":"branch_policy"},{"type":"required_reviewers",
              "prevent_self_review":False,"reviewers":[{"type":"User","reviewer":{"login":g.OPERATOR}}]}]},
           "branches":listing("branch_policies",[{"type":"branch","name":"main"}]),
           "custom":listing("custom_deployment_protection_rules",[]),
           "secrets":listing("secrets",[{"name":n} for n in sorted(secrets)]),
           "variables":listing("variables",[{"name":n,"value":SHA if n=="IAM_G2_APPROVED_SHA" else "b"*64}
                for n in sorted(variables)])}
    return {"checkout_sha":SHA,"main_before":SHA,"main_after":SHA,
        "repository":{"full_name":g.REPO,"owner":{"type":"User"},"default_branch":"main"},
        "repository_secrets":listing("secrets",[]),"repository_variables":listing("variables",[]),
        "environments":envs}
class Contracts(unittest.TestCase):
    def test_metadata_only(self):
        x=g.verify_protection(snapshot(),SHA)
        self.assertEqual(x["result"],"PASS_CANDIDATE_METADATA_ONLY")
        self.assertFalse(x["acquisition_authorized"])
    def test_protection_negative(self):
        for change in [
            lambda d:d["environment"].update(can_admins_bypass=True),
            lambda d:d["environment"]["protection_rules"].pop(),
            lambda d:d["environment"]["protection_rules"][1].update(prevent_self_review=True),
            lambda d:d["environment"]["protection_rules"][1]["reviewers"][0]["reviewer"].update(login="another"),
            lambda d:d["branches"]["branch_policies"][0].update(name="*"),
            lambda d:d["secrets"]["secrets"].append({"name":"NEON_API_KEY"}),
            lambda d:d["variables"]["variables"][0].update(value="wrong"),
        ]:
            x=snapshot();change(x["environments"][g.ACQUIRE])
            with self.assertRaises(g.Blocked):g.verify_protection(x,SHA)
        x=snapshot()
        x["environments"][g.ATTEST]["secrets"]=listing("secrets",[{"name":"IAM_G2_NEON_ENDPOINT_READ_TOKEN"}])
        with self.assertRaises(g.Blocked):g.verify_protection(x,SHA)
        x=snapshot();x["main_after"]="c"*40
        with self.assertRaises(g.Blocked):g.verify_protection(x,SHA)
    def test_real_ed25519_synthetic_signature_and_claims(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);key=p/"synthetic.key";pub=p/"pub.der"
            g.openssl(["genpkey","-algorithm","ED25519","-out",str(key)])
            g.openssl(["pkey","-in",str(key),"-pubout","-outform","DER","-out",str(pub)])
            der=pub.read_bytes()
            expected={"sha":SHA,"run_id":"123","run_attempt":"1","nonce":"c"*64,
                "recipient_pin":"d"*64,"signer_pin":hashlib.sha256(der).hexdigest()}
            doc={"format":"peos/g2-endpoint-receipt/v2","operator":g.OPERATOR,
                "repository":g.REPO,**{k:v for k,v in expected.items() if k!="signer_pin"},
                "target":g.TARGET,"observed_at":NOW.isoformat(),
                "valid_until":(NOW+dt.timedelta(minutes=5)).isoformat(),
                "control_plane_permission":"ADMIN","metadata_only":True,"acquisition_authorized":False}
            def sign(d):
                raw=json.dumps(d,sort_keys=True,separators=(",",":"),ensure_ascii=True).encode()
                (p/"in").write_bytes(raw)
                return raw,g.openssl(["pkeyutl","-sign","-rawin","-inkey",str(key),"-in",str(p/"in")])
            raw,sig=sign(doc)
            result=g.verify_receipt(raw,sig,der,expected,NOW)
            self.assertFalse(result["acquisition_authorized"])
            self.assertFalse(result["nonce_consumed"])
            for change in [{"run_attempt":"2"},{"nonce":"f"*64},{"signer_pin":"e"*64},
                           {"recipient_pin":"e"*64},{"sha":"f"*40}]:
                with self.assertRaises(g.Blocked):
                    g.verify_receipt(raw,sig,der,{**expected,**change},NOW)
            with self.assertRaises(g.Blocked):
                g.verify_receipt(raw,bytes([sig[0]^1])+sig[1:],der,expected,NOW)
            with self.assertRaises(g.Blocked):
                g.verify_receipt(raw,sig,der,expected,NOW+dt.timedelta(minutes=5))
            for change in [{"acquisition_authorized":True},{"target":{**g.TARGET,"branch_id":"production"}},
                           {"control_plane_permission":"VIEWER"},{"operator":"another"}]:
                r,s=sign({**doc,**change})
                with self.assertRaises(g.Blocked):g.verify_receipt(r,s,der,expected,NOW)
if __name__=="__main__":unittest.main()
