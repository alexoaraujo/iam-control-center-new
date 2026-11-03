# IAM tenant-context prototype (CI-only)

Status: executable contract prototype; **not production cryptography**.

This directory is deliberately outside \`database/migrations/\`. It must never be invoked by application startup, build, deploy, or a Neon migration workflow.

## Purpose

Exercise the PostgreSQL-side contract with independent authenticated LOGIN sessions:

- migration fixture: \`iam_migrator_login → iam_migrator → iam_owner\`;
- application fixture: \`iam_app_runtime_login → iam_app_runtime\`;
- tenant-scoped RLS using a transaction-local context;
- fail-closed behavior for absent, unknown, and expired context;
- denial of direct runtime access to the test context registry;
- transaction-local context cleanup.

## Important security boundary

The registry token adapter is deterministic test plumbing, **not a cryptographic authenticator**. A runtime SQL principal that obtains another tenant's valid test token can select that tenant in this prototype. Consequently:

- this harness does not pass SEC-02 (GUC/token substitution resistance);
- it does not pass SEC-03 as a cryptographic signature test;
- it does not select HMAC, JWT, or broker architecture;
- it does not prove Neon role provisioning, Neon TLS, pooling, Auth0, or production RLS.

The adapter exists only to make the database interface executable while keeping the cryptographic decision open. Never copy its token registry or policies into production migrations.

## Run locally

Requires Docker, Bash, and PostgreSQL client tools.

\`\`\`bash
docker run --rm --name iam-context-pg18 \\
  -e POSTGRES_PASSWORD=postgres \\
  -e POSTGRES_DB=iam_context_harness \\
  -p 5432:5432 -d postgres:18

until pg_isready -h localhost -U postgres -d iam_context_harness; do sleep 1; done

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iam_context_harness \\
MIGRATOR_DATABASE_URL=postgresql://iam_migrator_login@localhost:5432/iam_context_harness \\
RUNTIME_DATABASE_URL=postgresql://iam_app_runtime_login@localhost:5432/iam_context_harness \\
MIGRATOR_TEST_PASSWORD='local-only-migrator' \\
RUNTIME_TEST_PASSWORD='local-only-runtime' \\
bash database/prototypes/iam-context/run.sh
\`\`\`

The script creates only disposable local roles and data. Do not point any variable at Neon, Preview, Development, Production, or a shared database.

## Expected result

The runner should report PASS for role contract, absent/unknown/expired context denial, tenant A row isolation under a valid A test token, runtime registry denial, and transaction-local context cleanup. The result is a PostgreSQL 18 disposable-harness result only.

## Promotion gates

No production design may reuse this adapter until a separate reviewed implementation proves a cryptographic verifier (or approved broker), key isolation/rotation, replay semantics, revocation concurrency, and SEC-01–16 with real runtime LOGIN sessions.
