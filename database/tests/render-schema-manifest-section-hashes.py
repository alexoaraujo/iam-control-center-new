#!/usr/bin/env python3
"""Render the catalog manifest query as deterministic per-section JSONB hashes."""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: render-schema-manifest-section-hashes.py schema-manifest.sql")

source = Path(sys.argv[1]).read_text(encoding="utf-8")
ending = "SELECT document::text FROM manifest;"
replacement = """SELECT key || E'\\t' ||
       CASE WHEN jsonb_typeof(value) = 'array' THEN jsonb_array_length(value)::text ELSE '-' END
       || E'\\t' ||
       encode(public.digest(value::text || E'\\n', 'sha256'), 'hex')
FROM manifest CROSS JOIN LATERAL jsonb_each(document)
ORDER BY key;"""
if source.count(ending) != 1:
    raise SystemExit("expected exactly one canonical manifest SELECT terminator")
sys.stdout.write(source.replace(ending, replacement))
