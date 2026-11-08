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
- Tested source: canonical Neon `twilight-fire-88497009 / main / iam_database`
- Execution role: `iam_schema_export_reader`
- Source capture: single read-only catalog query; no application rows or migration ledger read.
- Restore fixture: pinned schema-only dump and restore contract from PR #86 at `79ae7dcf0f3523fab152f485fe699e90fb7ac6e9`, restored into disposable PostgreSQL 18.6.
- Successful run on SHA `4343952aa26fdc8552f91bf2dc034ffaf5be15be`: database-schema-tests run `42472017801`; both `postgres-18-schema-contract` and `postgres-18-source-schema-restore-manifest` succeeded. CI run `42472017594`, quality job, succeeded.
- Restore validation: 23 tables, 1 view, 9 IAM functions, 7 enums, 12 triggers, 41 policies, 20 FORCE-RLS tables, ownership and pgcrypto verified; no application rows. Signed-context, fail-closed, cross-tenant SELECT/INSERT and tenant isolation contract passed.
- Post-restore manifest: two captures byte-identical; validator v1 passed (4 schemas, 27 relations, 46 routines, 41 policies); full manifest SHA-256 `bd38ab0fb5316573e3cd2db5e7047f71201d2472082fb904a67c9b05f7dee600`.

## Source-to-restore fingerprint comparison (2026-11-08)

The same manifest SQL and JSONB section-hash expression were executed against the Neon source and the disposable restore.

Exact section fingerprint matches:
- `schemas`: 4
- `relations`: 27
- `types`: 7
- `policies`: 41
- `triggers`: 12
- `sequences`: 3
- `aggregates`: 0
- `format` and `server_version_num`

Section differences requiring explicit classification:
- `database` and `server_version`: expected environment identity/provider build differences; the numeric PostgreSQL version matches.
- `default_acls`: source has 9 entries; restore has 0. All nine source entries are owned/granted by Neon provider roles (`cloud_admin` → `neon_superuser`) in schema `public` for tables/sequences. Do not reproduce these provider defaults in the portable baseline.
- `roles` / `role_memberships`: source has 29 roles and 26 membership edges; restore has 21 roles and 3 edges. The source includes Neon provider roles (`cloud_admin`, `iam_database_owner`, `neon_service`, `neon_superuser`) plus environment-provisioned IAM login principals (`iam_migrator_login`, `iam_app_runtime_login`, `iam_worker_login`, `iam_schema_export_reader`). Provider roles/memberships are not portable; application login roles and their grants remain a separate provisioning contract and must not be silently dropped from deployment evidence.
- `database_acl`: source has 9 entries; restore has 5. Source entries include provider-owned grants to `neon_superuser`/`iam_database_owner` plus application-specific `CREATE` for `iam_owner` and `CONNECT` for `iam_schema_export_reader`. The dump restore fixture does not reproduce these database-level grants; preserve them as a separate environment/database bootstrap contract, and do not copy provider-owned grants into portable PostgreSQL.
- `expanded_object_acls`: source has 386 entries; restore has 383. A read-only source query identifies the three source-only entries as `USAGE` on schemas `app_private`, `audit`, and `iam` granted by `iam_owner` to `iam_schema_export_reader`. The schema-only dump/restore fixture does not provision that operational export principal. Treat these as an explicit export-role provisioning contract; do not silently normalize them away.
- `extensions`: both sides have 2 entries, but the section fingerprint differs. Source `pgcrypto` is owned by `iam_database_owner` and `plpgsql` by `cloud_admin`; extension ownership/version/schema differences must be classified as provider-managed only after object-level comparison.
- `routines`: both sides have 46 entries. The source has 37 routines in `public` owned by `cloud_admin` (extension functions) and 9 application routines in `iam`, `audit`, and `app_private` owned by `iam_owner`. The overall fingerprint differs, but the filtered 9-entry `iam_routines` fingerprint matches exactly (`53f2a80a05ceff7bc80a1252563c14eea7608636a3f3cc31c42ba2ef6214ff86`). The 37-entry `public_routines` fingerprint differs (`722ad4149404677ad2a257fd2918b6dd73a690cab60d5fb7b7f942cccb9bd492` source; `bef64a869fa8174016162531de61ce26563d83015de9ded3e9539cb5fa752dc2` restore), consistent with provider-managed extension-function ownership rather than an IAM routine-definition/configuration delta.

These results prove exact equality for the listed structural sections, not full equivalence. ACL, role, extension, and routine deltas remain explicit gates. No provider role or ACL is being copied into the portable restore.

No DDL, GRANT, migration, seed, role change, or application-data query was performed on the Neon source for this validation. Independent review and the protected authenticated export workflow remain separate gates.
