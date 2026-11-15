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


---

## GitHub protected Environment — verified configuration contract (2026-11-15)
<!-- IAM-G1-ADMIN-ENV-BOOTSTRAP-20261115 -->

GitHub account/repo is PUBLIC (Free environment protection is supported), main is default.
GitHub collaborator alexoaraujo83 has WRITE access and is distinct from the
connected GitHub operator alexoaraujo. Exact PR #85 reviewed HEAD prior to these
changes was c65aa38f19f1b00d188cb09bf8b56a9ce3e1d586; **any later SHA
requires a NEW independent review**. A GitHub PR code review is not equivalent to
a GitHub Environment deployment approval, and neither is MAINTAIN permission.

Neon API control-plane verification, without credentials/SQL mutations:
- project_id: tiny-rice-70320263
- branch_id: br-spring-grass-b6gap6kp
- branch: validation/iam-export-lease-rehearsal-20261113
- endpoint id: ep-sparkling-sea-b6iw0z9y
- direct host: ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech
- DB: iam_database
- branch READY, not default, not protected, expires 2026-11-16T12:00:00Z
- reader effective privileges still USAGE 0/3, MAINTAIN 0/24
The endpoint mapping was checked by Neon list_branch_computes, not inferred
from a URL. **This is a point-in-time attestation only**: repeat it immediately
before any real operator session. Do not reuse if TTL expires or endpoint changes.

### Safe GitHub admin bootstrap

Source: .github/scripts/iam-g1-disposable-environment-bootstrap.py
No credentials are embedded or uploaded by this script. Requires gh CLI already
authenticated as a GitHub repo administrator with Administration:write. The
connected GitHub plugin does not expose environment/secret administrative writes.
Do not copy administrator tokens into ChatGPT, logs or Git.

    python3 .github/scripts/iam-g1-disposable-environment-bootstrap.py --mode plan
    python3 .github/scripts/iam-g1-disposable-environment-bootstrap.py \
      --mode apply --confirm CONFIGURE_G1_ENV_ONLY_NO_SECRETS
    python3 .github/scripts/iam-g1-disposable-environment-bootstrap.py --mode verify

The apply mode:
1. Confirms public repo, default branch main, distinct logged-in GitHub actor,
   reviewer ID/permission and TTL.
2. PUT environment with required reviewer alexoaraujo83, prevent_self_review=true,
   and custom deployment branches only.
3. Creates (or verifies) the **sole** deployment policy branch main. Extra
   existing patterns cause a block, never silent deletion.
4. Verifies protections from the live GitHub REST API.
5. Sets environment variables:
   IAM_G1_DISPOSABLE_PROJECT_ID = tiny-rice-70320263
   IAM_G1_DISPOSABLE_BRANCH_ID = br-spring-grass-b6gap6kp
   IAM_G1_DISPOSABLE_REVOKER_APPROVED_SHA = BLOCKED_UNTIL_REVIEWED_MAIN_SHA
6. **Never sets IAM_G1_DISPOSABLE_REVOKER_URL or approval secrets.**
   The intentionally invalid SHA means the privileged workflow cannot execute.

GitHub Actions workflow now also reads the live GitHub Environment and branch
policy at runtime, requiring the independent reviewer, prevent_self_review and
sole main policy **before any PostgreSQL client operation**. The read-only
environment verification requires Actions:read and Contents:read permissions.
If the API call or the rules check fails, the job exits 2 without DB access.

### Credential segregation and unlock sequence (NOT accomplished by bootstrap)

A separate operator must obtain or independently rotate a **disposable-branch
only** Neon admin password; NEVER reuse the Development/Production password.
The administrative role neondb_owner has broad powers and is not a minimal-privilege
revoker. First prove in Neon control plane that the credential change stays on
br-spring-grass-b6gap6kp and does not affect its parent. If this cannot be
demonstrated, do not create or store the secret. Do not run the role creation
shortcut (Neon's default admin role joins neon_superuser).

After independent confirmation, the operator stores the Direct
postgresql://neondb_owner:***@ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech:5432/iam_database?sslmode=verify-full&sslrootcert=system
as an environment **secret only** IAM_G1_DISPOSABLE_REVOKER_URL; never a
repository variable, commit or issue comment. Do NOT print or attach real URL.

Only after stacked PRs land on main with every required gate passing and a
new independent review of the exact main SHA should the reviewer set
IAM_G1_DISPOSABLE_REVOKER_APPROVED_SHA to that full 40-character main SHA.
The emergency-only IAM_G1_DISPOSABLE_REVOKER_APPROVAL latch must be released by
a second human operator as part of the approved revocation operation, not
pre-populated as a substitute for approval. GitHub Environment approval must
be independent and performed by a human other than the workflow initiator.

For the GitHub environment, administrator-bypass denial must additionally
be inspected in the web UI: the current REST create/update contract does not
expose a reliable writable admin-bypass field. If that cannot be proven, the
privileged gate stays BLOCKED.

### Current status

- PASS: PG18 offline grants/revocation fixture, Neon read-only endpoint attestation.
- PENDING: applying the protected GitHub environment with an authenticated admin;
  independent Neon password segregation and secrets; exact main SHA; UI audit of
  admin bypass.
- BLOCKED: live Neon GRANT MAINTAIN, signed RLS A/B, live schema-only dump, live
  REVOKE and COMMIT, merge/cutover.
