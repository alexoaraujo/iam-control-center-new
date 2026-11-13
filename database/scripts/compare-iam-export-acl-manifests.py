#!/usr/bin/env python3
"""Offline IAM ACL catalog comparator; never connects to a database.

This separates equality of EFFECTIVE table ACLs from byte/structural
identity of pg_class.relacl. A semantic PASS is not a restore/cutover PASS.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

EXPECTED = {"app_private": 1, "audit": 2, "iam": 20}
KNOWN_DRIFT = "app_private.context_keys"
KNOWN_EXPLICIT_OWNER_DEFAULT = "{iam_owner=arwdDxtm/iam_owner}"


class Blocked(ValueError):
    pass


def normalize(rows: object) -> dict[str, dict]:
    if not isinstance(rows, list) or len(rows) != sum(EXPECTED.values()):
        raise Blocked("incorrect relation count")
    found: dict[str, dict] = {}
    counts: Counter[str] = Counter()
    for row in rows:
        if not isinstance(row, dict) or set(row) != {
            "schema", "relation", "owner", "raw_acl", "effective_acl"
        }:
            raise Blocked("invalid manifest fields")
        schema, relation, owner = (row[k] for k in ("schema", "relation", "owner"))
        if (not all(isinstance(s, str) and s and len(s) <= 128
                    for s in (schema, relation, owner))
                or schema not in EXPECTED
                or (row["raw_acl"] is not None
                    and not isinstance(row["raw_acl"], str))):
            raise Blocked("invalid identity or ACL")
        key = schema + "." + relation
        if key in found:
            raise Blocked("duplicate relation")
        privileges = row["effective_acl"]
        if not isinstance(privileges, list) or not privileges:
            raise Blocked("missing effective ACL")
        rights = []
        for entry in privileges:
            if (not isinstance(entry, list) or len(entry) != 4
                    or not all(isinstance(x, str) and x
                               for x in entry[:3])
                    or type(entry[3]) is not bool):
                raise Blocked("invalid effective ACL entry")
            rights.append(tuple(entry))
        if len(set(rights)) != len(rights):
            raise Blocked("duplicate effective ACL entry")
        found[key] = {
            "owner": owner,
            "raw_acl": row["raw_acl"],
            "effective_acl": sorted(rights),
        }
        counts[schema] += 1
    if dict(counts) != EXPECTED:
        raise Blocked("incorrect schema distribution")
    return found


def compare(source: object, clone: object, gate: str) -> tuple[str, list[str]]:
    a, b = normalize(source), normalize(clone)
    if set(a) != set(b):
        raise Blocked("relation names differ")
    effective_drift = sorted(
        key for key in a if a[key]["owner"] != b[key]["owner"]
        or a[key]["effective_acl"] != b[key]["effective_acl"]
    )
    if effective_drift:
        raise Blocked("effective ACL or owner divergence")
    raw_drift = sorted(
        key for key in a if a[key]["raw_acl"] != b[key]["raw_acl"]
    )
    if not raw_drift:
        return "PASS_EXACT_TABLE_ACL_CATALOG", []
    # Only one specifically documented NULL -> explicit owner-default
    # representation is allowed for a *semantic* assessment, never exact.
    if (raw_drift != [KNOWN_DRIFT]
            or a[KNOWN_DRIFT]["raw_acl"] is not None
            or b[KNOWN_DRIFT]["raw_acl"] != KNOWN_EXPLICIT_OWNER_DEFAULT
            or a[KNOWN_DRIFT]["owner"] != "iam_owner"):
        raise Blocked("unapproved raw ACL drift")
    if gate == "exact":
        raise Blocked("exact raw ACL catalog parity not established")
    return "PASS_EFFECTIVE_TABLE_ACL_ONLY_EXACT_CATALOG_BLOCKED", raw_drift


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("clone", type=Path)
    parser.add_argument("--gate", choices=("exact", "effective"), default="exact")
    args = parser.parse_args()
    try:
        # Never echo catalog content or connection data to logs.
        a = json.loads(args.source.read_text(encoding="utf8"))
        b = json.loads(args.clone.read_text(encoding="utf8"))
        verdict, raw_drift = compare(a, b, args.gate)
    except (Blocked, OSError, UnicodeError, json.JSONDecodeError) as exc:
        print("BLOCKED_ACL_GATE: " + type(exc).__name__, file=sys.stderr)
        return 2
    print(verdict)
    if raw_drift:
        print("KNOWN_REPRESENTATIONAL_DRIFT=" + ",".join(raw_drift))
    print("NO_RESTORE_OR_CUTOVER_APPROVAL")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
