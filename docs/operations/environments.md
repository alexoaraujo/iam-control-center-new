# Environment Setup

## Environments
- Local: fake/non-sensitive data; `.env.local` ignored by Git.
- Preview: isolated Auth0 application and isolated PostgreSQL database/branch; synthetic users only.
- Production: separate Auth0 application and database; protected Vercel environment; approval required.

## Secret inventory
Configure values directly in each provider's secret/environment UI. Never paste them into issues, PRs, logs, source files, or generated artifacts.

Required later:
- Auth0: domain, client ID, client secret, session secret, callback/logout URLs.
- PostgreSQL: connection string with TLS and a least-privileged runtime role.
- Optional provider administration: restricted Auth0 Management API credentials and Vercel API token, only if automation requires them.

Do not point Preview at production data. Do not run migrations against production during bootstrap.
