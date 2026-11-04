# Vercel Preview build filter

## Purpose

Keep GitHub quality gates mandatory while avoiding a Vercel Preview build when a pull request changes only documentation or operational material that cannot affect the deployed Next.js application.

## Build policy

- Production deployments are never skipped.
- Preview deployments build when `apps/web/**`, `packages/**`, workspace dependency manifests, or shared build configuration changes.
- Preview deployments may be skipped for documentation-only, database proposal, or workflow-only changes.
- Missing commit metadata, an unavailable previous SHA, or a Git diff failure must fall back to a normal build.
- GitHub CI continues to run frozen install, dependency audit, lint, typecheck, application tests, filter tests, and the application build on every pull request. Only the external Preview wait gate is skipped when the same path-impact check says no deployment is required.

## Provider rollout

The Vercel project-level Ignored Build Step calls `scripts/vercel-ignore-build.mjs` from the repository root. The shell command resolves the Git root so it works even when the Vercel project Root Directory is a subdirectory. Branches that do not yet contain the script fall back to a normal build. The script is intentionally fail-closed.

This policy does not authorize a Production deployment, alter deployment protection, or change any Auth0/Neon setting.
