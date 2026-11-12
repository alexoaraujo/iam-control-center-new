# CODEOWNERS and review gate — PEOS proposal

Status: **DRAFT / not enforced**. The branch `chore/codeowners-security-review-20261112` adds GitHub ownership routing; it does **not** change Neon, Auth0, Vercel, `main` rulesets or Production.

The `@alexoaraujo83` account has **write** permission on `alexoaraujo/iam-control-center-new` (verified read-only 2026-11-12). Critical folders and IAM Auth0/RBAC code paths require this independent reviewer in the proposed `.github/CODEOWNERS`. The repository owner remains a general owner on other paths.

**Important:** The existing ruleset `protect-main` (26988310) requires 1 approval and dismisses stale approvals, but **`require_code_owner_review=false`** and the only named required check is `quality`. CODEOWNERS routing alone does **not** make code owner approval mandatory. Do not mark this task PASS until a separate authorized ruleset change and negative tests verify that:

1. Sensitive file change without an independent CODEOWNER review cannot merge.
2. A new commit invalidates stale approvals; unresolved review threads deny merge.
3. A failed `quality` check blocks merge; applicable Auth0 E2E and PostgreSQL18 gates are enforced for protected code changes, with SKIPPED never silently treated as PASS.
4. Workflows run only with least privilege, protected environment approvals and no production secrets accessible from untrusted PR code.

This proposal must itself pass `quality`, independent reviewer approval on its exact HEAD, and must remain Draft until those acceptance criteria are satisfied. It does not authorize any Neon DDL, migration runner or Production cutover.

Related: [issue #11](https://github.com/alexoaraujo/iam-control-center-new/issues/11), [ruleset](https://github.com/alexoaraujo/iam-control-center-new/rules/26988310).
