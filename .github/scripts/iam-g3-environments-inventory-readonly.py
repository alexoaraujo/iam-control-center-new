#!/usr/bin/env python3
"""Read-only inventory of *all* GitHub Environments; never access secret values.

This is a discovery diagnostic, NOT an approval for privileged G3 execution.
The preexisting seven-Environment policy readback remains the enforcement gate.
"""
import json
import os
import re
import sys
from urllib import request

REPOSITORY = "alexoaraujo/iam-control-center-new"
TARGET_G3 = "IAM-G3-PR128-Disposable-RBAC"
API = f"https://api.github.com/repos/{REPOSITORY}/environments?per_page=100"
# Restrict emitted names to a bounded, non-control-character alphabet.
SAFE_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9 _.-]{0,99}\\Z")


class InventoryBlocked(RuntimeError):
    pass


def interpret_inventory(payload):
    """Require complete single-page inventory; reject malformed/truncated data."""
    if not isinstance(payload, dict):
        raise InventoryBlocked("ENV_INVENTORY_NOT_OBJECT")
    count = payload.get("total_count")
    items = payload.get("environments")
    if type(count) is not int or not isinstance(items, list) or count > 100:
        raise InventoryBlocked("ENV_INVENTORY_TRUNCATED_OR_BAD_COUNT")
    if count != len(items):
        raise InventoryBlocked("ENV_INVENTORY_INCOMPLETE")
    names = []
    for entry in items:
        if not isinstance(entry, dict):
            raise InventoryBlocked("ENV_INVENTORY_INVALID_ITEM")
        name = entry.get("name")
        if not isinstance(name, str) or not SAFE_NAME.fullmatch(name):
            raise InventoryBlocked("ENV_INVENTORY_UNSAFE_NAME")
        names.append(name)
    if len(set(names)) != len(names):
        raise InventoryBlocked("ENV_INVENTORY_DUPLICATE_NAME")
    return sorted(names)


def run(repo, token):
    if repo != REPOSITORY:
        raise InventoryBlocked("ENV_INVENTORY_REPOSITORY_NOT_ALLOWED")
    if not token:
        raise InventoryBlocked("ENV_INVENTORY_TOKEN_MISSING")
    req = request.Request(API, headers={
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "iam-g3-inventory-readonly",
    })
    # Never print the upstream error body, token, headers, or secrets.
    try:
        with request.urlopen(req, timeout=15) as response:
            payload = json.loads(response.read(524288).decode("utf-8"))
    except (OSError, ValueError, UnicodeError):
        raise InventoryBlocked("ENV_INVENTORY_API_UNAVAILABLE") from None
    names = interpret_inventory(payload)
    print("PASS_G3_READONLY_COMPLETE_ENV_INVENTORY count=" + str(len(names)))
    print("G3_READONLY_ENV_NAMES " + json.dumps(names, separators=(",", ":")))
    if TARGET_G3 in names:
        print("G3_ENV_NAME_PRESENT_UNVERIFIED: policy/ref/secret still require separate readback")
    else:
        print("G3_ENV_NAME_NOT_PRESENT: do not attach owner secrets or run positive G3")
    # An inventory's successful read does NOT imply operational authorization.
    print("G3_ENV_CREDENTIAL_ATTESTATION=NOT_PERFORMED")
    print("G3_POSITIVE_HTTP=NOT_RUN")


def main():
    try:
        run(os.environ.get("GITHUB_REPOSITORY"), os.environ.get("GITHUB_TOKEN"))
    except InventoryBlocked as exc:
        print("BLOCKED_G3_ENV_INVENTORY " + str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
