#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "${IAM_ALLOW_DISPOSABLE_DB_TESTS:-}" != "1" ]]; then
  echo "Refusing database test: set IAM_ALLOW_DISPOSABLE_DB_TESTS=1 explicitly." >&2
  exit 64
fi

case "${PGHOST:-127.0.0.1}" in
  localhost|127.0.0.1|::1) ;;
  *)
    echo "Refusing database test on non-loopback PGHOST=${PGHOST}." >&2
    exit 64
    ;;
esac

if [[ "${PGPORT:-5432}" != "5432" ]]; then
  echo "Refusing database test on unexpected PGPORT=${PGPORT}." >&2
  exit 64
fi

if [[ -z "${PGDATABASE:-}" || "${PGDATABASE}" == "production" ]]; then
  echo "Refusing database test: set PGDATABASE to a disposable test database." >&2
  exit 64
fi

ROOT="$(git rev-parse --show-toplevel)"
MIGRATION_FILE="${MIGRATION_FILE:-${ROOT}/database/proposals/0001-initial-iam-schema.sql}"
if [[ ! -f "${MIGRATION_FILE}" ]]; then
  echo "Proposal SQL not found: ${MIGRATION_FILE}" >&2
  exit 66
fi

CHECKSUM="$(sha256sum -- "${MIGRATION_FILE}" | awk '{print $1}')"
PSQL_FILE="$(mktemp)"
trap 'rm -f "${PSQL_FILE}"' EXIT

cat > "${PSQL_FILE}" <<'PSQL'
\set ON_ERROR_STOP on
SET ROLE iam_owner;
SELECT pg_advisory_lock(20261026, 1);

SELECT to_regclass('iam.schema_migrations') IS NOT NULL AS ledger_exists \gset
\if :ledger_exists
  SELECT EXISTS (
    SELECT 1
    FROM iam.schema_migrations
    WHERE version = '0001_initial_iam_schema'
  ) AS migration_exists \gset
  \if :migration_exists
    SELECT checksum = :'checksum' AS checksum_matches
    FROM iam.schema_migrations
    WHERE version = '0001_initial_iam_schema' \gset
    \if :checksum_matches
      \echo "IDEMPOTENCE: existing version and checksum match; skipping apply."
      \quit
    \else
      DO LANGUAGE plpgsql 'BEGIN RAISE EXCEPTION ''proposal version exists with a different checksum; refusing to apply''; END';
    \endif
  \else
    DO LANGUAGE plpgsql 'BEGIN RAISE EXCEPTION ''migration ledger exists but has no baseline row; manual reconciliation is required''; END';
  \endif
\else
  SELECT (
    EXISTS (
      SELECT 1
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('iam', 'audit', 'app_private')
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    )
    OR EXISTS (
      SELECT 1
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('iam', 'audit', 'app_private')
    )
  ) AS existing_objects \gset
  \if :existing_objects
    DO LANGUAGE plpgsql 'BEGIN RAISE EXCEPTION ''application objects exist without a verified ledger; refusing baseline''; END';
  \endif
\endif

BEGIN;
PSQL

printf '\\i %s\n' "${MIGRATION_FILE}" >> "${PSQL_FILE}"
cat >> "${PSQL_FILE}" <<'PSQL'
INSERT INTO iam.schema_migrations (version, name, checksum)
VALUES ('0001_initial_iam_schema', 'proposed initial IAM schema', :'checksum');
COMMIT;

SELECT pg_advisory_unlock(20261026, 1);
PSQL

psql -X --set=ON_ERROR_STOP=1 --set=checksum="${CHECKSUM}" --file="${PSQL_FILE}"
echo "Proposal SHA-256: ${CHECKSUM}"
