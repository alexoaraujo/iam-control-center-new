-- Read-only, deterministic catalog manifest for PostgreSQL 18.
-- Run with psql -X -v ON_ERROR_STOP=1 -At -f database/scripts/schema-manifest.sql
-- Output: exactly one JSON document. No application rows or secret values are read.
WITH
app_schemas AS (
  SELECT n.oid, n.nspname, n.nspowner, n.nspacl
  FROM pg_namespace n
  WHERE n.nspname <> 'information_schema'
    AND n.nspname !~ '^pg_'
),
relations AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relowner,
         c.relrowsecurity, c.relforcerowsecurity, c.relpersistence,
         c.relreplident, c.relacl
  FROM pg_class c
  JOIN app_schemas n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S','f')
),
manifest AS (
 SELECT jsonb_build_object(
  'format', 'iam-postgresql-schema-manifest/v1',
  'database', current_database(),
  'server_version_num', current_setting('server_version_num')::integer,
  'server_version', current_setting('server_version'),
  'schemas', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', n.nspname, 'owner', pg_get_userbyid(n.nspowner)
    ) ORDER BY n.nspname), '[]'::jsonb) FROM app_schemas n
  ),
  'relations', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', r.nspname, 'name', r.relname, 'kind', r.relkind,
      'owner', pg_get_userbyid(r.relowner),
      'rls_enabled', r.relrowsecurity, 'rls_forced', r.relforcerowsecurity,
      'persistence', r.relpersistence, 'replica_identity', r.relreplident,
      'columns', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'ordinal', a.attnum, 'name', a.attname,
          'type', format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull, 'identity', a.attidentity,
          'generated', a.attgenerated,
          'default', pg_get_expr(d.adbin, d.adrelid),
          'collation', CASE WHEN a.attcollation = 0 THEN NULL
            ELSE (SELECT cn.nspname || '.' || co.collname
                  FROM pg_collation co JOIN pg_namespace cn ON cn.oid=co.collnamespace
                  WHERE co.oid=a.attcollation) END
        ) ORDER BY a.attnum), '[]'::jsonb)
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped
      ),
      'constraints', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name', con.conname, 'type', con.contype,
          'definition', pg_get_constraintdef(con.oid, true),
          'validated', con.convalidated, 'deferrable', con.condeferrable,
          'initially_deferred', con.condeferred
        ) ORDER BY con.conname), '[]'::jsonb)
        FROM pg_constraint con WHERE con.conrelid=r.oid
      ),
      'indexes', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name', ic.relname, 'definition', pg_get_indexdef(ix.indexrelid),
          'valid', ix.indisvalid, 'ready', ix.indisready
        ) ORDER BY ic.relname), '[]'::jsonb)
        FROM pg_index ix JOIN pg_class ic ON ic.oid=ix.indexrelid
        WHERE ix.indrelid=r.oid
      ),
      'view_definition', CASE WHEN r.relkind IN ('v','m')
        THEN pg_get_viewdef(r.oid, true) ELSE NULL END
    ) ORDER BY r.nspname, r.relname), '[]'::jsonb)
    FROM relations r
  ),
  'sequences', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', c.relname, 'owner', pg_get_userbyid(c.relowner),
      'data_type', format_type(s.seqtypid, NULL),
      'start', s.seqstart, 'increment', s.seqincrement,
      'min', s.seqmin, 'max', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle
    ) ORDER BY n.nspname,c.relname), '[]'::jsonb)
    FROM pg_class c JOIN app_schemas n ON n.oid=c.relnamespace
    JOIN pg_sequence s ON s.seqrelid=c.oid WHERE c.relkind='S'
  ),
  'routines', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'kind', p.prokind, 'language', l.lanname,
      'return_type', pg_get_function_result(p.oid),
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef, 'volatility', p.provolatile,
      'parallel', p.proparallel, 'configuration', p.proconfig,
      'definition', pg_get_functiondef(p.oid)
    ) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    FROM pg_proc p JOIN app_schemas n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang
  ),
  'aggregates', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', p.proname,
      'identity_arguments', pg_get_function_identity_arguments(p.oid),
      'owner', pg_get_userbyid(p.proowner), 'kind', a.aggkind,
      'transition_type', format_type(a.aggtranstype,NULL),
      'transition_function', a.aggtransfn::regprocedure::text,
      'final_function', CASE WHEN a.aggfinalfn=0 THEN NULL ELSE a.aggfinalfn::regprocedure::text END,
      'combine_function', CASE WHEN a.aggcombinefn=0 THEN NULL ELSE a.aggcombinefn::regprocedure::text END,
      'serial_function', CASE WHEN a.aggserialfn=0 THEN NULL ELSE a.aggserialfn::regprocedure::text END,
      'deserial_function', CASE WHEN a.aggdeserialfn=0 THEN NULL ELSE a.aggdeserialfn::regprocedure::text END,
      'initial_condition', a.agginitval, 'parallel', p.proparallel
    ) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)), '[]'::jsonb)
    FROM pg_aggregate a JOIN pg_proc p ON p.oid=a.aggfnoid
    JOIN app_schemas n ON n.oid=p.pronamespace
  ),
  'types', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'name', t.typname, 'kind', t.typtype,
      'owner', pg_get_userbyid(t.typowner),
      'enum_labels', CASE WHEN t.typtype='e' THEN (
        SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
        FROM pg_enum e WHERE e.enumtypid=t.oid
      ) ELSE NULL END,
      'domain_base_type', CASE WHEN t.typtype='d' THEN format_type(t.typbasetype,t.typtypmod) ELSE NULL END,
      'domain_not_null', CASE WHEN t.typtype='d' THEN t.typnotnull ELSE NULL END,
      'domain_default', CASE WHEN t.typtype='d' THEN pg_get_expr(t.typdefaultbin,0) ELSE NULL END,
      'domain_constraints', CASE WHEN t.typtype='d' THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'name', dc.conname, 'definition', pg_get_constraintdef(dc.oid,true),
          'validated', dc.convalidated
        ) ORDER BY dc.conname), '[]'::jsonb)
        FROM pg_constraint dc WHERE dc.contypid=t.oid
      ) ELSE NULL END
    ) ORDER BY n.nspname,t.typname), '[]'::jsonb)
    FROM pg_type t JOIN app_schemas n ON n.oid=t.typnamespace
    WHERE t.typtype IN ('e','d')
  ),
  'triggers', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', n.nspname, 'table', c.relname, 'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid,true),
      'enabled', t.tgenabled
    ) ORDER BY n.nspname,c.relname,t.tgname), '[]'::jsonb)
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN app_schemas n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal
  ),
  'policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
      'command', p.cmd, 'permissive', p.permissive,
      'roles', p.roles, 'using', p.qual, 'with_check', p.with_check
    ) ORDER BY p.schemaname,p.tablename,p.policyname), '[]'::jsonb)
    FROM pg_policies p JOIN app_schemas n ON n.nspname=p.schemaname
  ),
  'extensions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', e.extname, 'version', e.extversion,
      'schema', n.nspname, 'owner', pg_get_userbyid(e.extowner)
    ) ORDER BY e.extname), '[]'::jsonb)
    FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
  ),
  'expanded_object_acls', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'object_type', a.object_type, 'schema', a.schema_name,
      'object_name', a.object_name, 'grantee', a.grantee,
      'privilege', a.privilege_type, 'grantable', a.is_grantable,
      'grantor', a.grantor
    ) ORDER BY a.object_type,a.schema_name,a.object_name,a.grantee,a.privilege_type), '[]'::jsonb)
    FROM (
      SELECT 'schema'::text AS object_type, n.nspname AS schema_name,
        n.nspname AS object_name,
        CASE x.grantee WHEN 0 THEN 'PUBLIC'::name ELSE pg_get_userbyid(x.grantee)::name END AS grantee,
        x.privilege_type, x.is_grantable, pg_get_userbyid(x.grantor)::name AS grantor
      FROM app_schemas n CROSS JOIN LATERAL
        aclexplode(COALESCE(n.nspacl, acldefault('n',n.nspowner))) x
      UNION ALL
      SELECT CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'relation' END,
        n.nspname,c.relname,
        CASE x.grantee WHEN 0 THEN 'PUBLIC'::name ELSE pg_get_userbyid(x.grantee)::name END,
        x.privilege_type,x.is_grantable,pg_get_userbyid(x.grantor)::name
      FROM relations c JOIN app_schemas n ON n.nspname=c.nspname
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault(
        CASE WHEN c.relkind='S' THEN 's'::"char" ELSE 'r'::"char" END,c.relowner))) x
      UNION ALL
      SELECT 'routine',n.nspname,p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        CASE x.grantee WHEN 0 THEN 'PUBLIC'::name ELSE pg_get_userbyid(x.grantee)::name END,
        x.privilege_type,x.is_grantable,pg_get_userbyid(x.grantor)::name
      FROM pg_proc p JOIN app_schemas n ON n.oid=p.pronamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x
    ) a
  ),
  'default_acls', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'schema', CASE WHEN d.defaclnamespace=0 THEN NULL ELSE n.nspname END,
      'owner', pg_get_userbyid(d.defaclrole), 'object_type', d.defaclobjtype,
      'grantee', CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
      'privilege', x.privilege_type, 'grantable', x.is_grantable,
      'grantor', pg_get_userbyid(x.grantor)
    ) ORDER BY d.defaclrole,d.defaclnamespace,d.defaclobjtype,x.grantee,x.privilege_type), '[]'::jsonb)
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) x
  ),
  'database_acl', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'database', d.datname,
      'owner', pg_get_userbyid(d.datdba),
      'grantee', CASE x.grantee WHEN 0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END,
      'privilege', x.privilege_type, 'grantable', x.is_grantable,
      'grantor', pg_get_userbyid(x.grantor)
    ) ORDER BY x.grantee,x.privilege_type), '[]'::jsonb)
    FROM pg_database d CROSS JOIN LATERAL
      aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) x
    WHERE d.datname=current_database()
  ),
  'roles', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', r.rolname, 'superuser', r.rolsuper, 'inherit', r.rolinherit,
      'create_role', r.rolcreaterole, 'create_database', r.rolcreatedb,
      'login', r.rolcanlogin, 'replication', r.rolreplication,
      'bypass_rls', r.rolbypassrls, 'connection_limit', r.rolconnlimit
    ) ORDER BY r.rolname), '[]'::jsonb)
    FROM pg_roles r
  ),
  'role_memberships', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'role', pg_get_userbyid(m.roleid), 'member', pg_get_userbyid(m.member),
      'grantor', pg_get_userbyid(m.grantor), 'admin_option', m.admin_option,
      'inherit_option', m.inherit_option, 'set_option', m.set_option
    ) ORDER BY m.roleid,m.member), '[]'::jsonb)
    FROM pg_auth_members m
  )
 ) AS document
)
SELECT document::text FROM manifest;
