# Offline canonical schema comparison — review-only

This tool compares **two previously exported** JSON files produced by `database/scripts/schema-manifest.sql`. It does not connect to Neon, run SQL, accept credentials, create ledger rows, change schema, or claim source-database parity by itself.

```bash
node scripts/compare-schema-manifests.mjs source-manifest.json target-manifest.json
node --test scripts/compare-schema-manifests.test.mjs
```

Exit codes: 0 = exact manifest parity, 1 = drift, 2 = malformed input. The output prints changed **object identities only**, not function bodies, policy expressions, ACL values, user data or secrets. Manifest files should remain in protected artifacts; do **not** commit real organizational role inventories to the repository.

The comparison deliberately detects differences in database metadata and server version; reconcile environmental differences with explicit reviewed evidence rather than silently suppressing them. A result of PASS is limited to fields included in the manifest v1 contract. `pg_dump --schema-only`, source-owned migration checksums, effective ACL grants, backup/restore, PITR/RPO/RTO, production authorization and data parity are separate gates.

**Read-only baseline evidence (2026-11-12):** legacy source and NEW Development share 182 columns, 244 constraints, 41 policies, 63 indexes, 12 triggers and 24 enum labels with identical catalog fingerprints. Their routine set differs on `iam.set_tenant_context`'s SECURITY DEFINER `search_path` and `app_private.context_keys` has an explicit owner relacl on legacy but NULL relacl on NEW Development. The legacy ledger has 1 historical entry, while NEW Development has 0; NEW Production has no IAM schema. These are findings, **not** approval to fabricate a ledger or execute migration.
