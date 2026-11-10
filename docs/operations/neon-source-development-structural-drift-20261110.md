# Neon IAM — structural drift evidence (2026-11-10)

**Status:** READ-ONLY AUDIT / PARTIAL SCHEMA PARITY / MIGRATION GATE BLOCKED  
**Repository:** `alexoaraujo/iam-control-center-new` · **Related issues:** [#14 — IAM-005](https://github.com/alexoaraujo/iam-control-center-new/issues/14), [#15 — IAM-006](https://github.com/alexoaraujo/iam-control-center-new/issues/15), [#5 — production cutover](https://github.com/alexoaraujo/iam-control-center-new/issues/5).

## Exact scope and guardrails

- Legacy source: Neon `twilight-fire-88497009`, default branch `main` (`br-little-fire-b6adup9f`), database `iam_database`.
- New destination: Neon `tiny-rice-70320263`, branch `development` (`br-ancient-term-b6mmx5ol`), database `iam_database`.
- New destination **Production**: `br-muddy-snow-b63cepcv`, **zero IAM tables**. Never infer readiness from Development.
- Queries were read-only PostgreSQL catalog and metadata SELECTs. They did not copy data, execute DDL, alter grants, move credentials, change branches or deploy Production.
- Hashes below are **drift indicators** of canonical catalog definitions, not cryptographic proof of backup/data equivalence. Owner/grant/extension and dataset parity require separate gates.

## Comparison: canonical object definitions

Catalog fingerprints were computed by sorting each object identifier and normalized definition, joining the rows, and hashing the resulting text via `md5(string_agg(... ORDER BY obj))` on both databases.

| Kind | Source count | New Dev count | Fingerprint comparison |
|---|---:|---:|---|
| Tables (incl. FORCE RLS flags) | 23 | 23 | MATCH |
| Columns (types, defaults, nullability) | 185 | 185 | MATCH |
| Constraints | 244 | 244 | MATCH |
| Indexes | 63 | 63 | MATCH |
| RLS policies | 41 | 41 | MATCH |
| Functions | 9 | 9 | **DIFF** |

The five matching groups had identical source/New Development hashes. The function group differed. No production schema parity is established.

## Root cause isolated: one SECURITY DEFINER function

Of the nine functions, **eight definitions matched byte-for-byte**. The only drift was `iam.set_tenant_context(uuid, uuid, bigint, text, text)`:

| Property | Legacy source | New Development |
|---|---|---|
| SECURITY DEFINER | true | true |
| Owner | `iam_owner` | `iam_owner` |
| Volatility | volatile | volatile |
| `search_path` | `pg_catalog, app_private, iam, public` | `pg_catalog, app_private, iam` |
| Declaration-excluding-search-path fingerprint | `02a473cc4178d3bcd9aa9d5b3eb391d2` | same |
| Login runtime can CREATE in `public` | false | false |

**Interpretation:** New Development includes a narrower `search_path` for a privileged function. This is a deliberate-compatible hardening candidate; **do not revert** it automatically to force hash equality, and do not patch legacy Production without separate review. Validate who else has CREATE in `public` and the trusted names resolved in the function.

## Migration ledger discrepancy

- Source `iam.schema_migrations`: **1 row**.
- New Development `iam.schema_migrations`: **0 rows**.
- New Production: no IAM schema (and hence no IAM migration ledger).

**Blocker:** never fabricate an applied migration entry or silently reset migration history. Establish a signed baseline manifest, historical migration provenance and a reproducible bootstrapping/upgrade procedure before a production release.

## Provenance verified for the legacy ledger row (read-only)

The source ledger row was fetched from `twilight-fire-88497009/main` using the read-only query `SELECT migration_id, checksum_sha256, source_sha, applied_at FROM iam.schema_migrations`. It returned exactly one entry:

| Field | Verified value |
|---|---|
| `migration_id` | `0001_context_key_hardening` |
| `source_sha` | `b80c98c51746e1d49039015eb649b9bdd735ef7f` |
| `checksum_sha256` | `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab` |
| `applied_at` | `2026-11-05T04:16:49.492Z` |
| GitHub source file | [`database/migrations/0001_context_key_hardening.sql` at that exact commit](https://github.com/alexoaraujo/iam-control-center-new/blob/b80c98c51746e1d49039015eb649b9bdd735ef7f/database/migrations/0001_context_key_hardening.sql) |
| SHA-256 recomputed from GitHub UTF-8 file contents | `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab` — **MATCH** |

The hash routine was first checked against the standard SHA-256 vector for `abc`. This verifies the historical ledger references the reviewed GitHub file bytes. It does **not** establish that the destination Development schema was built by executing the same migration, nor that copying the historical ledger entry into the empty destination ledger would be valid. Do not insert the row manually or infer full migration-chain equivalence.

## Additional read-only performance and security signals

- New Development has 20 tables with FORCE RLS and 41 policies. A real `iam_app_runtime_login` session reported `BYPASSRLS=false`, zero visible tenants and zero memberships without tenant context; this does **not** replace full tenant A/B mutation tests.
- No long-running queries (over five minutes) or current locks were returned at audit time.
- 18 non-unique indexes had zero recorded scans at audit time. This Development branch has very little real workload, so **do not drop** any indexes on this basis.
- 4 current branches in New Neon; all compute endpoints have `pooler_enabled=false`. Migrations use direct connections; enable pooling only after driver/runtime testing and an approved provider change.

## Next controlled gates

1. Capture SHA256 manifest of source schema and migration files, owner/grant/extension inventory, and restore it into a **disposable** branch.
2. Review `iam.set_tenant_context` SECURITY DEFINER, search_path safety, grants, and an explicit checked change/ADR.
3. Reconcile the migration ledger by provenance with repeatable bootstrap/upgrade paths; simulate checksums, locks, interrupts and rollback.
4. Execute A/B tenant read/write and negative authorization tests with runtime LOGIN non-BYPASSRLS; attach CI run IDs and SHA.
5. Verify Auth0/Preview exact SHA E2E, backup/restore and staging; close the production gate issue only after formal authorization.

## Reproduction note

Re-run the same **read-only** catalog SELECT against both fixed branch IDs and check policy definitions, indexes, functions, grants, owners, ledger counts and row statistics. Capture commit SHA, timestamp, branch IDs, role, hash inputs and run link. A matching object count or READY deployment alone is insufficient evidence to migrate Production.
