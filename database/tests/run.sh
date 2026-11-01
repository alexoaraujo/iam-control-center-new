#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/bootstrap.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET ROLE iam_owner" -f database/migrations/0001_initial_iam_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/0001_schema_contract.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/proposals/neon-runtime-role-hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-contract.sql
echo "PASS: IAM schema, RLS default-deny, and Neon runtime least-privilege contract"
