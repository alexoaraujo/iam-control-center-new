# IAM Control Center NEW — Post-merge release validation

**Evidence timestamp:** 2026-11-11 02:03 UTC / 2026-11-10 23:03 BRT (approximately).  
**Scope:** current `main` `e95b938c889c3d2d45f056f946f2351df68b7823`, Vercel Production release, NEW Neon Production and non-production disposable RLS test.  
**Rule:** historical success never substitutes for exact-SHA evidence; the previous [integrated audit](./integrated-github-vercel-neon-audit-20261110.md) is a dated snapshot, not a claim about the latest state.

## 1. Reconciled GitHub merge history

| PR | GitHub merged timestamp (UTC) | Merge commit |
|---|---|---|
| [#9](https://github.com/alexoaraujo/iam-control-center-new/pull/9) | 2026-11-11 00:03:47 | `951b3fa4de0910c4f631ffc05c3c1f9e3cacdd9e` |
| [#37](https://github.com/alexoaraujo/iam-control-center-new/pull/37) | 2026-11-11 00:08:30 | `a350c601541a94a1fa717ed643961487a2032b89` |
| [#38](https://github.com/alexoaraujo/iam-control-center-new/pull/38) | 2026-11-11 00:13:57 | `21d5927c90b51897f9f60e5f4b9dc3f8df531419` |
| [#39](https://github.com/alexoaraujo/iam-control-center-new/pull/39) | 2026-11-11 00:46:02 | `e95b938c889c3d2d45f056f946f2351df68b7823` |

Latest PR #39 fixes a TypeScript/ESLint unused `request` warning in a proxy test mock. All these PRs were **already merged before this post-merge audit**; this audit did not perform merges or trigger their Production deploys.

- Current `main` is protected by GitHub ruleset `26988310`, requiring **1** review, resolved threads, strict `quality` check, disallowing force push/delete and having no bypass actors.
- Open PR inventory returned **0** at the start of this audit; branch listing returned **49** refs (historical count 50 in the earlier audit, before intervening merges and cleanup). Do not infer which refs were deleted without a new complete inventory diff.
- Exact SHA `e95b938c` GitHub checks: `quality=PASS`, `deployment-config=PASS`, `auth0-e2e=SKIPPED`, `preview-deployment=SKIPPED`. The latter are expected to be conditional on pull requests but are **not** Proof of production Auth0.

## 2. Vercel Production now at exact merged SHA

- Verified Production deployment: `dpl_DVn7EKhBZGAUGGzeb695CyJtupod`, Git source `main@e95b938c889c3d2d45f056f946f2351df68b7823`, `READY`, project `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80`.
- Production domain `https://iam-control-center-new.vercel.app` returned `/api/health` HTTP **200**: `{"ok":true,"service":"iam-control-center-web","status":"scaffold","authConfigured":true,"databaseConfigured":true}`; `x-health-check=liveness`. This is a liveness/configuration check, **not** database migration, Auth0 session, authorization, or readiness proof.
- `/api/ready` could not be verified through the connector: **401 `deployment_authentication_required`** at the share-link layer, not a confirmed application 401 or an app readiness failure.
- Production Vercel runtime error/fatal logs over 20 minutes returned no records, but absence of records is not an uptime or error-rate SLA and cannot prove full observability.
- **Risk:** automatic Production deployments on `main` merges are demonstrated. Any future `main` merge can cause another Production deployment. This document/PR is review-only until an explicit deployment authorization or tested hold is in place.

## 3. NEW Neon Production is not the runtime cutover target yet

- New Neon project `tiny-rice-70320263`, branch `production` `br-muddy-snow-b63cepcv`, database `iam_database`: **0** IAM tables and **0** IAM RLS policies, verified again after the GitHub merges.
- New Production is **NOT CONFIGURED** as an IAM application database; no migration/DDL or cutover is claimed. The existing Vercel Production credential must not be switched blindly to this empty destination.
- The NEW `development` branch retains 23 tables, 41 policies and an empty migration ledger (latest structural audit). The legacy ledger's historical `0001_context_key_hardening` record has a verified SHA256/Git provenance, but must **not** be fabricated/copied into NEW Development or Production.

## 4. Real runtime login RLS / privilege probe, disposable Neon branch

- Project `tiny-rice-70320263`; isolated child branch `validation/iam-cutover-audit-20261110`, ID `br-muddy-bar-b63ksdy7`, from Development, **not** Production.
- Authenticated as **actual** `iam_app_runtime_login`, not role emulation by the schema owner. Session confirmed `current_user=session_user=iam_app_runtime_login`, `BYPASSRLS=false`, `CREATE=false`, `TEMP=false`. Inherited privileges allow `SELECT` and `INSERT` against `iam.tenants`; RLS still filters SELECT with no context.
- **PASS, real no-context runtime SELECT returns 0** for `iam.tenants`, `iam.organizations`, `iam.identities`, `iam.memberships`, `iam.roles`, `iam.access_policies`, `audit.events`.
- **PASS, explicit permission denial (`SQLSTATE 42501`)** on `audit.outbox`, `iam.schema_migrations`, `app_private.context_keys`. These are privileged-control relations and refusal is consistent with least privilege. Do not interpret `permission denied` as an RLS filter test.
- Catalog audit: 20 IAM/audit tables have `relrowsecurity=true` and `relforcerowsecurity=true`. Three control/catalog tables (`app_private.context_keys`, `iam.permissions`, `iam.schema_migrations`) have no RLS policies; access is restricted through SQL privileges where relevant. Audit did not independently exercise the permissions catalog.
- Role membership: `iam_app_runtime_login` inherits `iam_app_runtime` (`inherit_option=true`, `set_option=false`, `admin_option=false`). The runtime is not allowed to SET ROLE into the privileged owner/migrator via that membership.
- Six SECURITY DEFINER functions were catalogued; each has a function-local restricted `search_path` without `public`, including `app_private.current_tenant_id` and `iam.set_tenant_context`.
- These are **read-only privilege and no-context tests**. Cross-tenant positive/negative writes, signed context, active revocation, concurrency, migration rollback and recovery were not executed in this pass: **BLOCKED pending an approved disposable test plan**.

## 5. Evidence matrix / release gate

| Gate | State | Evidence or limitation |
|---|---|---|
| G1 latest `main` CI | **PASS** | GitHub [CI #42933922260](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42933922260) on `e95b938c` |
| G1 deployment configuration guard | **PASS** | GitHub [guard #42933922438](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42933922438), same SHA |
| G1 protected main ruleset | **PASS configured** | Active ruleset #26988310, 1 review, strict quality; no independent bypass-negative exercise |
| G2 Vercel production release | **PASS deployed** | READY deployment `dpl_DVn7EKhBZGAUGGzeb695CyJtupod`, same SHA |
| G2 production liveness | **PASS limited** | `/api/health` HTTP 200 and `status=scaffold`, not application readiness |
| G2 Auth0 E2E on **latest main/Production** | **BLOCKED** | `auth0-e2e=SKIPPED` on latest `main`; prior real Preview E2E is not Production proof |
| G2 disposable no-context RLS and denies | **PASS partial** | Real runtime login and 10 selected relations; 7 zero-visible / 3 permission denied |
| G2 signed-context tenant A/B and RBAC | **BLOCKED** | No recent real cross-tenant DML/revocation evidence |
| G3 migration runner, provenance, checksum/idempotency, race/rollback | **BLOCKED** | Incomplete runner, lineage, isolated rehearsals and recovery evidence |
| G3 NEW Neon Production IAM schema | **NOT CONFIGURED** | 0 IAM tables, 0 policies, no migration ledger |
| G3 verified runtime external TLS, backups, restore | **BLOCKED** | Runtime handshake and recovery exercise not proven |
| G4 Production **database cutover** | **BLOCKED** | Requires explicit separate approval after all gates |

**No further Production deployment, secret change, cutover, destructive SQL, or branch deletion was performed by this validation pass.**

## 6. Next actions

1. Validate Vercel runtime readiness using an authorized route that reports DB target/role/TLS **without leaking a connection URL or credentials**.
2. Test signed tenant A/B through the actual runtime login on a disposable branch with reviewed synthetic identities and full transaction rollback.
3. Reconcile migration lineage, implement a checksum-locked migration runner, rehearse concurrency/failure/recovery only in disposable branches.
4. Prove PITR/snapshot backup and successful restore and external TLS; observe failure/error metrics.
5. Keep automatic Production deploy risks explicit before merging this or future PRs; complete and record a separate release authorization gate.
