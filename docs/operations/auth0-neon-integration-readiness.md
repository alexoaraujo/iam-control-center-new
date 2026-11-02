# Auth0 + Neon PostgreSQL — readiness and execution gates

Status: **DRAFT / implementation blocked on database ownership and role-chain evidence**.

Date: 2026-11-01  
Scope: IAM Control Center only. Auth0 remains the sole OIDC identity provider. Neon provides PostgreSQL only. Do not enable Neon Auth or Managed Better Auth.

## 1. Verified repository state

- The web application uses `@auth0/nextjs-auth0@4.33.0`.
- `apps/web/src/lib/auth0.ts` constructs `Auth0Client` from server-side environment variables.
- `.env.example` already declares `DATABASE_URL`, but no PostgreSQL driver or database access module is present in the inspected source.
- `GET /api/health` currently reports `status: scaffold` and only checks whether Auth0 and database configuration values are present. It does not perform a database connection or OIDC flow.
- The current web package does not declare `pg` or another PostgreSQL driver.
- The repository's proposed migration is in PR #57 and must remain a review artifact until ownership and role assumptions are proven.

## 2. Verified Neon state and blockers

Project: `floral-surf-85783683`; database: `iam_control_center`.

Branches:
- `development` — ready
- `preview` — ready
- `production` — ready and primary

The schema comparison reports the namespaces `iam`, `audit`, and `app_private` already exist on the branches inspected, while the PR #57 review checklist records no application tables. This conflicts with migration 0001's strict clean-database preflight, which rejects any pre-existing target namespace. Do not weaken or bypass that preflight until ownership and namespace contents are checked directly.

PR #57's review checklist records:
- `iam_owner`, `iam_migrator`, and `iam_app_runtime` as group roles with NOLOGIN/NOBYPASSRLS;
- `iam_migrator_login` can assume `iam_migrator`, but no membership path from migrator to `iam_owner` was observed;
- the available SQL connector session is fixed to the administrative principal and cannot prove a real runtime login session;
- the administrative principal has BYPASSRLS and is not acceptable as application runtime.

Therefore:
- migration execution is **BLOCKED** until the owner/migrator role chain is explicitly reviewed and verified;
- runtime access is **BLOCKED** until the dedicated login is tested as an actual session;
- no role membership change is authorized by this document;
- Production must remain untouched.

## 3. Target application architecture

### Identity boundary

1. Auth0 authenticates the human and issues the OIDC session/token.
2. The web server obtains the authenticated session from the Auth0 SDK; client-supplied identity, tenant IDs, role names, or permission claims are not trusted as authorization input.
3. The durable external identity key is the pair `(issuer, subject)` from the verified Auth0 identity. Email is profile data, not an identity key or authorization key.
4. The application resolves the internal identity and active tenant membership in PostgreSQL.
5. Authorization is evaluated from server-side membership/role/permission data. Tenant context must be established by a trusted server-side mechanism; a caller-settable PostgreSQL GUC alone is not an isolation boundary.
6. Database queries use a dedicated least-privilege runtime login, never `Administrador`, `iam_owner`, or `iam_migrator`.

### Connection strategy

- Use the `pg` / node-postgres driver in the Node.js Vercel runtime, not an Edge runtime.
- Application traffic uses Neon's pooled connection string in `DATABASE_URL` (hostname includes `-pooler`).
- Schema migration tooling, when separately approved, uses a direct non-pooled connection in `DATABASE_URL_UNPOOLED`.
- Keep both values server-side only. Never prefix them with `NEXT_PUBLIC_`, print them in logs, expose them through health responses, or commit them.
- Use a bounded connection pool and deterministic shutdown/cleanup appropriate to the deployed runtime. Do not instantiate a new pool per request.
- Do not add ORM or migration tooling until the repository's migration ownership workflow is approved; keep SQL migrations as the single schema source of truth unless a separate architecture decision changes that.

### Auth0-to-database lifecycle

1. Verify the Auth0 session server-side.
2. Read issuer and subject only from the verified session/token claims.
3. Upsert or resolve `iam.identities` by `(issuer, subject)`; do not match identities by email.
4. Resolve tenant membership through an explicit server-authorized tenant selection or invitation flow.
5. Reject absent, suspended, revoked, or ambiguous membership.
6. Establish the trusted tenant context and execute tenant-scoped queries under the runtime role.
7. Record security-relevant outcomes in the audit schema without logging bearer tokens, session cookies, database URLs, or secrets.

This lifecycle cannot be enabled against the current migration baseline because its RLS policies and runtime grants are intentionally absent (default-deny). A separate reviewed migration must define and test the trusted tenant-context mechanism, RLS policies, and minimum runtime grants before application data access is enabled.

