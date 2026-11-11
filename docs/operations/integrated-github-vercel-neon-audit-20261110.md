# IAM Control Center NEW — Integrated Technical Audit / Release Gates

**Audit date:** 2026-11-10 (UTC). **Source baseline:** `main@53323f334dbc7e490f965f701de0718b8f79d832`.  
**Status:** Partial technical PASS / **Production cutover BLOCKED**.  
**Method:** Inventário → Evidências → Análise → Correção → Testes → Revisão → Aprovação → Integração.  
**Important:** This file records live external observations at audit time; it is not a signed release authorization, does not disclose connection strings, and does not claim that new Production has application schema.

## 1. GitHub: branch/ruleset and reviews

- Repository: `alexoaraujo/iam-control-center-new`; `main` protected at `53323f3`.
- Active ruleset [`protect-main` #26988310](https://github.com/alexoaraujo/iam-control-center-new/rules/26988310), `refs/heads/main`: deletion and non-fast-forward prohibited; pull request required, **1 approving review**, dismiss stale reviews on push, resolved review threads required, strict `quality` status check (integration ID `15368`), **no bypass actors**. **PASS for configured rules; enforcement negative test NOT YET RUN.**
- Two open PRs:
  - [PR #9](https://github.com/alexoaraujo/iam-control-center-new/pull/9), HEAD `c023491581173f6d89aff26cd985c17e200d8be4`, **6 ahead / 0 behind** baseline, four documentation/governance files. GitHub review `APPROVED` by `alexoaraujo83`, submitted `2026-11-10T23:24:23Z`; `quality=PASS`, `docs-preview-gate=PASS`; Auth0 E2E is `SKIPPED` for documentation-only scope.
  - [PR #37](https://github.com/alexoaraujo/iam-control-center-new/pull/37), HEAD `20d63265d3d9f4a7799cd3581b09d3ad446da23f`, **10 ahead / 0 behind**, four CI/Auth0 test files, `DRAFT`. GitHub review `APPROVED` by `alexoaraujo83`, submitted `2026-11-10T23:26:49Z`; workflow [#42921612046](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/42921612046) `quality=PASS`, `preview-deployment=PASS`, `auth0-e2e=PASS` including Playwright `1 passed`.
- Review is by a **different GitHub account** than the author, `alexoaraujo`. The reviewer account's organizational/personnel independence cannot be independently proven through this API alone.
- Both PRs currently mergeable by the GitHub comparison; no unresolved review threads. **No merge was performed**: Vercel Production auto-deploys changes pushed to `main`, and this audit has no separate authorization to trigger a Production deployment. PR #37 must also leave DRAFT via normal review flow before merge.
- PR #9 introduces a governance checklist and a fixed documentation Preview gate. PR #37 reduces duplicate CI triggers but changes callback host/branch configuration; validate effective protected environment variables for every subsequent Preview branch. The regex is not an Auth0 allowlist by itself.

## 2. GitHub branch inventory / preservation policy

`GET /branches?per_page=100` returned **50 branch refs** on 2026-11-10, categorized below. Branch comparisons used `compare_commits(main,branch)`; archived refs are preserved without applying deletion heuristics.

| Category | Count | Disposition |
|---|---:|---|
| `main` | 1 | Protected permanent baseline |
| `archive/2026-10-31/*` | 22 | Historical; preserve unless separate retention/legal review authorizes deletion |
| Permanent `develop` | 1 | 0 ahead / 421 behind; keep until environment reconciliation |
| Active PR heads | 2 | PR #9: 6/0, PR #37: 10/0; preserve |
| Other branches with 0 unique commits vs `main` | 4 | Preserve until Preview/environment references and non-GitHub consumers are resolved |
| Divergent branches with unique commits | 20 | **Preserve**; requires per-file/cherry-pick and duplicate-change review |

**Behind-only refs (ahead=0):** `develop` (behind 421), `chore/sync-neon-tiny-rice-70320263` (14), `fix/vercel-deployment-readiness` (25), `security/harden-tenant-context-search-path` (9), `test/ci-real-runtime-login-gate` (1). Several are linked to branch-scoped Vercel variables or domains and must not be deleted blindly.

**Divergent refs (ahead/behind):**

| Branch | Ahead | Behind |
|---|---:|---:|
| `audit/environment-baseline-2026-10-31` | 3 | 393 |
| `chore/dependencies-refresh` | 1 | 421 |
| `chore/pin-github-actions-ubuntu-24-04` | 2 | 421 |
| `docs/neon-canonical-baseline-reconciliation` | 2 | 393 |
| `docs/neon-connection-pooling-guidance` | 3 | 421 |
| `feat/iam-context-harness-prototype` | 19 | 364 |
| `fix/ci-auth0-build-config` | 6 | 46 |
| `fix/next16-auth0-proxy-entrypoint` | 2 | 392 |
| `fix/next16-proxy-convention` | 2 | 421 |
| `fix/r1-node-types-24-final` | 1 | 404 |
| `fix/r1-node-types-24-final2` | 1 | 403 |
| `fix/r1-node-types-24-rebased` | 1 | 405 |
| `fix/r1-node-types-24` | 2 | 406 |
| `poc/context-key-hardening-02` | 93 | 46 |
| `poc/iam-tenant-context-01` | 7 | 180 |
| `proposal/iam-migration-bootstrap-integration` | 24 | 393 |
| `proposal/neon-development-role-bootstrap` | 53 | 393 |
| `proposal/postgres18-bootstrap-role-security` | 17 | 393 |
| `security/neon-runtime-role-hardening-review` | 27 | 364 |
| `validation/operational-audit-2026-10-31` | 3 | 393 |

**No branch was deleted or reset.** The present audit PR creates an additional non-production branch and will change these inventory counts; snapshot counts above refer to the pre-report inspection.

## 3. Vercel: Git / SHA / secrets scope

Project: `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80` (team `team_oZwyOnhX8Gfx4JNflFubUelo`).

| Environment / ref | Verified deployed SHA | Evidence | Status |
|---|---|---|---|
| Production / `main` | `53323f334dbc7e490f965f701de0718b8f79d832` | Deployment `dpl_DP3vHLTfTsGJ9YXtQV64QQroGS5c` | **PASS deployment READY only** |
| Preview PR #9 | `c023491581173f6d89aff26cd985c17e200d8be4` | Deployment `dpl_Aa5yRB8yCmrqnzLkoUUZGEDSqxNB`; docs gate `42921350700` | **PASS** |
| Preview PR #37 | `20d63265d3d9f4a7799cd3581b09d3ad446da23f` | Deployment `dpl_49PLyx6mj2vTgu8V3JKzcLZJsNqE`, CI `42921612046` | **PASS** |

- Verified domains: `iam-control-center-new.vercel.app` (Production), `iam-control-center-new-ci-preview.vercel.app` (bound to PR #37 branch), and `iam-control-center-new-preview.vercel.app` (bound to `fix/vercel-deployment-readiness`). Domains are **not interchangeable**.
- The Vercel project has 22 environment-variable entries (values not decrypted), including separate Production and Preview sensitive `DATABASE_URL`, `AUTH0_SECRET`, `AUTH0_CLIENT_SECRET` and 4 older branch-scoped Preview `DATABASE_URL` entries. The Production `DATABASE_URL` still points to the historical Neon source per existing integration contract; cutover not performed.
- Production runtime error-log query over the latest 20 minutes returned **no events**; it is **NOT** evidence of zero errors outside that window or missing traffic. A 1h query failed due to Hobby log retention/request limits. Observability acceptance is **BLOCKED**.
- Production auto-publish on merge is a risk. **Do not merge while the user disallows Production deploy absent separate authorization**, even if GitHub approves PR and all checks.

## 4. Neon: exact branches and security findings

Project `tiny-rice-70320263`, database `iam_database`, PostgreSQL **18.6**. Read-only SQL queries performed directly against the named branches.

| Check | New Production `br-muddy-snow-b63cepcv` | New Development `br-ancient-term-b6mmx5ol` |
|---|---|---|
| IAM application tables | **0** | 23 |
| RLS policies | **0** | 41 |
| Tables with FORCE RLS | Not provisioned | 20 |
| IAM schema migration ledger | **NOT CONFIGURED** (no IAM tables) | Exists; **0** rows |
| Runtime login `iam_app_runtime_login` | LOGIN true; NOBYPASSRLS; not superuser, no CREATE DB or TEMP | Same effective least-privilege LOGIN verified |
| Runtime no-context tenant and membership reads | **NOT CONFIGURED** (IAM tables absent) | 0 tenants and 0 memberships visible |
| Compute pooler | Disabled | Disabled |
| TLS for actual Vercel→Neon runtime connection | **BLOCKED** (requires handshake evidence) | **BLOCKED** (requires handshake evidence) |

**TLS caveat:** `pg_stat_ssl` returned `ssl=false` for connections initiated through the **Neon MCP tool** in both branches. This observation belongs to the tool's internal connection path; it cannot be extrapolated to the application's external TLS handshake or used to claim that Vercel→Neon is plaintext. Confirm using a real dedicated runtime connection with TLS enforcement and sanitized `pg_stat_ssl` evidence.

**Grants:** Development's 23 IAM tables expose no direct grants to `iam_app_runtime_login` and no PUBLIC table ACL grants; effective permissions must include role inheritance checks, not only direct grants. The runtime principal's default-deny negative read is PASS; signed-context A/B positive and unauthorized mutation tests on this exact branch are **BLOCKED / not yet rerun**.

**Backup:** `list_snapshots` returned an empty collection; `get_snapshot_schedule` for new Production returned `[]`. Snapshot provisioning and recovery rehearsal are **NOT CONFIGURED / BLOCKED**; this does not rule out provider point-in-time recovery or backups managed elsewhere, which need independent verification.

## 5. Disposable Neon audit branch

- Created branch `validation/iam-cutover-audit-20261110`, ID `br-muddy-bar-b63ksdy7`, as a copy-on-write child of **New Development**, not Production.
- Confirmed branch state `ready` and exact schema parity with parent via `compare_database_schema` returning `diff: ""`.
- Read-only catalog probe: 23 IAM tables, 41 RLS policies, empty migration ledger.
- Authenticated read-only runtime probe as `iam_app_runtime_login`: `BYPASSRLS=false`, `CREATE=false`, `TEMP=false`, 0 tenant rows and 0 membership rows visible with no tenant context.
- No DDL, inserts, grants, migrations or destructive SQL ran on this branch in this audit. It requires explicit lifecycle cleanup when tests finish (branch currently has no TTL).

## 6. Migration/recovery gate

- The source historical ledger entry `0001_context_key_hardening` points to Git commit `b80c98c51746e1d49039015eb649b9bdd735ef7f`; SHA256 **MATCH** `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab` against that exact file in GitHub.
- Repository includes `0001_initial_iam_schema.sql` (clean bootstrap), `0002_sessions_touch_contract.sql` (Development-derived corrective), `0003_set_tenant_context_search_path.sql` (reviewed hardening). **These are not a single universally applicable linear migration chain.** The README explicitly states no general migration runner or fully reconciled ledger.
- Existing [PostgreSQL 18 database-schema-tests](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/database-tests.yml) tests source schema restore, forced RLS, runtime role, corrective migration preconditions and rollback on a **disposable local PostgreSQL container**, not a complete real Neon Production migration.
- **BLOCKED:** idempotency/checksum mismatch, advisory-lock concurrency across independent migration sessions, failure-injection recovery, rollback/restore and ledger provenance **on a single qualified disposable migration target**. Do not claim these passed based on structural parity or a green CI aggregate.
- **Critical:** avoid applying the corrective migration `0002` to an already-corrected fixture or creating fictional ledger rows. The hash-matched legacy migration ledger must not be blindly copied to New Production.

## 7. Release decision and next steps

| Gate | Decision | Basis / next action |
|---|---|---|
| G1 GitHub branch policy | **PASS configured** | Ruleset requires 1 review and `quality`; independent reviewer account approvals recorded |
| G1 PR #9 code/doc CI | **PASS** | Exact-SHA `quality` and docs gate |
| G1 PR #37 CI and Auth0 Preview | **PASS** | Exact-SHA quality, deployment and Auth0 Playwright |
| G1 Merging to `main` | **BLOCKED** | Potential automatic Production deploy without specific release authorization |
| G2 Neon Development RLS negative | **PASS partial** | Real runtime LOGIN, no-context 0 rows, no CREATE/TEMP |
| G2 Cross-tenant A/B + authz | **BLOCKED** | Not reproduced in this audit on the disposable branch |
| G3 Neon NEW Production readiness | **NOT CONFIGURED** | 0 IAM tables/policies, no ledger |
| G3 Backup/restore and TLS | **BLOCKED** | Explicit snapshots/schedules empty; external TLS and recovery not proven |
| G4 Cutover/Production | **BLOCKED** | No explicit deployment authorization, migration chain/restore validation incomplete |

### Required next cycle, with gates

1. Establish a separately authorized deployment hold or controlled release process so reviewed merges cannot publish Production automatically; verify protection in Vercel and GitHub.
2. Obtain reviewer confirmation of both PRs after final HEAD SHA, mark #37 ready for review, and re-evaluate checks/conflicts. Merge only with a separately authorized Production deployment plan.
3. Run full migration rehearsals on isolated PostgreSQL/Neon with a reviewed, transactional runner, checksum-locked ledger, independent connections, negative controls and recovery evidence. Do not perform destructive DDL on shared branches.
4. Confirm Vercel Preview callback branch+alias and exact-SHA E2E for each new PR; keep Auth0 callback URLs allowlisted, and never share secrets.
5. Rehearse backup, restore, rollback and perform TLS checks from an actual runtime connection. Confirm signed-context RLS A/B under `iam_app_runtime_login`.
6. Obtain a **separate explicit Production cutover authorization**, then perform the gated release with evidence and rollback windows.

**No Production secrets, Production DB, deployment alias, or production data were modified during this audit.**
