# IAM G1 — Revogador independente para branch Neon descartável

Data: 2026-11-15. Estado: PREPARADO PARA REVISÃO. NÃO APROVADO PARA GRANT NEON REAL.

## Scope lock

Projeto: tiny-rice-70320263.
Branch: validation/iam-export-lease-rehearsal-20261113, ID br-spring-grass-b6gap6kp, não default, expira 2026-11-16T12:00:00Z.
Database: iam_database.
Direct host: ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech:5432; TLS verify-full e sslrootcert=system.
Reader: iam_schema_export_reader (LOGIN, NOBYPASSRLS, NOINHERIT, sem memberships).
Revoker: sessão independente usando neondb_owner exclusivamente via endpoint da branch, GitHub Environment e segredo separados. Trata-se de principal administrativo, NÃO de role PostgreSQL de privilégios mínimos. O revogador de Development existente não pode ser reutilizado.

## Exact relation allowlist: 23 tables + 1 view

- app_private: context_keys
- audit: events, outbox
- iam: access_policies, api_keys, group_memberships, group_roles, groups, idempotency_keys, identities, identity_providers, invitations, membership_roles, memberships, organizations, permissions, role_permissions, roles, schema_migrations, security_events, service_accounts, sessions, tenants
- iam view: v_effective_membership_permissions

The sequences audit.events_id_seq, audit.outbox_id_seq and iam.security_events_id_seq are excluded.
Only a separately approved GRANT USAGE on schemas iam, audit, app_private and GRANT MAINTAIN on the 24 individually named relations is contemplated. Never GRANT ALL TABLES, SELECT, INSERT, UPDATE, DELETE, TRUNCATE, CREATE, role membership, BYPASSRLS or SUPERUSER. No Development/Production grants.

Read-only Neon metadata confirmed 3 schemas, 23 tables, 1 view, 3 sequences, 20 FORCE RLS tables, 3 tables without FORCE RLS, and currently USAGE=0/3, MAINTAIN=0/24, SELECT=0.
The no-FORCE tables are app_private.context_keys, iam.permissions, iam.schema_migrations.

## MAINTAIN risk acceptance required

MAINTAIN is not a lock-only permission: it can authorize VACUUM, ANALYZE, REINDEX and CLUSTER, among other maintenance operations. Schema USAGE exposes accessible functions, including PUBLIC EXECUTE on SECURITY DEFINER iam.clear_tenant_context(). app_private.context_keys contains sensitive signing secrets and lacks RLS. No blanket SELECT or SECURITY DEFINER workaround is acceptable. The PR #84 PostgreSQL 18 fixture proved synthetic USAGE/MAINTAIN, not a live Neon approval.

## Independent operation

Source: .github/scripts/iam-g1-disposable-emergency-revoke.py
Manual workflow: .github/workflows/iam-g1-disposable-emergency-revoke.yml
Offline tests: .github/tests/test-iam-g1-disposable-emergency-revoke.py
Offline PR workflow: .github/workflows/iam-g1-disposable-revoke-contracts.yml

The script has preflight (catalog SELECT only) and revoke (REVOKE MAINTAIN across all relations in the three allowlisted schemas, including the view; REVOKE USAGE on three schemas; COMMIT; separate-session parity proof). No GRANT/ALTER ROLE/DROP/restore.

Before any privileged operation, configure a new protected environment IAM-G1-Disposable-Lease-Revocation, with required independent reviewer, prevent self-review, no admin bypass where supported and permitted workflow branch main only. Require:
- Variable IAM_G1_DISPOSABLE_PROJECT_ID = tiny-rice-70320263
- Variable IAM_G1_DISPOSABLE_BRANCH_ID = br-spring-grass-b6gap6kp
- Variable IAM_G1_DISPOSABLE_REVOKER_APPROVED_SHA = independent reviewed immutable main SHA
- Secret IAM_G1_DISPOSABLE_REVOKER_URL = distinct branch-admin Direct connection URL, never printed or shared
- Secret IAM_G1_DISPOSABLE_REVOKER_APPROVAL = REVOKE_G1_DISPOSABLE_LEASE_ONLY

Branch ID in vars is not control-plane proof. Reviewer independently checks Neon control plane mapping from endpoint to branch, role scope, TTL and credential independence.
GitHub workflow_dispatch file must exist on default branch, so this PR cannot execute privileged Neon revocation before a separately approved promotion to main. Do not bypass via push, PR or pull_request_target secrets.

## Gate order

1. Read-only branch and privilege manifest, verify no drift and independent rollback capacity.
2. Offline safety contract tests and independent review at exact SHA.
3. Signed runtime identities A and B with synthetic data only in disposable branch: A reads/writes A, B reads/writes B, A cannot read/update B, wrong tenant INSERT rejected, no context SELECT=0/WRITE denied; ensure rollback/cleanup. Raw session GUCs alone do not prove signed-context authorization.
4. Independently approve the risk of MAINTAIN on the exact 24 relations; document TTL and approved operator.
5. Only after approval: short-lived GRANT scoped to this branch, real PostgreSQL 18 schema-only pg_dump with no data, SHA256 and TOC proof; reader still denied SELECT/DML/sequence access.
6. Independent REVOKE in separate connection and COMMIT. Independently prove USAGE=0/3, MAINTAIN=0/24, SELECT/DML=0, sequence access=0 and memberships=0; ensure dump re-denied, RLS unchanged.
7. Any partial grant or post-revoke drift is BLOCKED and requires incident response. Source Development, main, Vercel/Neon Production, live backup/restore and cutover remain untouched.

Outstanding: dedicated protected environment/secret, independent operator review, live signed RLS A/B, real branch GRANT and rollback evidence. Live no-context runtime readback did confirm 0 visible tenants and 0 memberships. No live Neon GRANT/REVOKE was executed.
