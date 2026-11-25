from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

p=Path(__file__).resolve().parents[1]/"scripts/g2-maintainer-receipt-lifecycle.py"
spec=importlib.util.spec_from_file_location("life",p)
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
NOW=g.o.EXPIRY-dt.timedelta(minutes=10)
SHA="a"*40

class Lifecycle(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.db=g.create_store(self.root/"challenges.sqlite")
        self.key=self.root/"synthetic.key";self.pub=self.root/"pub.der"
        g.c.openssl(["genpkey","-algorithm","ED25519","-out",str(self.key)])
        g.c.openssl(["pkey","-in",str(self.key),"-pubout","-outform","DER","-out",str(self.pub)])
        self.der=self.pub.read_bytes()
        self.pin=hashlib.sha256(self.der).hexdigest()
        self.challenge=g.create_challenge(self.db,SHA,"123","1","b"*64,self.pin,NOW)
        self.expected=self.challenge["context"]
        self.nonce=self.expected["nonce"]
        self.end=g.c.parse_time(self.challenge["expires"])
        self.obs={"result":"PASS_ADMIN_GET_METADATA_ONLY","main_sha":SHA,
            "project_id":g.c.PROJECT,"organization_id":g.o.ORG,"pg_version":18,
            "control_plane_permission":"ADMIN","observed_at":NOW.isoformat(),
            "valid_until":self.end.isoformat(),"clone_expiry":g.o.EXPIRY.isoformat(),
            "endpoints":[{"branch_id":g.c.BRANCH,"endpoint_id":g.c.ENDPOINT,"host":g.c.HOST}],
            **{k:False for k in ("signed","viewer_attested","acquisition_authorized",
                                "execution_authorized","production_authorized")}}
        self.raw=g.receipt_bytes(self.obs,self.expected,NOW,self.end,NOW)
        rawfile=self.root/"receipt.json";rawfile.write_bytes(self.raw)
        self.sig=g.c.openssl(["pkeyutl","-sign","-rawin","-inkey",str(self.key),"-in",str(rawfile)])
    def consume(self):
        return g.consume(self.db,self.nonce,self.raw,self.sig,self.der,NOW)
    def test_durable_replay_rejection_and_no_authorization(self):
        result=self.consume()
        self.assertTrue(result["nonce_consumed"])
        self.assertFalse(result["acquisition_authorized"])
        self.assertFalse(result["protected_approval_verified"])
        with self.assertRaisesRegex(g.Blocked,"NONCE_ALREADY_CONSUMED"):
            self.consume()
        with self.assertRaisesRegex(g.Blocked,"CHALLENGE_ALREADY_ISSUED"):
            g.create_challenge(self.db,SHA,"123","1","b"*64,self.pin,NOW)
    def test_concurrent_single_winner(self):
        def attempt():
            try:return self.consume()["nonce_consumed"]
            except g.Blocked:return False
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(sum(pool.map(lambda _:attempt(),range(4))),1)
    def test_bad_signature_does_not_consume(self):
        with self.assertRaises(g.Blocked):
            g.consume(self.db,self.nonce,self.raw,b"x"*64,self.der,NOW)
        self.assertTrue(self.consume()["nonce_consumed"])
    def test_expired_or_unknown_challenge(self):
        with self.assertRaises(g.Blocked):
            g.consume(self.db,self.nonce,self.raw,self.sig,self.der,self.end)
        with self.assertRaises(g.Blocked):
            g.consume(self.db,"f"*64,self.raw,self.sig,self.der,NOW)
    def test_observation_scope_and_staleness(self):
        for changes in ({"main_sha":"c"*40},{"signed":True},{"acquisition_authorized":True},
                        {"endpoints":[]},{"valid_until":NOW.isoformat()}):
            with self.assertRaises(g.Blocked):
                g.receipt_bytes({**self.obs,**changes},self.expected,NOW,self.end,NOW)
    def test_missing_store_not_recreated(self):
        missing=self.root/"absent.sqlite"
        with self.assertRaises((OSError,g.Blocked)):
            g.consume(missing,self.nonce,self.raw,self.sig,self.der,NOW)
        self.assertFalse(missing.exists())
    def test_private_issuer_refuses_ci(self):
        with patch.dict(g.os.environ,{"CI":"true"}),patch.object(g.o,"live") as live:
            with self.assertRaises(g.Blocked):
                g.issue_live(self.db,self.nonce,self.key,self.der)
            live.assert_not_called()
if __name__=="__main__":unittest.main()
