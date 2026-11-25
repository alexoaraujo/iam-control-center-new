"""Candidate G2 local operator metadata attestation; no acquisition authority."""
import datetime as dt
import getpass
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import warnings

ROOT = Path(__file__).resolve().parents[2]
REPO = "alexoaraujo/iam-control-center-new"
PROJECT = "tiny-rice-70320263"
ORG = "org-billowing-mouse-09498904"
DEV = "br-ancient-term-b6mmx5ol"
CLONE = "br-solitary-sunset-b681d15f"
EXPIRY = dt.datetime(2026, 11, 26, 3, tzinfo=dt.timezone.utc)
ENDPOINTS = {
    DEV: ("ep-winter-leaf-b6cp8d2c", "ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech"),
    CLONE: ("ep-polished-sound-b6pydcfq", "ep-polished-sound-b6pydcfq.c-2.sa-east-1.aws.neon.tech"),
}
BASE = "https://console.neon.tech/api/v2/projects/" + PROJECT
MAIN = "https://api.github.com/repos/" + REPO + "/git/ref/heads/main"
URLS = {
    "project": BASE,
    "clone": BASE + "/branches/" + CLONE,
    "development": BASE + "/endpoints/" + ENDPOINTS[DEV][0],
    "clone_endpoint": BASE + "/endpoints/" + ENDPOINTS[CLONE][0],
}
SHA = re.compile(r"[0-9a-f]{40}")
CA = "/etc/ssl/certs/ca-certificates.crt"
MAX = 262144

class Blocked(Exception):
    pass

def require(ok, code):
    if not ok:
        raise Blocked(code)

def expiry(value):
    require(isinstance(value, str), "LEASE_EXPIRY_INVALID")
    try:
        result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise Blocked("LEASE_EXPIRY_INVALID") from None
    require(result.tzinfo is not None, "LEASE_EXPIRY_INVALID")
    return result

def verify(documents, sha, now):
    require(isinstance(sha, str) and SHA.fullmatch(sha), "SHA_INVALID")
    require(now.tzinfo is not None and now < EXPIRY, "CLONE_EXPIRED")
    require(isinstance(documents, dict) and set(documents) == set(URLS), "RESPONSE_SET")
    p = documents["project"].get("project", {})
    require(p.get("id") == PROJECT and p.get("org_id") == ORG and p.get("pg_version") == 18,
            "PROJECT_IDENTITY")
    require(p.get("effective_project_permission") == "ADMIN", "OPERATOR_ADMIN_NOT_ATTESTED")
    b = documents["clone"].get("branch", {})
    require(b.get("id") == CLONE and b.get("project_id") == PROJECT and
            b.get("parent_id") == DEV and b.get("current_state") == "ready", "CLONE_BINDING")
    require(expiry(b.get("expires_at")) == EXPIRY, "LEASE_DRIFT")
    endpoints = []
    for name, branch in (("development", DEV), ("clone_endpoint", CLONE)):
        e = documents[name].get("endpoint", {})
        ident, host = ENDPOINTS[branch]
        require(e.get("id") == ident and e.get("project_id") == PROJECT and
                e.get("branch_id") == branch and e.get("host") == host and
                e.get("type") == "read_write" and e.get("disabled") is False,
                "ENDPOINT_BINDING_" + name.upper())
        endpoints.append({"branch_id":branch, "endpoint_id":ident, "host":host})
    return {
        "format":"peos/g2-maintainer-endpoint-observation/v1",
        "result":"PASS_ADMIN_GET_METADATA_ONLY",
        "main_sha":sha, "project_id":PROJECT, "organization_id":ORG, "pg_version":18,
        "control_plane_permission":"ADMIN", "observed_at":now.isoformat(),
        "valid_until":min(EXPIRY, now + dt.timedelta(minutes=5)).isoformat(),
        "clone_expiry":EXPIRY.isoformat(), "endpoints":endpoints,
        "viewer_attested":False, "signed":False, "acquisition_authorized":False,
        "execution_authorized":False, "production_authorized":False,
    }

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Blocked("REDIRECT_REJECTED")

def unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result

def read_json(url, token=None):
    require((url == MAIN and token is None) or (url in URLS.values() and
            isinstance(token, str) and bool(token)), "URL_OR_CREDENTIAL_SCOPE")
    headers = {"Accept":"application/json", "User-Agent":"PEOS-G2-local-attestation/1"}
    if token is not None:
        headers["Authorization"] = "Bearer " + token
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile=CA)))
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with opener.open(req, timeout=12) as response:
            require(response.status == 200 and response.geturl() == url, "HTTP_RESPONSE")
            raw = response.read(MAX + 1)
            require(len(raw) <= MAX, "RESPONSE_TOO_LARGE")
            obj = json.loads(raw, object_pairs_hook=unique)
            require(isinstance(obj, dict), "INVALID_JSON")
            return obj
    except urllib.error.HTTPError as exc:
        raise Blocked("HTTP_" + str(exc.code)) from None
    except (OSError, ValueError, UnicodeError):
        raise Blocked("NETWORK_OR_JSON_FAILED") from None

def checkout(sha):
    def git(*args):
        try:
            return subprocess.run(["/usr/bin/git","-C",str(ROOT),*args],
                capture_output=True, text=True, check=True, timeout=10).stdout.strip()
        except (OSError, subprocess.SubprocessError):
            raise Blocked("CHECKOUT_UNVERIFIED") from None
    require(git("rev-parse","HEAD") == sha and git("symbolic-ref","--short","HEAD") == "main"
            and git("status","--porcelain","--untracked-files=normal") == "", "CHECKOUT_NOT_CLEAN_MAIN")
    require(git("remote","get-url","origin") in (
        "https://github.com/"+REPO+".git", "https://github.com/"+REPO,
        "git@github.com:"+REPO+".git"), "REMOTE_MISMATCH")
    ref = read_json(MAIN)
    require(ref.get("ref") == "refs/heads/main" and ref.get("object",{}).get("type") == "commit"
            and ref.get("object",{}).get("sha") == sha, "MAIN_SHA_DRIFT")

def live(sha):
    require(not os.environ.get("CI") and not os.environ.get("GITHUB_ACTIONS")
            and sys.platform.startswith("linux") and sys.stdin.isatty() and sys.stderr.isatty(),
            "PRIVATE_LINUX_TTY_REQUIRED")
    require(SHA.fullmatch(sha), "SHA_INVALID")
    require(dt.datetime.now(dt.timezone.utc) < EXPIRY, "CLONE_EXPIRED")
    checkout(sha)
    # No credential from environment, argument, file or CI; fail if getpass
    # cannot disable echo. The administrative token remains local.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        token = getpass.getpass("Existing Neon maintainer API key (private, no echo): ")
    require(bool(token) and token == token.strip() and not any(c.isspace() for c in token),
            "CONTROL_PLANE_CREDENTIAL")
    try:
        docs = {name:read_json(url, token) for name,url in URLS.items()}
        checkout(sha)
        return verify(docs, sha, dt.datetime.now(dt.timezone.utc))
    finally:
        del token

if __name__ == "__main__":
    try:
        require(len(sys.argv) == 3 and sys.argv[1] == "--observe-only", "INVALID_USAGE")
        print(json.dumps(live(sys.argv[2]), sort_keys=True))
    except Blocked as exc:
        print("BLOCKED_G2_MAINTAINER_OBSERVATION " + str(exc), file=sys.stderr)
        sys.exit(2)
    except Exception:
        print("BLOCKED_G2_MAINTAINER_OBSERVATION_UNVERIFIED", file=sys.stderr)
        sys.exit(2)
