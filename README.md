# IAM Control Center

Security-first, multi-tenant identity and access management control plane.

## Status
Bootstrap scaffold only. Authentication, authorization, persistence, and deployment are **not yet production-ready**. No real Auth0 tenant, database, GitHub repository, or Vercel project is provisioned by this archive.

## Architecture
- `apps/web`: Next.js App Router UI and server-side endpoints.
- `database/migrations`: reviewed, versioned PostgreSQL migrations.
- `.github/workflows/ci.yml`: pull-request quality gate.
- `docs/`: architecture, security, evidence, and operations records.

Auth0 is the identity provider; application authorization and tenant membership remain server-side application responsibilities. Never derive tenant access from email or user-editable metadata.

## Prerequisites
- Node.js 24.x
- pnpm 10.12.1 (pinned through `packageManager`)
- PostgreSQL for future integration tests
- Auth0 development tenant created separately
- Private GitHub repository and Vercel project created separately

## Local setup
```bash
corepack enable
pnpm install
cp .env.example apps/web/.env.local
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @iam-control-center/web dev
```

Bootstrap note: this archive omits a generated `pnpm-lock.yaml` because package resolution was not run in this environment. Generate and commit the lockfile with the pinned pnpm version, then change CI installation to `pnpm install --frozen-lockfile` before making CI a required merge check. Until then, CI is not considered release evidence. The app deliberately does not require Auth0 or a database to run the initial scaffold. Configure secrets only in local ignored env files or protected service environment settings.

## Evidence policy
A result is PASS only when a check completed successfully against the exact commit SHA under review. A missing, skipped, stale, or unrelated check is not PASS. Production deployment requires explicit approval and a verified Preview evidence bundle.

## Security
See [SECURITY.md](SECURITY.md), [architecture](docs/architecture/overview.md), and [evidence policy](docs/evidence/policy.md).
