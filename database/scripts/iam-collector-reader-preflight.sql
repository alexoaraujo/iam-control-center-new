-- PEOS: catalog-only diagnostic. No GRANT, REVOKE, SET ROLE or business rows.
-- Run as an approved catalog inspector, not as proof of reader authentication.
-- projected_definer_execute assumes USAGE on iam, even when currently denied.
WITH reader AS (
  SELECT oid, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreaterole,
         rolcreatedb, rolreplication, rolconfig
  FROM pg_catalog.pg_roles WHERE rolname='iam_schema_export_reader'
), ledger AS (
  SELECT c.oid,c.relkind,c.relrowsecurity
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='iam' AND c.relname='schema_migrations'
), scope AS (
  SELECT n.oid,n.nspname FROM pg_catalog.pg_namespace n
  WHERE pg_catalog.left(n.nspname,3) <> 'pg_' AND n.nspname <> 'information_schema'
)
SELECT pg_catalog.jsonb_build_object(
 'format','iam-collector-reader-preflight/v1',
 'branch_id',nullif(pg_catalog.current_setting('neon.branch_id',true),''),
 'database',pg_catalog.current_database(),
 'pg_version',pg_catalog.current_setting('server_version_num')::int,
 'session_user',session_user,'current_user',current_user,
 'ledger_present',EXISTS(SELECT 1 FROM ledger),
 'ledger_contract',COALESCE((SELECT l.relkind='r' AND NOT l.relrowsecurity
  AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text)
       FROM pg_catalog.pg_attribute a WHERE a.attrelid=l.oid AND a.attnum>0 AND NOT a.attisdropped)
     =ARRAY['applied_at','checksum_sha256','execution_role','migration_id','source_sha']::text[]
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=l.oid AND a.attnum>0 AND NOT a.attisdropped
     AND ((a.attname='applied_at' AND a.atttypid<>'pg_catalog.timestamptz'::regtype)
       OR (a.attname<>'applied_at' AND a.atttypid<>'pg_catalog.text'::regtype)))
  FROM ledger l),false),
 'reader',(SELECT pg_catalog.jsonb_build_object(
  'login',r.rolcanlogin,'inherit',r.rolinherit,'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,
  'createrole',r.rolcreaterole,'createdb',r.rolcreatedb,'replication',r.rolreplication,
  'settings',r.rolconfig IS NOT NULL OR EXISTS(SELECT 1 FROM pg_catalog.pg_db_role_setting s WHERE s.setrole=r.oid),
  'memberships',(SELECT count(*) FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid),
  'connect',pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CONNECT'),
  'db_create_or_temp',pg_catalog.has_database_privilege(r.oid,pg_catalog.current_database(),'CREATE,TEMP'),
  'iam_usage',(SELECT pg_catalog.has_schema_privilege(r.oid,s.oid,'USAGE') FROM scope s WHERE s.nspname='iam'),
  'ledger_select',(SELECT CASE WHEN l.relkind='r' THEN pg_catalog.has_table_privilege(r.oid,l.oid,'SELECT') END FROM ledger l),
  'ledger_write',(SELECT CASE WHEN l.relkind='r' THEN pg_catalog.has_table_privilege(r.oid,l.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR pg_catalog.has_any_column_privilege(r.oid,l.oid,'INSERT,UPDATE,REFERENCES') END FROM ledger l),
  'schema_create',(SELECT count(*) FROM scope s WHERE pg_catalog.has_schema_privilege(r.oid,s.oid,'CREATE')),
  'other_relation_access',(SELECT count(*) FROM pg_catalog.pg_class c JOIN scope s ON s.oid=c.relnamespace
    WHERE CASE WHEN c.relkind IN ('r','p','v','m','f') AND NOT (s.nspname='iam' AND c.relname='schema_migrations')
      THEN pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR pg_catalog.has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES') ELSE false END),
  'sequence_access',(SELECT count(*) FROM pg_catalog.pg_class c JOIN scope s ON s.oid=c.relnamespace
    WHERE CASE WHEN c.relkind='S' THEN pg_catalog.has_sequence_privilege(r.oid,c.oid,'SELECT,USAGE,UPDATE') ELSE false END),
  'projected_definer_execute',(SELECT count(*) FROM pg_catalog.pg_proc f JOIN scope s ON s.oid=f.pronamespace
    WHERE f.prosecdef AND (s.nspname='iam' OR pg_catalog.has_schema_privilege(r.oid,s.oid,'USAGE'))
    AND pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE'))
 ) FROM reader r),
 'authenticated_reader_proof',false,
 'execution_authorized',false
) AS preflight;
