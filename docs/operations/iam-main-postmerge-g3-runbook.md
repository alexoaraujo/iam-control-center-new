# PEOS — trusted post-merge G3 Auth0/RBAC gate on main

## Purpose and baseline

The approved PR #128 head `1f6073c990cca160e0c37604bd55181bc808806a` passed real Auth0 grant HTTP 200, cross-tenant/identity denial HTTP 403, revoke HTTP 403, TLS verify-full, database rollback and zero residue. It was integrated into `main` by merge commit `2270fac70bb588cea2ebc2e12cad5b7da96e2a38`, with identical Git tree. This workflow adds an **independent live post-merge G3 run**, never relying on previous results alone.

## Trusted trigger

Only an issue comment on merged [PR #128](https://github.com/alexoaraujo/iam-control-center-new/pull/128) authored by the approved owner and containing exactly the following text is allowed:

```text
/peos-main-postmerge-g3 <40-digit current main SHA>
```

Use the **latest main SHA after this workflow itself has been merged**. The GitHub Actions issue_comment event runs trusted default-branch code. Both no-secret and protected jobs verify that checkout is the event's current `refs/heads/main` SHA. They reject a stale SHA, changed PR128 merge history, missing successful checks or modified runtime code.

## Separation of privileges

Because the Vercel `deployment-config` workflow only runs for runtime/dependency changes, this controller-only PR verifies that check on the existing **PR128 Production application baseline**, while requiring new-SHA `quality` and PostgreSQL 18 checks, exact six-file change scope and full tree equality with the reviewed PR147 merge. Missing or failing baseline deployment checks block execution.

The first job has only read access and **no Environment, OIDC write permission, or secrets**. Its script compares `main` with the approved PR128 merge, allowing only four new trusted workflow/test/documentation files and two changes in CI callback binding scripts (dedicated Preview callback for the PR installing this gate). Application source, authorization logic, migrations, schema and the existing G3 suite must be unchanged.

The second job can use the existing main-only protected GitHub Environment `IAM-G3-PR128-Disposable-RBAC` after revalidating the exact main SHA, PR128 baseline and approved SHA variable. It checks GitHub OIDC subject/audience/ref/workflow SHA and the Vercel Trusted Source, then reruns the existing source-controlled G3 suite on **disposable** Neon branch `br-super-sound-b63gtz88` using its branch-scoped owner secret. It does **not** reuse or copy that privileged secret into Preview or Production, and does not perform Production database writes.

**PASS requires:** the protected job's own real test logs to show grant HTTP 200, cross-tenant HTTP 403, revoke HTTP 403 in same Auth0 session, transactional rollback, and zero residue. A skipped job, a green CI alone, or the old PR-level G3 proof is not sufficient.

The disposable Neon branch lease ends at **2026-11-23 22:00 UTC**. If it expires, fail closed and obtain a newly reviewed isolated fixture and credential, not a Production fallback.

## Operation

1. Merge the implementation PR with `quality`, `security-gate`, Auth0 E2E and PG18 SUCCESS on its exact SHA. Ensure `main` CI push completes with SUCCESS.
2. Verify main SHA and the G3 Environment still restricts deployment to `main`.
3. Post the exact command above in PR128 as `alexoaraujo`.
4. Inspect the resulting workflow's `preflight` and protected `execute` jobs. Record the run URL, UTC timestamps, SHA, and explicit G3 assertions.
5. Do not enable an automatic Production cutover or change Auth0/Neon Production credentials.

If current `main` differs from the approved baseline beyond the allowlisted control files, create a new reviewed baseline and revise this gate in a separate PR. Never weaken the exact-SHA or owner/Environment restrictions to make the workflow pass.
