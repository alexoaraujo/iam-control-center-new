# IAM-CTX-POC-01 — PostgreSQL disposable harness (draft 0.1)

## Purpose

A local-only prototype for evaluating tenant-context and RLS behavior against a disposable PostgreSQL 18 instance. It is deliberately separate from database/migrations and must not be pointed at any shared Neon branch.

## Safety boundary

- The SQL creates cluster-level fixture roles and objects. Run it only in a disposable PostgreSQL 18 container.
- The fixture fails closed unless the database is exactly iam_ctx_test, the server is PostgreSQL 18, the session principal is postgres, and the connection application_name is iam-context-harness-disposable.
- The explicit application_name marker is an additional accidental-misconfiguration guard, not cryptographic proof that a server is disposable. Use the documented local Docker command or the GitHub Actions service container only.
- Do not supply DATABASE_URL, Neon connection strings, or production credentials.
- The token registry in this prototype is a test fixture, not cryptographic verification. Table owners are not forced through RLS in this fixture because the narrow SECURITY DEFINER helpers need to inspect membership state; the runtime role remains non-owner and is tested under RLS.
- No production crypto decision has been made. This harness does not prove authenticity against a database attacker, replay resistance, or Neon compatibility.
- Never copy this SQL into production migrations.

## Run

Requires Docker and psql in the container image.

    docker run --rm --name iam-ctx-pg18 \
      -e POSTGRES_PASSWORD=local_only \
      -e POSTGRES_DB=iam_ctx_test \
      -p 55432:5432 -d postgres:18

    until pg_isready -h 127.0.0.1 -p 55432 -U postgres; do sleep 1; done

    PGAPPNAME=iam-context-harness-disposable PGPASSWORD=local_only psql -v ON_ERROR_STOP=1 \
      -h 127.0.0.1 -p 55432 -U postgres -d iam_ctx_test \
      -f sql/00_fixture.sql

    PGAPPNAME=iam-context-harness-disposable PGPASSWORD=local_only psql -v ON_ERROR_STOP=1 \
      -h 127.0.0.1 -p 55432 -U postgres -d iam_ctx_test \
      -f tests/10_sec01_sec16.sql

    docker rm -f iam-ctx-pg18

The container is disposable. The test SQL rolls back fixture mutations where applicable; removing the container removes the database.

## Status semantics

- PASS local: the named assertion passed against this disposable local PostgreSQL instance.
- FAIL: the assertion ran and did not meet its expected result.
- BLOCKED Neon: requires validation on an isolated Neon branch using the actual runtime role and service configuration. This package does not connect to Neon.
- NOT RUN: no execution evidence has been collected.

## Current implementation limits

The included SQL is an initial executable fixture, not a complete security implementation. In particular:

- SEC-03/04/05 use an opaque token lookup fixture; no signature algorithm is selected or verified.
- SEC-10 tests access to the fixture registry, not the security of a production key-management design.
- SEC-12 uses a deliberately absent grant as the negative case; it does not establish the final SECURITY DEFINER design.
- SEC-13 is represented by a database-side guarded write function so permission state is checked in the write path.
- SEC-06 bootstrap semantics remain intentionally deny-by-default; automatic identity creation is not specified.
- Replay protection is not claimed.

## Required follow-up before production

1. Approve a cryptographic assertion design and key lifecycle.
2. Decide identity bootstrap and tenant-selection contracts.
3. Review migration 0001 divergences; do not reuse it blindly.
4. Run tests as the actual non-owner runtime role.
5. Repeat on an isolated Neon branch and capture PostgreSQL version, role attributes, grants, policies, SHA, run ID and sanitized output.
6. Keep production migrations and deployment blocked until separately reviewed and authorized.
