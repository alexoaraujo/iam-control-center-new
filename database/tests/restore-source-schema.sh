#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must point to a disposable PostgreSQL 18 database}"

echo "[source-schema-restore] creating only the roles required by the schema dump"
psql -X --no-password "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE ROLE iam_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_migrator NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_app_runtime NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE iam_worker NOLOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
SQL

echo "[source-schema-restore] restoring canonical schema-only dump into the empty database"
psql -X --no-password "$DATABASE_URL" -v ON_ERROR_STOP=1 -f iam_database_schema.sql

echo "[source-schema-restore] validating restored catalog, ownership, RLS, policies, and empty data"
psql -X --no-password "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
DO $restore_contract$
DECLARE
  v_tables integer;
  v_views integer;
  v_functions integer;
  v_enums integer;
  v_triggers integer;
  v_policies integer;
  v_indexes integer;
  v_rls_tables integer;
  v_forced_rls_tables integer;
  v_schema_owners integer;
  v_table_owners integer;
  v_function_owners integer;
  v_extension boolean;
  v_partial_index boolean;
  v_context_function_secure boolean;
  v_context_function_owner text;
  v_context_function_config text[];
  r record;
  v_rows bigint;
BEGIN
  SELECT count(*) INTO v_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p');

  SELECT count(*) INTO v_views
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind = 'v';

  SELECT count(*) INTO v_functions
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('iam','audit','app_private') AND p.prokind = 'f';

  SELECT count(*) INTO v_enums
    FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
   WHERE n.nspname IN ('iam','audit','app_private') AND t.typtype = 'e';

  SELECT count(*) INTO v_triggers
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private') AND NOT t.tgisinternal;

  SELECT count(*) INTO v_policies
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private');

  SELECT count(*) INTO v_indexes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind = 'i';

  SELECT count(*) INTO v_rls_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p') AND c.relrowsecurity;

  SELECT count(*) INTO v_forced_rls_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p') AND c.relforcerowsecurity;

  SELECT count(*) INTO v_schema_owners
    FROM pg_namespace n
   WHERE n.nspname IN ('iam','audit','app_private')
     AND n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'iam_owner');

  SELECT count(*) INTO v_table_owners
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND c.relkind IN ('r','p')
     AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'iam_owner');

  SELECT count(*) INTO v_function_owners
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('iam','audit','app_private')
     AND p.prokind = 'f'
     AND p.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'iam_owner');

  SELECT EXISTS (
    SELECT 1
      FROM pg_index i
      JOIN pg_class idx ON idx.oid = i.indexrelid
      JOIN pg_namespace ns ON ns.oid = idx.relnamespace
      JOIN pg_class tbl ON tbl.oid = i.indrelid
      JOIN pg_namespace ts ON ts.oid = tbl.relnamespace
     WHERE ns.nspname = 'app_private'
       AND idx.relname = 'context_keys_one_active_idx'
       AND ts.nspname = 'app_private'
       AND tbl.relname = 'context_keys'
       AND i.indisunique
       AND i.indisvalid
       AND pg_get_expr(i.indpred, i.indrelid) = '(active IS TRUE)'
  ) INTO v_partial_index;

  SELECT p.prosecdef, pg_get_userbyid(p.proowner), p.proconfig
    INTO v_context_function_secure, v_context_function_owner, v_context_function_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app_private' AND p.proname = 'current_tenant_id'
     AND p.prokind = 'f' AND pg_get_function_identity_arguments(p.oid) = '';

  SELECT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto' AND n.nspname = 'public'
  ) INTO v_extension;

  IF v_tables <> 23 OR v_views <> 1 OR v_functions <> 9 OR v_enums <> 7
     OR v_triggers <> 12 OR v_policies <> 41 OR v_indexes < 18
     OR v_rls_tables <> 20 OR v_forced_rls_tables <> 20
     OR v_schema_owners <> 3 OR v_table_owners <> 23
     OR v_function_owners <> 9 OR NOT v_extension OR NOT v_partial_index
     OR v_context_function_secure IS DISTINCT FROM TRUE
     OR v_context_function_owner <> 'iam_owner'
     OR NOT (v_context_function_config @> ARRAY['search_path=pg_catalog, app_private, iam']::text[])
     OR v_context_function_config @> ARRAY['search_path=pg_catalog, app_private, iam, public']::text[] THEN
    RAISE EXCEPTION
      'restore catalog contract mismatch: tables=%, views=%, functions=%, enums=%, triggers=%, policies=%, indexes=%, rls=%, forced_rls=%, schema_owners=%, table_owners=%, function_owners=%, pgcrypto=%, partial_unique_index=%, current_tenant_id_secure=%, owner=%, config=%',
      v_tables, v_views, v_functions, v_enums, v_triggers, v_policies,
      v_indexes, v_rls_tables, v_forced_rls_tables, v_schema_owners,
      v_table_owners, v_function_owners, v_extension, v_partial_index,
      v_context_function_secure, v_context_function_owner, v_context_function_config;
  END IF;

  FOR r IN
    SELECT schemaname, tablename
      FROM pg_tables
     WHERE schemaname IN ('iam','audit','app_private')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', r.schemaname, r.tablename)
      INTO v_rows;
    IF v_rows <> 0 THEN
      RAISE EXCEPTION 'schema-only restore unexpectedly contains rows in %.%', r.schemaname, r.tablename;
    END IF;
  END LOOP;

  RAISE NOTICE
    'PASS source schema restore: 23 tables, 1 view, 9 functions, 7 enums, 12 triggers, 41 policies, 20 forced-RLS tables, owners and pgcrypto verified; no application rows';
END
$restore_contract$;
SQL

echo "PASS: full schema-only restore and catalog contract completed in disposable PostgreSQL 18."


echo "[source-schema-restore] running dynamic RLS and signed tenant-context contract as iam_app_runtime"
psql -X --no-password "$DATABASE_URL" -v ON_ERROR_STOP=1 -f database/tests/runtime-rls-contract.sql
