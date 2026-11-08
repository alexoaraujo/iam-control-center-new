#!/usr/bin/env python3
"""Validate the PostgreSQL schema-manifest v1 contract without database access."""
from __future__ import annotations

import json
import sys
from pathlib import Path

REQUIRED_ARRAYS = (
    "schemas", "relations", "sequences", "routines", "aggregates",
    "types", "triggers", "policies", "extensions", "expanded_object_acls",
    "default_acls", "database_acl", "roles", "role_memberships",
)

def main() -> int:
    if len(sys.argv) != 2:
        print("usage: validate-schema-manifest.py MANIFEST.json", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"invalid manifest JSON: {exc}", file=sys.stderr)
        return 1
    if not isinstance(document, dict):
        print("manifest root must be a JSON object", file=sys.stderr)
        return 1
    if document.get("format") != "iam-postgresql-schema-manifest/v1":
        print("unexpected manifest format/version", file=sys.stderr)
        return 1
    if not isinstance(document.get("server_version_num"), int):
        print("server_version_num must be an integer", file=sys.stderr)
        return 1
    missing = [key for key in REQUIRED_ARRAYS
               if not isinstance(document.get(key), list)]
    if missing:
        print("missing or invalid manifest arrays: " + ", ".join(missing),
              file=sys.stderr)
        return 1
    identities = set()
    for relation in document["relations"]:
        identity = (relation.get("schema"), relation.get("name"))
        if not all(identity) or identity in identities:
            print(f"invalid or duplicate relation identity: {identity}",
                  file=sys.stderr)
            return 1
        identities.add(identity)
        for key in ("columns", "constraints", "indexes"):
            if not isinstance(relation.get(key), list):
                print(f"relation {identity} has invalid {key}", file=sys.stderr)
                return 1
    print(
        "PASS schema manifest v1: "
        f"{len(document['schemas'])} schemas, "
        f"{len(document['relations'])} relations, "
        f"{len(document['routines'])} routines, "
        f"{len(document['policies'])} policies"
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
