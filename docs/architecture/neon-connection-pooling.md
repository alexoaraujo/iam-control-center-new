# Neon connection pooling — runtime and operations

## Status and scope

This document defines the target connection contract for IAM Control Center. It does not create a database client, rotate credentials, change a Neon role, update Vercel variables, enable a pooler, or run migrations. Those actions require a separately reviewed implementation and environment-specific verification.

## Live provider snapshot — 2026-11-03

Canonical Neon project `wandering-wildflower-90908845` (`control-center`) was inspected through the provider API. The Production, Development, and Preview endpoints all reported `pooler_enabled: false`. The API returned pooled-hostname fields containing `-pooler`, but those hostnames are not evidence that PgBouncer is enabled. Therefore the required pooled runtime endpoint is **NOT CONFIGURED / BLOCKED** in all three branches at this snapshot. Do not put a `-pooler` hostname into `DATABASE_URL` until the provider confirms the pooler is enabled and a real connection test succeeds. No pooler setting was changed.

| Branch | Branch ID | Endpoint ID | `pooler_enabled` | Current evidence |
|---|---|---|---:|---|
| Production | `br-dry-mouse-b4gyjp04` | `ep-dawn-river-b4xl1228` | `false` | API inventory only; no connection test |
| Development | `br-nameless-wave-b49yqod7` | `ep-shiny-glade-b4awlrlg` | `false` | API inventory only; no connection test |
| Preview | `br-broad-base-b4gnjmg5` | `ep-soft-night-b4xgjlht` | `false` | API inventory only; no connection test |

The runtime/direct split below is an architecture target, not a statement that either URL is operational. The Vercel `DATABASE_URL` values were not decrypted or inspected; their hostname, branch, role, and pooling mode remain unverified. Production configuration was not changed.

## Connection classes

| Consumer | Environment variable | Endpoint | Role | Pooling |
|---|---|---|---|---|
| Web application runtime | `DATABASE_URL` | Direct endpoint while pooler is disabled; pooled endpoint only after provider enablement and verification | `iam_app_runtime_login` (Development only; credentials not provisioned) | BLOCKED / direct test pending |
| Migration runner / schema maintenance | `DATABASE_MIGRATION_URL` | Neon direct hostname (no `-pooler`) | Dedicated migration identity; never the app runtime role | Disabled |
| Local development runtime | `DATABASE_URL` | Development direct endpoint while pooler is disabled | Dedicated runtime login (not yet authenticated) | Direct endpoint only for controlled test |
| CI schema tests | Ephemeral PostgreSQL service | Direct local service endpoint | Disposable test role | Not applicable |

Both variables are secrets and must be configured only in the environment that needs them. The application runtime must not receive `DATABASE_MIGRATION_URL`. Do not copy a Production URL into Development or Preview. No runtime credential has been provisioned; do not configure the app for a successful Neon query until the login and endpoint are verified.

## Neon transaction-pooler contract

Neon pooled connections use PgBouncer transaction mode. A client connection is assigned a PostgreSQL server connection for a transaction and returned to the pool when that transaction ends. Therefore:

- Do not depend on session state surviving between transactions.
- Do not issue session-scoped `SET`/`RESET` as application configuration. Use explicit query/schema qualification or a reviewed role-level default where appropriate.
- Do not use `LISTEN`/`NOTIFY`, session-level advisory locks, session-persistent temporary objects, SQL `PREPARE`/`DEALLOCATE`, or other session-affine features through the pooled runtime URL.
- Protocol-level prepared statements are supported by current Neon PgBouncer; verify the selected driver's behavior before enabling named prepared statements.
- Keep transactions short. Do not hold a transaction open across network calls, user interaction, or long-running work.
- Schema migrations, `pg_dump`/`pg_restore`, logical replication, and administration use the direct URL.

## Runtime client requirements

When a PostgreSQL driver/client is introduced:

1. Keep one bounded connection pool per application process/instance; do not create a new pool per request.
2. Configure conservative pool limits based on Neon compute size and the total number of concurrently running Vercel instances. Neon pool limits are shared across clients for the same database/user; do not assume every function receives an independent server-connection budget.
3. Set finite connection acquisition and idle timeouts. Ensure the pool is closed during process shutdown where the runtime supports lifecycle hooks.
4. Use connection validation/health checks or a pre-ping equivalent where supported, and use bounded retry with exponential backoff and jitter only for transient connection establishment failures.
5. Never automatically replay a transaction or a non-idempotent write after an ambiguous connection failure. Use idempotency keys or application-level reconciliation where required.
6. Use TLS and verify the certificate according to the driver's supported configuration. Never log connection strings, passwords, or full connection errors containing credentials.
7. Use parameterized queries. Tenant authorization must be performed by the application and enforced by the approved database trust boundary; a plain writable tenant GUC is not a strong isolation boundary.

Do not select a driver or hard-code pool sizes in this document. The implementation PR must choose and pin the supported client, document its pool settings, and test behavior against the actual Neon pooled endpoint.

## Health checks and observability

The current `/api/health` endpoint reports scaffold/configuration status only. It does not execute SQL and must not be described as proof of database connectivity.

When a database client is implemented, keep liveness separate from readiness:
- Liveness: process can respond; no database dependency.
- Readiness: perform a bounded `SELECT 1` through the runtime pooled URL and report only a sanitized status.
- Monitor pool client connections (active/idle/waiting), server connections (active/idle), acquisition latency, timeouts, and database errors. Do not expose SQL, hostnames, role names, or credentials in public health responses.

## Environment rollout and evidence

1. Verify the runtime login role and its effective privileges independently in Development and Preview. Development has the IAM roles but no LOGIN credentials; Preview has not received the IAM role bootstrap.
2. While `pooler_enabled=false`, do not request or configure a pooled URL. For a controlled Development test, use the direct endpoint and dedicated runtime login only after its credential is provisioned; enable pooling later as a separate approved change.
3. Keep a separate direct URL only in a protected migration environment/secret store when a migration workflow is implemented.
4. Verify host form without revealing credentials: direct runtime URL has no `-pooler` while pooling is disabled; after provider enablement and a separate driver test, pooled runtime URL uses `-pooler`; migration URL remains direct.
5. Deploy to Development, execute a real bounded database readiness check, and record branch, deployment URL, commit SHA, sanitized outcome, and role verification.
6. Repeat on Preview with synthetic data.
7. Production is out of scope until separately approved. Do not edit Production variables or run Production migrations as part of this rollout.

## References

- Neon documentation: https://neon.com/docs/connect/connection-pooling
- Neon pooled connections use transaction mode; confirm current provider behavior and driver compatibility before implementation.