## 4. Read-only preflight required before changing migration 0001

Run the following only as a read-only diagnostic on **Development** and **Preview**. Do not run it on Production as part of this task. Do not include passwords or connection strings in the output.

```sql
SELECT current_database() AS database_name,
       current_user AS effective_user,
       current_setting('server_version') AS server_version;

SELECT n.nspname AS schema_name,
       r.rolname AS schema_owner
FROM pg_namespace n
JOIN pg_roles r ON r.oid = n.nspowner
WHERE n.nspname IN ('iam', 'audit', 'app_private')
ORDER BY n.nspname;

SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       c.relkind AS relation_kind,
       r.rolname AS relation_owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname IN ('iam', 'audit', 'app_private')
  AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
ORDER BY n.nspname, c.relname;

SELECT rolname, rolcanlogin, rolinherit, rolcreaterole,
       rolcreatedb, rolbypassrls
FROM pg_roles
WHERE rolname IN (
  'iam_owner', 'iam_migrator', 'iam_app_runtime',
  'iam_migrator_login', 'iam_app_runtime_login',
  'app_runtime', 'app_runtime_login'
)
ORDER BY rolname;

SELECT member.rolname AS member_role,
       granted.rolname AS granted_role,
       m.admin_option,
       m.inherit_option,
       m.set_option
FROM pg_auth_members m
JOIN pg_roles granted ON granted.oid = m.roleid
JOIN pg_roles member ON member.oid = m.member
WHERE granted.rolname IN ('iam_owner', 'iam_migrator', 'iam_app_runtime')
   OR member.rolname IN (
     'iam_migrator_login', 'iam_app_runtime_login',
     'app_runtime_login'
   )
ORDER BY granted.rolname, member.rolname;
```

Capture results separately for Development and Preview, including timestamp and branch ID. Redact all secrets. The administrative connector session is not a substitute for connecting as the dedicated runtime login.

## 5. Implementation sequence and acceptance criteria

| Order | Work | Acceptance evidence | Gate |
|---|---|---|---|
| 1 | Resolve namespace ownership and existing objects | Read-only catalog output for Development and Preview | Required |
| 2 | Approve migration preflight strategy for existing empty namespaces | Reviewed SQL diff and PostgreSQL 18 tests proving owner checks and refusal on unexpected objects | Required |
| 3 | Resolve migrator-to-owner membership design | Explicit role graph, NOBYPASSRLS checks, actual SET ROLE proof | Separate explicit approval required before Neon membership mutation |
| 4 | Implement PostgreSQL driver and server-only pool | Frozen-lockfile CI, unit tests, no secret leakage | Required |
| 5 | Implement database connectivity diagnostics | Health endpoint returns only connected/unavailable and safe metadata; no credentials or SQL errors | Required |
| 6 | Implement Auth0 identity resolution | Tests use verified issuer+subject; email changes do not create a new identity | Required |
| 7 | Design trusted tenant context, policies, and runtime grants | Adversarial cross-tenant tests with actual runtime login | Required |
| 8 | Validate Development | Actual connection and migration on Development only, after separate explicit execution approval | Required |
| 9 | Validate Preview | Actual Preview deployment and runtime-role connection | Required |
| 10 | Production | Independent review, recovery plan, explicit Production approval | Not authorized |

## 6. Required CI and security tests

- PostgreSQL 18 disposable database: migration contract, schema ownership, idempotency/refusal behavior, cross-tenant composite foreign keys, audit actor identity consistency.
- Runtime role tests: no BYPASSRLS, no ownership, no DDL, no role management, no migration ledger access.
- RLS tests using the actual runtime role: default-deny before policies; after policy migration, tenant A cannot read or mutate tenant B.
- Auth0 tests: unauthenticated requests rejected; issuer and subject sourced from verified session; no email-based identity linking; suspended/revoked membership denied.
- Health tests: no connection string, password, hostname, issuer, client secret, session secret, token, SQL statement, or stack trace in response.
- CI must report the tested commit SHA. A green disposable PostgreSQL service does not prove Neon credentials, role membership, Vercel environment variables, Auth0 callback, or live RLS.

## 7. Current decision

**Integration status: BLOCKED / NOT CONFIGURED.**

Auth0 remains the identity provider. Neon remains the PostgreSQL provider. The repository has an Auth0 SDK configuration and a database configuration placeholder, but no database driver or real database access layer has been verified. No migration, DDL, DML, role change, membership change, secret provisioning, Vercel variable change, merge, or Production deployment is performed by this readiness record.

Next permitted work is code and test preparation in a Draft PR. Any Neon role membership mutation and any migration execution require their own explicit approval after the preflight evidence and exact SQL diff are presented.
