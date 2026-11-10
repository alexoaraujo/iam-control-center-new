# IAM Control Center

Security-first, multi-tenant identity and access management control plane.

## Status
Bootstrap scaffold only. Authentication, authorization, persistence, and deployment are **not yet production-ready**. This GitHub repository exists, but this scaffold does not configure or verify a working Auth0 login, managed PostgreSQL connection, or Vercel deployment.

## Architecture
- `apps/web`: Next.js App Router UI and server-side endpoints.
- `database/migrations`: reviewed, versioned PostgreSQL migrations.
- `.github/workflows/quality.yml`: CI checks for pushes and pull requests targeting any branch.
- `docs/`: architecture, security, evidence, and operations records.

Auth0 is the identity provider; application authorization and tenant membership remain server-side application responsibilities. Never derive tenant access from email or user-editable metadata.

## Prerequisites
- Node.js 24.x
- pnpm 10.34.9 (pinned through `packageManager`)
- PostgreSQL for future integration tests
- Auth0 development tenant created separately
- GitHub repository and Vercel project configured separately

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

Bootstrap note: `pnpm-lock.yaml` is committed and CI uses `pnpm install --frozen-lockfile` with the pinned pnpm version. The quality workflow runs dependency audit, lint, typecheck, tests, and build; a successful run is evidence only for the exact tested SHA and does not by itself make GitHub branch rules enforceable. The health endpoint reports only whether the required Auth0 and database environment variables are present; it does not verify credentials, perform an Auth0 login, or establish database connectivity. The dashboard and protected routes require an Auth0 session. The public health endpoint is liveness only. Configure secrets only in local ignored env files or protected service environment settings.

## Evidence policy
A result is PASS only when a check completed successfully against the exact commit SHA under review. A missing, skipped, stale, or unrelated check is not PASS. Production deployment requires explicit approval and a verified Preview evidence bundle.

## Security
See [SECURITY.md](SECURITY.md), [architecture](docs/architecture/overview.md), and [evidence policy](docs/evidence/policy.md).

## Integration and readiness contract

See [repository integration setup](docs/operations/repository-integration-setup.md).
`GET /api/health` remains a public, uncached liveness response. `GET /api/ready`
requires an Auth0 session and returns 200 only after complete configuration and a
successful database role probe; incomplete configuration, connection errors and
unexpected/privileged roles return 503. Anonymous callers receive 401 without a
query. Readiness does not establish tenant isolation, effective grants, or Auth0
provider availability.

Database contract CI runs on every pull request and push to main. It tests both
the clean-install proposal and the separately restored source schema. These are
distinct lineages; migration 0002 is not a generic successor to clean-install 0001.
