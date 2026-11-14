# IAM Production release SHA gate — proposal / not active on main

Status: **PROPOSED — MUST NOT MERGE** before an independent Production release-control review. This PR only changes a GitHub candidate branch. It does not configure Vercel Production, alter a deployed SHA, touch Neon, or authorize an IAM cutover.

## Rationale

The existing Vercel Ignored Build Step returns **build (exit 1)** for every Production commit, even for a GitHub main push consisting only of CODEOWNERS, docs or offline SQL. The active GitHub ruleset requires `quality` and one review; it does **not** require Auth0 E2E, Neon recovery and release approval. Thus merging an approved code PR may trigger an unapproved Production deployment.

## Proposed fail-closed behavior

The repository's `scripts/vercel-ignore-build.mjs` now requires all three inputs for a Production build:

1. `VERCEL_ENV=production` (Vercel system variable)
2. `VERCEL_GIT_COMMIT_REF=main` and `VERCEL_GIT_COMMIT_SHA` a complete lowercase 40-hex Git SHA (Vercel system variables)
3. `IAM_APPROVED_PRODUCTION_SHA` set **only in the Vercel Production environment** to the exact, independently approved commit SHA; no wildcard, partial SHA or branch name allowed.

When missing or mismatched, the script returns **0 (skip build)**; on an exact match it returns **1 (build)**. Preview deployment filtering is unchanged, as is the build behavior for non-Production/non-Preview targets. The approval value is not a secret but must remain restricted to release administrators, not injected by PR code or GitHub Actions.

This gate **only works if** Vercel Project → Settings → Git → Ignored Build Step is configured to run `node scripts/vercel-ignore-build.mjs` for Git-connected deployments. Inspect this setting independently before considering this feature effective. Vercel admins and alternative deployment mechanisms can bypass an ignored-build script; a separate Vercel deployment-source policy, protected GitHub release environment, staged Production deploy and reviewer approval are still required.

## Acceptance and testing

- [ ] Validate `node --test scripts/vercel-ignore-build.test.mjs` in the reviewed branch and run the actual GitHub CI `quality`.
- [ ] Validate negative cases: missing approval, wrong branch, wrong/full SHA, no Git metadata, docs-only and web changes on Production all skip.
- [ ] Validate positive case: full SHA matches on `main` builds.
- [ ] Verify GitHub PR review in exact candidate SHA, no unresolved threads, no bypass.
- [ ] Independently verify the deployed project's Ignored Build Step command; audit deployment sources and protections available on the Free plan.
- [ ] Prove the production skip behavior in an approved dry run without attaching the live custom domain or changing the running Production deployment.
- [ ] Before merging this gate into `main`, get explicit release-control approval and verify its own first Production build cannot run accidentally.
- [ ] After merging, set the Vercel Production-scoped approval to an explicitly signed-off full SHA, stage Production **without** assigning public domains, run Auth0 E2E/DB readiness/rollback, then promote only after release authorization.
- [ ] Reconcile the concurrent `scripts/vercel-ignore-build.mjs` changes in PR #41 (same-SHA Preview redeploy fix) without losing either behavior; re-run all CI/review after rebasing.
- [ ] Remove/rotate `IAM_APPROVED_PRODUCTION_SHA` after a completed release and verify future pushes do not automatically deploy.

## Rollback

Before activation, close the PR — no Production setting has changed. After approved activation, remove the release SHA authorization to block new builds, while keeping the current Production deployment and alias intact. A rollback of an already promoted Production deployment requires the separate reviewed Vercel rollback runbook and verified database compatibility. **Do not** treat an ignored-build skip as a security approval or as proof of a released build.

References: [Release gate #34](https://github.com/alexoaraujo/iam-control-center-new/issues/34), [Main protection #11](https://github.com/alexoaraujo/iam-control-center-new/issues/11), [Cutover gate #5](https://github.com/alexoaraujo/iam-control-center-new/issues/5).

## Explicit limitations and primary boundary

Vercel's Ignored Build Step is **not a security authorization mechanism**: exit code **0** skips a build, while any non-zero exit code continues a build. An unavailable script, misconfigured command, import failure or intentionally changed command can therefore permit the build to start. The script now treats an exception **inside its main function** as skip for Production, but cannot prevent top-level startup failures or a Project Settings override. Do not claim that this code guarantees Production immutability.

Before any PR is merged, independently configure and verify a **primary deployment boundary**, for example Vercel Project Settings → Environments → Production → Branch Tracking to a reviewed `release/production` branch separate from `main`, if approved for the project and available on the current Free plan. Vercel documentation confirms branch tracking can be changed. Preserve the current Production deployment and custom domain while testing; changes to that project setting require separate release authorization. Additionally evaluate Deployment Checks / staged promotion if supported by the current account, without assuming a paid feature is free.

This PR is a **defense-in-depth candidate only** until branch tracking and a real negative deployment-policy test are demonstrated; approval of `quality` alone is insufficient. After any change to branch tracking, re-evaluate Preview aliases, Auth0 callback and GitHub OIDC trust boundaries before proceeding. No production setting was changed by this PR.

Official references: https://vercel.com/kb/guide/how-do-i-use-the-ignored-build-step-field-on-vercel and https://vercel.com/docs/git#customizing-the-production-branch.
