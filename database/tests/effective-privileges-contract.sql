-- CI-only effective privilege audit after migration 0001 in disposable PostgreSQL 18.
-- Run as the disposable test administrator. Read-only assertions only.
\set ON_ERROR_STOP on

DO $database_privileges$
BEGIN
  IF has_database_privilege('iam_app_runtime_login', current_database(), 'CREATE')
     OR has_database_privilege('iam_app_runtime_login', current_database(), 'TEMP')
     OR NOT has_database_privilege('iam_app_runtime_login', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'runtime login database privileges exceed explicit CONNECT';
  END IF;
  IF has_database_privilege('iam_migrator_login', current_database(), 'CREATE')
     OR has_database_privilege('iam_migrator_login', current_database(), 'TEMP')
     OR NOT has_database_privilege('iam_migrator_login', current_database(), 'CONNECT') THEN
    RAISE EXCEPTION 'migrator login database privileges exceed explicit CONNECT';
  END IF;
  IF pg_has_role('iam_app_runtime_login', 'iam_owner', 'MEMBER')
     OR pg_has_role('iam_app_runtime_login', 'iam_migrator', 'MEMBER')
     OR pg_has_role('iam_app_runtime_login', 'iam_owner', 'USAGE')
     OR pg_has_role('iam_app_runtime_login', 'iam_migrator', 'USAGE') THEN
    RAISE EXCEPTION 'runtime login has an owner/migrator membership or inherited privilege path';
  END IF;
  IF pg_has_role('iam_migrator_login', 'iam_owner', 'USAGE')
     OR pg_has_role('iam_migrator_login', 'iam_migrator', 'USAGE') THEN
    RAISE EXCEPTION 'migrator login unexpectedly inherits group-role privileges before SET ROLE';
  END IF;
  IF NOT pg_has_role('iam_migrator_login', 'iam_owner', 'MEMBER')
     OR NOT pg_has_role('iam_migrator_login', 'iam_migrator', 'MEMBER') THEN
    RAISE EXCEPTION 'migrator login lost its explicitly reviewed SET ROLE path';
  END IF;
END
$database_privileges$;

DO $schema_privileges$
DECLARE schema_name text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY['iam','audit','app_private'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = schema_name) THEN
      RAISE EXCEPTION 'expected application schema % is missing after migration', schema_name;
    END IF;
    IF has_schema_privilege('iam_app_runtime_login', schema_name, 'USAGE')
       OR has_schema_privilege('iam_app_runtime_login', schema_name, 'CREATE')
       OR has_schema_privilege('iam_migrator_login', schema_name, 'USAGE')
       OR has_schema_privilege('iam_migrator_login', schema_name, 'CREATE') THEN
      RAISE EXCEPTION 'LOGIN principal unexpectedly has effective privileges on schema %', schema_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS effective schema privileges: IAM LOGINs have no schema USAGE/CREATE';
END
$schema_privileges$;

DO $relation_privileges$
DECLARE relation record; privilege_name text; checked_relations integer := 0;
BEGIN
  FOR relation IN
    SELECT c.oid, n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('iam','audit','app_private')
       AND c.relkind IN ('r','p','v','m','f')
  LOOP
    checked_relations := checked_relations + 1;
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF has_table_privilege('iam_app_runtime_login', relation.oid, privilege_name) THEN
        RAISE EXCEPTION 'runtime login has unexpected % on %.%', privilege_name, relation.nspname, relation.relname;
      END IF;
      IF has_table_privilege('iam_migrator_login', relation.oid, privilege_name) THEN
        RAISE EXCEPTION 'migrator login inherits unexpected % on %.% before SET ROLE', privilege_name, relation.nspname, relation.relname;
      END IF;
    END LOOP;
  END LOOP;
  IF checked_relations = 0 THEN
    RAISE EXCEPTION 'no application relations found for effective privilege audit';
  END IF;
  RAISE NOTICE 'PASS effective relation privileges: no LOGIN table privileges across % application relations', checked_relations;
END
$relation_privileges$;

DO $sequence_privileges$
DECLARE sequence_row record;
BEGIN
  FOR sequence_row IN
    SELECT c.oid, n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind='S'
  LOOP
    IF has_sequence_privilege('iam_app_runtime_login', sequence_row.oid, 'USAGE')
       OR has_sequence_privilege('iam_app_runtime_login', sequence_row.oid, 'SELECT')
       OR has_sequence_privilege('iam_app_runtime_login', sequence_row.oid, 'UPDATE')
       OR has_sequence_privilege('iam_migrator_login', sequence_row.oid, 'USAGE')
       OR has_sequence_privilege('iam_migrator_login', sequence_row.oid, 'SELECT')
       OR has_sequence_privilege('iam_migrator_login', sequence_row.oid, 'UPDATE') THEN
      RAISE EXCEPTION 'LOGIN principal has unexpected effective privilege on sequence %.%', sequence_row.nspname, sequence_row.relname;
    END IF;
  END LOOP;
END
$sequence_privileges$;

-- Operational worker/export roles are environment-specific provisioning inputs.
DO $external_login_scope$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('iam_worker_login','iam_schema_export_reader')) THEN
    RAISE EXCEPTION 'external operational logins unexpectedly entered the portable bootstrap fixture';
  END IF;
  RAISE NOTICE 'SCOPE: worker/export logins are not provisioned by this portable fixture';
END
$external_login_scope$;
