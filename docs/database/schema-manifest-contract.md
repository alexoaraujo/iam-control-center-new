# PostgreSQL schema manifest contract

## Purpose

`database/scripts/schema-manifest.sql` emits one deterministic JSON document from PostgreSQL catalogs. It is a read-only inventory input for source-to-restore reconciliation; it is not a migration, dump, backup, or proof of equivalence by itself.

Run it with a PostgreSQL 18 client:

```sh
psql -X -v ON_ERROR_STOP=1 -At \
  --no-psqlrc --set=VERBOSITY=terse \
  --file=database/scripts/schema-manifest.sql \
  --dbname="$DATABASE_URL" > schema-manifest.json
```

Use a role with catalog visibility sufficient to read function definitions, ACLs, role metadata, and memberships. Do not grant ledger access to the schema-export role to make this query work. The manifest intentionally does not read rows from application tables or `iam.schema_migrations`.

## Manifest coverage

The v1 document records:

- database identity and PostgreSQL server version;
- non-system schemas and owners;
- relations, relation kind, owner, RLS/FORCE RLS, persistence and replica identity;
- columns, types, nullability, identity/generated attributes, defaults and collation;
- constraints and their validation/deferrability state;
- index definitions and validity/readiness;
- view/materialized-view definitions;
- sequence definitions (not current sequence values);
- function/procedure identity arguments, owner, language, volatility, parallel mode, SECURITY DEFINER and per-routine configuration; routine bodies are deliberately excluded to prevent hard-coded credentials or tokens in function source from being emitted;
- aggregate transition/final/combine/serialization metadata;
- enum labels and domain base/default/nullability/check constraints;
- non-internal triggers and their definitions/enabled state;
- RLS policies, command, mode, roles, USING and WITH CHECK expressions;
- extension name/version/schema/owner;
- expanded database, schema, relation, sequence and routine ACLs;
- default ACLs, role security attributes and role membership edges, including PostgreSQL 16+ INHERIT/SET/ADMIN options.

The ACL arrays are expanded with PostgreSQL defaults when the catalog ACL field is NULL. The field `expanded_object_acls` therefore represents effective catalog ACL entries after default expansion, not a claim that every entry was explicitly stored in the object's ACL column.

## Reconciliation rules

1. Capture source and restore manifests using the same SQL file revision and compatible PostgreSQL major versions.
2. Preserve each raw manifest and SHA-256 checksum as immutable evidence. Record repository SHA, database/branch identity, role used, server version, timestamp, command, and exit code in a separate provenance record.
3. Compare JSON structurally by stable object identity, not by line order or raw text.
4. Do not silently normalize away owners, ACLs, default ACLs, function configuration, RLS flags, policy expressions, extension versions, or membership options. Any normalization must be explicit, documented, and reviewed.
5. Classify provider-managed roles/memberships separately from application roles. Do not treat Neon internal role names or grantors as portable PostgreSQL baseline objects.
6. Compare `iam.schema_migrations` provenance through a separately approved read-only channel. The schema-export role must not receive SELECT on the migration ledger as a side effect of this manifest.
7. The manifest does not contain application rows, routine source text, secret values, current sequence values, or ledger rows. Routine-body equivalence must be established separately through a protected dump/diff process that does not print or publish function source.

## Explicit v1 limitations

The v1 manifest is not yet a complete PostgreSQL cluster/database equivalence proof. It does not inventory routine bodies, database/role GUC settings, tablespace placement, collations and their provider/version metadata, operators/casts, publication/subscription state, foreign-server/user-mapping options, event triggers, rewrite rules, row-security bypass behavior under each runtime principal, or effective privileges computed through all role memberships. Those require separate read-only evidence and runtime privilege tests.

A successful execution proves only that this query can inventory the catalogs visible to the selected principal. It does not prove that the source export was authenticated, that the GitHub Environment is protected, that a dump restores equivalently, or that RLS is secure at runtime.

## Current validation record

- Query file: `database/scripts/schema-manifest.sql`
- Repository branch: `chore/schema-manifest-catalog-contract`
- Tested target: canonical Neon `iam-database-delivery / main / iam_database`
- Execution role: `iam_schema_export_reader`
- Execution mode: single read-only catalog query
- Result: SQL executed successfully and returned the v1 JSON manifest (about 294 KB in the connector response).
- Not tested yet: manifest capture from a restored PostgreSQL 18 database, structural source-vs-restore diff, stable artifact storage/checksum workflow, and independent review.

No DDL, GRANT, migration, seed, role change, or application-data query was performed for this validation.
