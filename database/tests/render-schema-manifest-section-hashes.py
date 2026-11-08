#!/usr/bin/env python3
"""Render the catalog manifest query as deterministic per-section JSONB hashes."""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: render-schema-manifest-section-hashes.py schema-manifest.sql")

source = Path(sys.argv[1]).read_text(encoding="utf-8")
ending = "SELECT document::text FROM manifest;"
replacement = """SELECT section || E'\\t' || COALESCE(item_count::text, '-') || E'\\t' || sha256
FROM (
  SELECT key AS section,
         CASE WHEN jsonb_typeof(value) = 'array' THEN jsonb_array_length(value) ELSE NULL END AS item_count,
         encode(public.digest(value::text, 'sha256'), 'hex') AS sha256
  FROM manifest CROSS JOIN LATERAL jsonb_each(document)
  UNION ALL
  SELECT 'iam_routines', count(*),
         encode(public.digest(jsonb_agg(value ORDER BY ordinality)::text, 'sha256'), 'hex')
  FROM manifest CROSS JOIN LATERAL
       jsonb_array_elements(document->'routines') WITH ORDINALITY AS routine(value, ordinality)
  WHERE value->>'schema' IN ('iam','audit','app_private')
  UNION ALL
  SELECT 'public_routines', count(*),
         encode(public.digest(jsonb_agg(value ORDER BY ordinality)::text, 'sha256'), 'hex')
  FROM manifest CROSS JOIN LATERAL
       jsonb_array_elements(document->'routines') WITH ORDINALITY AS routine(value, ordinality)
  WHERE value->>'schema' = 'public'
) hashes
ORDER BY section;"""
if source.count(ending) != 1:
    raise SystemExit("expected exactly one canonical manifest SELECT terminator")
sys.stdout.write(source.replace(ending, replacement))
