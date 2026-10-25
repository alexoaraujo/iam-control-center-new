# IAM Control Center

Security-first, multi-tenant identity and access management control plane.

## Status
Bootstrap scaffold only. Authentication, authorization, persistence, and deployment are **not yet production-ready**. This repository does not configure or verify a working Auth0 login, managed PostgreSQL connection, or Vercel deployment.

## Architecture
- `apps/web`: Next.js App Router UI and server-side endpoints.
- `database/migrations`: reviewed, versioned PostgreSQL migrations.
- `.github/workflows/quality.yml`: CI checks for pushes and pull requests targeting any branch.
- `docs/`: architecture, security, evidence, and operations records.
- [Neon database management reference](docs/reference/neon-databases.md): official guidance and project-specific safety checklist for database ownership, privileges, renaming/deletion, and migration readiness.

Auth0 is the identity provider; application authorization and tenant membership remain server-side application responsibilities. Never derive tenant access from email or user-editable metadata.

## Prerequisites
- Node.js 24.x
- pnpm 10.12.1 (pinned through `packageManager`)
- PostgreSQL for future integration tests
- Auth0 development tenant created separately
- GitHub repository and Vercel project created separately

## Local setup
```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example apps/web/.env.local
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @iam-control-center/web dev
```

Bootstrap note: `pnpm-lock.yaml` is committed and CI uses `pnpm install --frozen-lockfile` with the pinned pnpm version. The quality workflow runs dependency audit, lint, typecheck, tests, and build; a successful run is evidence only for the exact tested SHA and does not by itself make GitHub branch rules enforceable. The health endpoint reports only whether the required Auth0 and database environment variables are present; it does not verify credentials, perform an Auth0 login, or establish database connectivity. The app deliberately remains a scaffold and does not require Auth0 or a database to run locally. Configure secrets only in local ignored env files or protected service environment settings.

## Evidence policy
A result is PASS only when a check completed successfully against the exact commit SHA under review. A missing, skipped, stale, or unrelated check is not PASS. Production deployment requires explicit approval and a verified Preview evidence bundle.

## Security
See [SECURITY.md](SECURITY.md), [architecture](docs/architecture/overview.md), and [evidence policy](docs/evidence/policy.md).
