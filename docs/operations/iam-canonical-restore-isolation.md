# IAM canonical restoration — isolated target guard

> **SUPERSEDING CONTROL-PLANE SCOPE — 2026-11-13.** The operator explicitly excludes the legacy cross-organization Neon project `twilight-fire-88497009`. The active authorized project is `tiny-rice-70320263` in organization `alexoaraujo`. Source candidate: `development` / `br-ancient-term-b6mmx5ol` / `iam_database` / direct `ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech`; destination: disposable `br-sweet-union-b6j80a7j` / `iam_canonical_validation`. Control-plane and authenticated read-only SQL on 2026-11-14 confirm SOURCE role `iam_schema_export_reader` **exists and authenticates** with `BYPASSRLS=false`, but currently has `MAINTAIN=0/23` tables and `USAGE=0/3` scoped schemas; therefore authenticated schema export remains **BLOCKED** until least-privilege review and evidence. The historical source table and legacy restoration rationale below are retained as a snapshot only, NOT a current authorization. Require a new independent source-identity/least-privilege review before any authenticated schema operation; no Production modification.

**State: DRAFT / REVIEW ONLY.** This is not permission to perform a schema restore, write data, fix ACLs in Development or Production, update main, or cut over. It is an executable guard for credentials and targets, tested entirely offline with synthetic passwords.

## Verified Neon control-plane targets (2026-11-13)

| Purpose | Project | Branch | Database | Direct PostgreSQL endpoint |
| --- | --- | --- | --- | --- |
| Read-only origin | `twilight-fire-88497009` | `main` (`br-little-fire-b6adup9f`) | `iam_database` | `ep-twilight-shadow-b618ef5h.c-2.sa-east-1.aws.neon.tech` |
| Disposable destination | `tiny-rice-70320263` | `validation/iam-canonical-restore-20261113` (`br-sweet-union-b6j80a7j`) | `iam_canonical_validation` | `ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech` |

The destination is a **separate empty database in a disposable child of NEW Development**, NOT the inherited `iam_database` on the same branch or NEW Production. It expires at `2026-11-20T09:12:00Z`; it uses a 0.25 CU compute on the Free plan.

## Guard contract

- Script: `database/scripts/guard-canonical-restore-target.py`. Secrets enter only as `IAM_CANONICAL_SOURCE_URL` and `IAM_CANONICAL_TARGET_URL` environment variables from a protected environment; **never paste URIs in arguments, issues, logs or artifacts**.
- Pinned exact hosts, databases and roles. Source role: `iam_schema_export_reader`; target (proposed only) `neondb_owner`. Direct endpoints only (no pooler). Require `sslmode=verify-full&sslrootcert=system`, port 5432 and valid password. Any other parameters fail closed.
- The script never connects to Neon, reads/writes tables or performs a restore. `PASS_URL_ALLOWLIST_ONLY` means a static URL allowlist check **only**. Independently revalidate the endpoint-to-project/branch mapping using Neon control plane immediately before execution, because an endpoint can change and the script cannot attest which Neon branch is active.
- Offline test: `python3 database/tests/test-guard-canonical-restore-target.py`. PR CI tests target confusion, source/destination swaps, missing exporter privileges/role, runtime-as-restorer, pooler, TLS downgrade, unexpected URI options and secret disclosure. The workflow has no secrets, no privileged events and no Neon access.

## Six mandatory blocked gates (never mark PASS by approximation)

1. **Authenticated canonical export:** On trusted protected GitHub main, verify the dedicated least-privileged export identity and external TLS `verify-full`, then run PostgreSQL 18 `pg_dump` or existing `database/scripts/export-neon-schema.sh`. Archive the immutable schema-only dump, SHA-256 and full object manifest; do not publish sensitive rows. Existing GitHub workflow `neon-schema-export.yml` ran **SKIPPED** (run 42864783804) and published no artifact. A checked-in legacy schema dump is not proof of latest canonical export.
2. **Roles, ACL and ownership parity:** legacy has `iam_migrator_login` and `iam_worker_login` that NEW lacks, and runtime LOGIN is NOINHERIT in legacy but INHERIT in NEW. Six future runtime grants in `public` were observed in NEW Development and NEW Production; new database has zero. Determine expected role lifecycle and least-privilege BEFORE any restore. Do not apply PR #47's six-grant REVOKE to this zero-grant target.
3. **Migration-ledger provenance:** source has one recorded `0001_context_key_hardening` migration; NEW Development has zero. Verify original file bytes and SHA, recorded author/execution context and separate baseline adoption. Never fabricate historical markers, rename IDs or replay an already applied migration. Runner must fail on checksum mismatch and concurrent execution.
4. **Real restore and rollback:** independently approve DDL for `iam_canonical_validation` **only**, prove destination is empty at execution instant, capture secure backup before write, restore with a direct TLS connection, and compare *definitions*, owners, grants, functions, 41 RLS policies, 20 FORCE RLS tables and row counts. Prove both forward restore and rollback to another isolated database. A schema-only fixture or `pg_stat_ssl.ssl=false` from a Neon internal connector is **not** evidence of external TLS, business data fidelity, or recovery.
5. **RLS A/B and HTTP authorization:** real runtime sessions with signed context for tenants A/B, no-context/default-deny, DML cross-tenant negative controls, authenticated HTTP 200 after grant then HTTP 403 after revoke on the **exact SHA, Preview and restored target**. Prove audit/outbox consistency and cleanup. Historical PR #41 tests against a different branch do not approve the new database.
6. **Formal release gate:** exact-SHA checks including Auth0 E2E, independent review, CODEOWNERS/ruleset protection and zero unresolved security findings; record the explicit reviewer approval of production rollout separately. No merge of #41/#44/#45/#46/#47 or this PR, no change to Production `DATABASE_URL`, and no cutover until all conditions PASS.

