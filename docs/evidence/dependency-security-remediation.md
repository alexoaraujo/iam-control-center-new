# Dependency security remediation

Date: 2026-10-24

## Changes
- Updated `next` and `eslint-config-next` to `15.5.28`.
- Updated `react` and `react-dom` to `19.1.10`.
- Updated `vitest` to `4.1.12` to address audit findings in Vitest and Tinypool.
- Added root pnpm overrides `postcss@8.5.23` and `sharp@0.35.5` to select patched transitive versions.
- Regenerated `pnpm-lock.yaml` using the repository-pinned `pnpm@10.12.1`; no lockfile integrity fields were edited manually.
- Removed the temporary lockfile-refresh workflow after it completed its task.

## Validation evidence
The temporary GitHub Actions validation on commit `d932b67f250913662b176a8c910043d283608cdd` completed successfully for:
- `pnpm install --lockfile-only --ignore-scripts`
- `pnpm install --frozen-lockfile`
- lint, typecheck, tests, and build
- full `pnpm audit`: `No known vulnerabilities found` (exit code 0)

The lockfile was committed by the workflow as `1e0ab603bb00d3ce2df7443c9e666948efe52cbe`. Standard CI then passed on SHA `853d583f55754e1db0e1a6e0308fe9008d22eb52`: https://github.com/alexoaraujo83/iam-control-center/actions/runs/40053650005. The manifest/evidence update in the current commit still requires its own standard CI run before the PR can be considered validated.

## Security references
- Next.js fixed release guidance: https://www.csa.gov.sg/alerts-and-advisories/alerts/al-2026-148/
- React Server Components advisory: https://github.com/vercel/next.js/security/advisories/GHSA-9qr9-h5gf-34mp
- Vitest advisory: https://github.com/advisories/GHSA-5xrq-8626-4rwp
- Tinypool advisories: https://github.com/advisories/GHSA-5gmw-xhrv-c9v3 and https://github.com/advisories/GHSA-85c8-ppgw-ccpr

## Scope limits
This evidence covers dependency installation, lint, typecheck, tests, build, and the package audit. It does not establish working Auth0 login, managed PostgreSQL connectivity, tenant authorization/RLS, Vercel deployment protections, or production readiness. Keep the pull request in Draft until standard CI passes on the final SHA and the remaining integration/security reviews are complete.
