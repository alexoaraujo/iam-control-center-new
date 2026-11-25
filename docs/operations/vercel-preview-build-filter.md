# Vercel Preview build and authenticated E2E policy

## Purpose

Every PR that requires Preview evidence must have a real READY deployment at its exact HEAD SHA. A Vercel commit status of success with description "Canceled by Ignored Build Step" is not READY. The PR #129 incident demonstrated that a documentation-only build cancellation can deadlock the documentation gate.

## Separate deployment from authentication classification

- Vercel Ignored Build Step: every Preview builds (exit 1), including docs-only updates, main-sync merges, and redeployments. No skipped build is accepted as deployment evidence.
- GitHub CI: `node scripts/vercel-ignore-build.mjs --github-output` preserves the existing `preview_required` contract. This flag means authenticated Preview/E2E is required. Only a verified nonempty diff containing README.md, SECURITY.md or docs/** may omit that path. Unknown, empty or invalid scope requires authenticated E2E.
- Documentation-only PRs still require the trusted exact-SHA `docs-preview-gate` and `docs-preview-evidence` checks. Code, SQL, workflow and security changes still require Preview, Auth0 preflight and E2E. No gate changes or exemptions are introduced.
- Production remains governed by the existing exact reviewed SHA on main predicate. The Ignored Build Step is defense in depth, not release authorization; Vercel deployment-source protection and explicit promotion remain separate.

## Provider rollout and operational cost

Keep the project-level command pointing to the repository script; do not set a global unconditional exit 1. Verify live provider readback, preserve Production protection and validate a documentation-only PR after this change is integrated. This trades additional Preview builds for the existing READY requirement. Keep free-tier rate limits and concurrency protections; do not retry repeatedly or cancel unrelated deployments.

For old branches that still contain the previous filter, a single exact-SHA Preview redeploy can recover the gate, without changing the branch or Production. Verify actual READY and the GitHub status description "Deployment has completed".

This change does not alter Vercel project settings, authorize Production, or change any Auth0/Neon credential or permission.
