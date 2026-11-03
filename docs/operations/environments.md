# Environment Setup

## Environments
- Local: fake/non-sensitive data; `.env.local` ignored by Git.
- Preview: isolated Auth0 application and isolated PostgreSQL database/branch; synthetic users only.
- Production: separate Auth0 application and database; protected Vercel environment; approval required.

## Secret inventory
Configure values directly in each provider's secret/environment UI. Never paste them into issues, PRs, logs, source files, or generated artifacts.

Required later:
- Auth0: domain, client ID, client secret, session secret, callback/logout URLs.
- PostgreSQL runtime: `DATABASE_URL` with TLS and a least-privileged runtime login. Neon pooler is disabled in the canonical branches; use no `-pooler` hostname until provider enablement and driver verification.
- PostgreSQL migrations: `DATABASE_MIGRATION_URL` with TLS and a direct (non-pooled) endpoint, restricted to a protected migration job/environment. Do not expose it to the web application runtime.
- Optional provider administration: restricted Auth0 Management API credentials and Vercel API token, only if automation requires them.

## Neon connection contract
See [Neon connection pooling](../architecture/neon-connection-pooling.md) for the runtime/direct split, transaction-pooler restrictions, health-check requirements, and evidence gates.

- Pooler remains disabled. For a controlled Development connectivity test, use the direct endpoint only after provisioning and validating the dedicated runtime credential. The pooled endpoint is a future target, not an active configuration.
- Migrations and schema administration use a direct connection and a dedicated migration identity; the migration URL is not available to the web runtime.
- Never place credentials in source control, CI logs, browser bundles, or public health responses.
- Do not point Preview at production data. Do not run migrations against Production during bootstrap.

## Rollout gate
The variables above are a target contract, not evidence that provider configuration has been completed. Verify the actual role, branch, endpoint type, Vercel environment scope, and successful database query separately. Production requires separate explicit approval.