### Free-only constraint

Do not enable paid automated Neon backup schedules or purchase mandatory services. On Free, snapshots are limited and may incur storage charges; this work has **not** created snapshots. Prefer approved portable PostgreSQL 18 `pg_dump -Fc` / `pg_restore` with protected ephemeral output and a retention/deletion policy, with security review for any business data.

**STOP criteria:** missing credentials, inability to independently attest endpoint/branch, wrong database or role, TLS not verified, source export not current, role mismatch, ledger checksum mismatch, non-empty target, missing independent approval, absent rollback evidence or expired branch. All are BLOCKED, never implicitly waived.

## Syncing protected GitHub environment secrets (2026-11-14)

PEOS specialist prompts: 2009 (GitHub Actions governance), 2010 (repository security), 1102 (CI/CD pipeline), and PMU-004 (controlled continuity). **Use GitHub environment secrets, not repository-level Actions variables.**

Environment: [IAM-Canonical-Isolated-Restore](https://github.com/alexoaraujo/iam-control-center-new/settings/environments/27182774301/edit). The three required **environment secret names** are `IAM_CANONICAL_SOURCE_URL`, `IAM_CANONICAL_TARGET_URL`, `IAM_CANONICAL_OPERATOR_APPROVAL`. **The operator's GitHub Settings UI (14/11/2026) displays all 3 names, each with last updated 13/11/2026.** This confirms metadata only: GitHub hides secret values. Do not overwrite any existing value from metadata alone. The same UI displays `Required reviewers` **off**, `Prevent self-review` **off**, and admin bypass **on**; `main` is the only allowed branch. **Fix protection policy first; neither Auth0 nor recovery authorization is implied.**

The repository provides a **minimal-change, interactive local administrative CLI** to preserve the two existing values. This CLI never sends passwords into Git commits, stdout, workflow inputs, or issue text:

```bash
gh auth login
# No secrets are written in this step. Requires repository admin and an independent reviewer.
python3 .github/scripts/configure-iam-canonical-environment.py --protect-only
# Read only: verify policy, all 3 secret names, and that administrators cannot bypass.
python3 .github/scripts/configure-iam-canonical-environment.py --verify-only
# Only when the target name is confirmed missing; otherwise do NOT overwrite it:
# python3 .github/scripts/configure-iam-canonical-environment.py --target-only
```

Run from a trusted clone containing the reviewed script; GitHub CLI must be authenticated with enough permissions to inspect the environment and set an environment secret. The `--protect-only` mode sets reviewer `alexoaraujo83` (distinct from the triggering actor), requires `prevent_self_review=true`, **sets `can_admins_bypass=false`**, and restricts deployments to `main`, without reading or updating any secret. The `--target-only` mode checks the required independent reviewer (`alexoaraujo83`), `prevent_self_review=true`, and an exact `main` branch allowlist. It verifies that existing SOURCE and APPROVAL secrets are present **by name**, prompts privately for the missing target URL, validates it with the pinned guard, and sets **only** `IAM_CANONICAL_TARGET_URL`. It refuses non-TTY execution, invalid TLS or a wrong destination/role, and skips any existing target secret without overwriting it. The `--verify-only` mode makes **no mutations** and checks names/policy, including disabled administrator bypass, **not the stored values**. If all names exist already, `--target-only` intentionally skips overwrite; live URL correctness is established only by an approved `auth_only` run on reviewed `main`.

Build the target URL *privately*, from the approved Neon Direct connection with database `iam_canonical_validation`, branch `br-sweet-union-b6j80a7j`, host `ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech`, role `neondb_owner`, and URL parameters `sslmode=verify-full&sslrootcert=system`. Do **not** use the inherited `iam_database`, the Production branch, a pooled host, or the legacy cross-org Neon project. Do not paste the full URL in chat, shell history, PR, issue, or Actions input.

**After metadata confirmation, run only** `preflight_only` and then `auth_only` with `confirm_isolated_ddl=NO_DDL` on [the pinned workflow](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-canonical-isolated-restore.yml), from reviewed `main` with explicit protected-environment reviewer approval. `auth_only` is evidence for actual login; secret metadata is not. Remain fail-closed on `readiness_only`, `export_only`, `restore_isolated` until reader privileges, recovery point, migration ledger and independent change approval are resolved.

