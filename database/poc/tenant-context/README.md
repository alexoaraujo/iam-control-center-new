# IAM-CTX-POC-01 — PostgreSQL tenant-context harness

**Status:** experimental harness under review. Not a production implementation, approved security design, migration, or Neon operation.

## Purpose

Exercise a database-verifiable HMAC context in disposable PostgreSQL. The tenant identifier is carried in a signed envelope; a runtime role can set a custom GUC but cannot read the signing key or invoke the test issuer. RLS calls a SECURITY DEFINER verifier on policy evaluation.

## Boundaries

- Uses only synthetic tenant IDs and records.
- Creates isolated iam_ctx_poc_* roles and schemas.
- Requires PostgreSQL with pgcrypto; CI uses an ephemeral PostgreSQL service.
- Does not connect to Neon, Auth0, Vercel, or Production.
- Does not change database/migrations/0001_initial_iam_schema.sql.
- The deterministic test key is intentionally non-secret and MUST NOT be reused.
- Assertions cover valid tenant A/B visibility, tenant-switch tampering, malformed/missing/expired context, cross-tenant INSERT rejection, and runtime inability to read keys or invoke issuer.

## Security caveats to resolve before any production proposal

1. PostgreSQL STABLE function snapshot semantics and expiry evaluation under long-running transactions.
2. Constant-time signature comparison and canonical payload serialization.
3. Key rotation, multiple active keys, kid handling, revocation and clock skew.
4. Explicit issuer authorization: the application must check OIDC identity, active membership and operation scope before signing.
5. SECURITY DEFINER owner, search_path, schema ownership, function replacement privileges and extension trust.
6. Connection pooling, transaction-local context (set_config(..., true)), cleanup and nested transactions.
7. UPDATE/DELETE policy and grants, not only SELECT/INSERT.
8. Comparison against a broker design that prevents runtime sessions from issuing arbitrary SQL.

## Execution

Run only in the dedicated CI PostgreSQL service:

~~~sh
psql "$POC_DATABASE_URL" -v ON_ERROR_STOP=1 -f database/poc/tenant-context/01_hmac_context.sql
~~~

A green CI job is evidence only for this disposable harness and its exact commit SHA. It is not evidence of Neon role behavior or production RLS.
