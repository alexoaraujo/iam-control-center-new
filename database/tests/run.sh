#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL database}"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/bootstrap.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "SET ROLE iam_owner" -f database/migrations/0001_initial_iam_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/0001_schema_contract.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-fixture.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/proposals/neon-runtime-role-hardening.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-contract.sql

# Negative control: the real contract must reject a transitive admin path.
negative_log="$(mktemp)"
trap 'rm -f "$negative_log"' EXIT
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-transitive-negative.sql
if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-contract.sql >"$negative_log" 2>&1; then
  echo "FAIL: runtime contract accepted a transitive administrative membership" >&2
  exit 1
elif grep -Fq "runtime role reaches an administrative role through direct or transitive membership" "$negative_log"; then
  echo "PASS: runtime contract rejected the transitive administrative membership"
else
  cat "$negative_log" >&2
  echo "FAIL: contract failed for an unexpected reason" >&2
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-transitive-cleanup.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/neon-runtime-role-hardening-contract.sql
echo "PASS: IAM schema, RLS default-deny, and Neon runtime direct/transitive membership contract"
