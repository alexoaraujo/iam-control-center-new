\set ON_ERROR_STOP on
\set VERBOSITY verbose
-- Isolated CI service only. No reusable administrator endpoint or real IAM objects.
BEGIN;
SET LOCAL search_path = pg_catalog, pg_temp;
SET LOCAL statement_timeout = '20s';
DO $guard$
BEGIN
  IF current_database() <> 'iam_schema_test' OR session_user <> 'postgres'
     OR current_user <> session_user
     OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
     OR inet_server_addr() IS NULL
     OR NOT (inet_server_addr() <<= inet '127.0.0.0/8'
             OR inet_server_addr() <<= inet '172.16.0.0/12'
             OR inet_server_addr() = inet '::1')
     OR nullif(current_setting('neon.branch_id',true),'') IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database() AND datdba='postgres'::regrole)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('iam','audit','app_private','iam_reconcile_fixture','iam_runner_fixture','iam_runner_guard'))
     OR EXISTS (SELECT 1 FROM pg_roles WHERE rolname LIKE 'iam\_%' ESCAPE '\')
  THEN RAISE EXCEPTION 'PEOS_RECONCILE_WRONG_FIXTURE'; END IF;
  IF NOT pg_try_advisory_xact_lock(187355,17318) THEN
    RAISE EXCEPTION 'PEOS_RECONCILE_LOCK_BUSY';
  END IF;
END
$guard$;

-- This contract is identical to the seven-role graph in
-- database/scripts/iam-g1-role-parity-readonly.sql. It does not authorize
-- applying this fixture policy to provider-managed Neon principals.
CREATE TEMP TABLE expected_roles(name text PRIMARY KEY, can_login boolean, can_inherit boolean);
INSERT INTO expected_roles VALUES
 ('iam_owner',false,false), ('iam_migrator',false,false),
 ('iam_migrator_login',true,false), ('iam_worker',false,true),
 ('iam_worker_login',true,false), ('iam_app_runtime',false,true),
 ('iam_app_runtime_login',true,true);
CREATE TEMP TABLE expected_edges(member_name text, group_name text, inherit_allowed boolean, set_allowed boolean, PRIMARY KEY(member_name,group_name));
INSERT INTO expected_edges VALUES
 ('iam_migrator','iam_owner',false,true),
 ('iam_migrator_login','iam_migrator',false,true),
 ('iam_worker_login','iam_worker',true,true),
 ('iam_app_runtime_login','iam_app_runtime',true,false);
CREATE TEMP TABLE expected_db_acl(role_name text, privilege text, PRIMARY KEY(role_name,privilege));
INSERT INTO expected_db_acl VALUES
 ('iam_owner','CREATE'), ('iam_migrator_login','CONNECT'),
 ('iam_worker_login','CONNECT'), ('iam_app_runtime_login','CONNECT');

-- Existing incompatible attributes, edges, ACLs or ownership are not rewritten:
-- they are explicit review blockers. Only absent, allowlisted state is added.
CREATE FUNCTION pg_temp.reconcile_fixture() RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO pg_catalog, pg_temp AS $fn$
DECLARE
  e record; created_roles int:=0; created_edges int:=0; granted_db int:=0;
  public_removed int:=0; created_objects int:=0; object_grants int:=0;
  n oid; rel oid;
BEGIN
  IF current_database()<>'iam_schema_test' OR session_user<>'postgres' OR current_user<>'postgres'
     OR nullif(current_setting('neon.branch_id',true),'') IS NOT NULL
     OR NOT pg_try_advisory_xact_lock(187355,17318)
  THEN RAISE EXCEPTION 'PEOS_RECONCILE_WRONG_CONTEXT'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_temp.expected_roles e JOIN pg_roles r ON r.rolname=e.name
    WHERE r.rolcanlogin<>e.can_login OR r.rolinherit<>e.can_inherit OR r.rolsuper
       OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR r.rolbypassrls
       OR r.rolconfig IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
    JOIN pg_temp.expected_roles e ON e.name=r.rolname
  ) THEN RAISE EXCEPTION 'PEOS_ROLE_DRIFT'; END IF;
  -- In this local fixture even inbound unreviewed edges are rejected. Real
  -- provider-maintained grantor/admin edges require a separate contract.
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.member
    JOIN pg_roles b ON b.oid=m.roleid
    LEFT JOIN pg_temp.expected_edges e ON e.member_name=a.rolname AND e.group_name=b.rolname
    WHERE (a.rolname IN (SELECT name FROM pg_temp.expected_roles)
       OR b.rolname IN (SELECT name FROM pg_temp.expected_roles))
      AND (e.member_name IS NULL OR m.admin_option OR m.inherit_option<>e.inherit_allowed
        OR m.set_option<>e.set_allowed OR m.grantor<>'postgres'::regrole)
  ) THEN RAISE EXCEPTION 'PEOS_MEMBERSHIP_DRIFT'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database d
    CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) x
    LEFT JOIN pg_roles r ON r.oid=x.grantee
    LEFT JOIN pg_temp.expected_db_acl e ON e.role_name=r.rolname AND e.privilege=x.privilege_type
    WHERE d.datname=current_database() AND x.grantee<>d.datdba
      AND NOT (x.grantee=0 AND x.privilege_type IN ('CONNECT','TEMPORARY') AND NOT x.is_grantable AND x.grantor=d.datdba)
      AND (e.role_name IS NULL OR x.is_grantable OR x.grantor<>d.datdba)
  ) THEN RAISE EXCEPTION 'PEOS_DATABASE_ACL_DRIFT'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_default_acl d JOIN pg_roles r ON r.oid=d.defaclrole
    WHERE r.rolname IN (SELECT name FROM pg_temp.expected_roles)
  ) THEN RAISE EXCEPTION 'PEOS_DEFAULT_ACL_DRIFT'; END IF;

  FOR e IN SELECT * FROM pg_temp.expected_roles ORDER BY name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=e.name) THEN
      EXECUTE format('CREATE ROLE %I %s %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
        e.name, CASE WHEN e.can_login THEN 'LOGIN' ELSE 'NOLOGIN' END,
        CASE WHEN e.can_inherit THEN 'INHERIT' ELSE 'NOINHERIT' END);
      created_roles:=created_roles+1;
    END IF;
  END LOOP;
  FOR e IN SELECT * FROM pg_temp.expected_edges ORDER BY member_name LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.member
      JOIN pg_roles b ON b.oid=m.roleid WHERE a.rolname=e.member_name AND b.rolname=e.group_name
    ) THEN
      EXECUTE format('GRANT %I TO %I WITH INHERIT %s, SET %s, ADMIN FALSE',
        e.group_name,e.member_name, CASE WHEN e.inherit_allowed THEN 'TRUE' ELSE 'FALSE' END,
        CASE WHEN e.set_allowed THEN 'TRUE' ELSE 'FALSE' END);
      created_edges:=created_edges+1;
    END IF;
  END LOOP;
  -- Only the default PUBLIC CONNECT/TEMP grants of this disposable database
  -- are an explicitly approved removal. No broad REVOKE on real schemas.
  IF EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL
     aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) x
     WHERE d.datname=current_database() AND x.grantee=0) THEN
    EXECUTE format('REVOKE CONNECT, TEMP ON DATABASE %I FROM PUBLIC',current_database());
    public_removed:=1;
  END IF;
  FOR e IN SELECT * FROM pg_temp.expected_db_acl ORDER BY role_name LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL
      aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) x
      JOIN pg_roles r ON r.oid=x.grantee
      WHERE d.datname=current_database() AND r.rolname=e.role_name AND x.privilege_type=e.privilege) THEN
      EXECUTE format('GRANT %s ON DATABASE %I TO %I',e.privilege,current_database(),e.role_name);
      granted_db:=granted_db+1;
    END IF;
  END LOOP;
  IF pg_has_role('iam_app_runtime_login','iam_owner','MEMBER')
     OR pg_has_role('iam_app_runtime_login','iam_migrator','MEMBER')
     OR pg_has_role('iam_migrator_login','iam_owner','USAGE')
     OR NOT pg_has_role('iam_migrator_login','iam_owner','SET')
     OR pg_has_role('iam_app_runtime_login','iam_app_runtime','SET')
     OR EXISTS (SELECT 1 FROM pg_temp.expected_roles e WHERE has_database_privilege(e.name,current_database(),'TEMP'))
     OR EXISTS (SELECT 1 FROM pg_temp.expected_roles e WHERE e.name<>'iam_owner'
       AND has_database_privilege(e.name,current_database(),'CREATE'))
  THEN RAISE EXCEPTION 'PEOS_EFFECTIVE_ROLE_DRIFT'; END IF;

  IF to_regnamespace('iam_reconcile_fixture') IS NULL THEN
    CREATE SCHEMA iam_reconcile_fixture AUTHORIZATION iam_owner;
    created_objects:=created_objects+1;
  END IF;
  n:=to_regnamespace('iam_reconcile_fixture');
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE oid=n AND nspowner='iam_owner'::regrole)
    OR EXISTS (SELECT 1 FROM pg_namespace s CROSS JOIN LATERAL
       aclexplode(coalesce(s.nspacl,acldefault('n',s.nspowner))) a
       WHERE s.oid=n AND a.grantee<>s.nspowner
         AND (a.grantee<>'iam_app_runtime'::regrole OR a.privilege_type<>'USAGE'
              OR a.is_grantable OR a.grantor<>s.nspowner))
  THEN RAISE EXCEPTION 'PEOS_SCHEMA_OWNER_OR_ACL_DRIFT'; END IF;
  IF NOT has_schema_privilege('iam_app_runtime','iam_reconcile_fixture','USAGE') THEN
    -- Explicit grantor is the object owner; PostgreSQL superuser acts on its behalf.
    GRANT USAGE ON SCHEMA iam_reconcile_fixture TO iam_app_runtime;
    object_grants:=object_grants+1;
  END IF;
  IF to_regclass('iam_reconcile_fixture.protected_items') IS NULL THEN
    CREATE TABLE iam_reconcile_fixture.protected_items(id integer PRIMARY KEY);
    ALTER TABLE iam_reconcile_fixture.protected_items OWNER TO iam_owner;
    ALTER TABLE iam_reconcile_fixture.protected_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE iam_reconcile_fixture.protected_items FORCE ROW LEVEL SECURITY;
    created_objects:=created_objects+1;
  END IF;
  rel:=to_regclass('iam_reconcile_fixture.protected_items');
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid=rel AND c.relkind='r'
      AND c.relowner='iam_owner'::regrole AND c.relrowsecurity AND c.relforcerowsecurity)
    OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid=rel)
    OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL
      aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      WHERE c.oid=rel AND a.grantee<>c.relowner
        AND (a.grantee<>'iam_app_runtime'::regrole OR a.privilege_type<>'SELECT'
             OR a.is_grantable OR a.grantor<>c.relowner))
    OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=rel AND attacl IS NOT NULL)
  THEN RAISE EXCEPTION 'PEOS_TABLE_OWNER_ACL_OR_RLS_DRIFT'; END IF;
  IF NOT has_table_privilege('iam_app_runtime','iam_reconcile_fixture.protected_items','SELECT') THEN
    GRANT SELECT ON iam_reconcile_fixture.protected_items TO iam_app_runtime;
    object_grants:=object_grants+1;
  END IF;
  IF NOT has_schema_privilege('iam_app_runtime_login','iam_reconcile_fixture','USAGE')
     OR has_schema_privilege('iam_app_runtime_login','iam_reconcile_fixture','CREATE')
     OR NOT has_table_privilege('iam_app_runtime_login','iam_reconcile_fixture.protected_items','SELECT')
     OR has_table_privilege('iam_app_runtime_login','iam_reconcile_fixture.protected_items',
                            'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
  THEN RAISE EXCEPTION 'PEOS_RUNTIME_PRIVILEGE_DRIFT'; END IF;
  RETURN jsonb_build_object('roles',created_roles,'memberships',created_edges,'database_grants',granted_db,
       'public_removed',public_removed,'objects',created_objects,'object_grants',object_grants);
END
$fn$;

CREATE FUNCTION pg_temp.expect_block(expected text) RETURNS void LANGUAGE plpgsql
SET search_path TO pg_catalog, pg_temp AS $fn$
BEGIN
  BEGIN
    PERFORM pg_temp.reconcile_fixture();
    RAISE EXCEPTION 'PEOS_UNEXPECTED_SUCCESS';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>expected THEN RAISE; END IF;
  END;
END
$fn$;

-- Production-like partial graph, not a copy of the real database.
SAVEPOINT empty_fixture;
CREATE ROLE iam_app_runtime_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
DO $test$
DECLARE a jsonb; b jsonb; old_oid oid:='iam_app_runtime_login'::regrole;
BEGIN
  a:=pg_temp.reconcile_fixture();
  IF a<> '{"roles":6,"memberships":4,"database_grants":4,"public_removed":1,"objects":2,"object_grants":2}'::jsonb
     OR old_oid<>'iam_app_runtime_login'::regrole THEN RAISE EXCEPTION 'PEOS_PRODUCTION_FIXTURE_COUNT'; END IF;
  b:=pg_temp.reconcile_fixture();
  IF b<> '{"roles":0,"memberships":0,"database_grants":0,"public_removed":0,"objects":0,"object_grants":0}'::jsonb
  THEN RAISE EXCEPTION 'PEOS_NOT_IDEMPOTENT'; END IF;
END
$test$;
ROLLBACK TO empty_fixture;
DO $test$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN (SELECT name FROM pg_temp.expected_roles))
    OR to_regnamespace('iam_reconcile_fixture') IS NOT NULL
 THEN RAISE EXCEPTION 'PEOS_ROLLBACK_RESIDUE'; END IF;
END $test$;

-- Development-like graph: five roles, one edge; no passwords imported.
CREATE ROLE iam_owner NOLOGIN NOINHERIT;
CREATE ROLE iam_migrator NOLOGIN NOINHERIT;
CREATE ROLE iam_worker NOLOGIN INHERIT;
CREATE ROLE iam_app_runtime NOLOGIN INHERIT;
CREATE ROLE iam_app_runtime_login LOGIN INHERIT;
GRANT iam_app_runtime TO iam_app_runtime_login WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
SAVEPOINT partial_fixture;
-- Fail after successful reconciliation; prove roles, edges, objects and DB ACL revert.
DO $test$
DECLARE before_acl aclitem[]; old_oid oid:='iam_owner'::regrole; a jsonb;
BEGIN
  SELECT datacl INTO before_acl FROM pg_database WHERE datname=current_database();
  BEGIN
    a:=pg_temp.reconcile_fixture();
    IF a->>'roles'<>'2' OR a->>'memberships'<>'3' THEN RAISE EXCEPTION 'PEOS_DEVELOPMENT_FIXTURE_COUNT'; END IF;
    RAISE EXCEPTION 'PEOS_INTENTIONAL_RECONCILE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'PEOS_INTENTIONAL_RECONCILE_ROLLBACK' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('iam_migrator_login','iam_worker_login'))
     OR to_regnamespace('iam_reconcile_fixture') IS NOT NULL
     OR (SELECT datacl FROM pg_database WHERE datname=current_database()) IS DISTINCT FROM before_acl
     OR old_oid<>'iam_owner'::regrole
     OR (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member
         WHERE r.rolname IN (SELECT name FROM pg_temp.expected_roles))<>1
  THEN RAISE EXCEPTION 'PEOS_ROLLBACK_RESIDUE'; END IF;
END $test$;

ALTER ROLE iam_worker BYPASSRLS;
SELECT pg_temp.expect_block('PEOS_ROLE_DRIFT');
ROLLBACK TO partial_fixture;
GRANT iam_owner TO iam_app_runtime_login WITH INHERIT TRUE, SET TRUE, ADMIN FALSE;
SELECT pg_temp.expect_block('PEOS_MEMBERSHIP_DRIFT');
ROLLBACK TO partial_fixture;
GRANT iam_app_runtime TO iam_app_runtime_login WITH INHERIT TRUE, SET FALSE, ADMIN TRUE;
SELECT pg_temp.expect_block('PEOS_MEMBERSHIP_DRIFT');
ROLLBACK TO partial_fixture;
GRANT CREATE ON DATABASE iam_schema_test TO iam_app_runtime_login;
SELECT pg_temp.expect_block('PEOS_DATABASE_ACL_DRIFT');
ROLLBACK TO partial_fixture;
ALTER DEFAULT PRIVILEGES FOR ROLE iam_owner GRANT SELECT ON TABLES TO PUBLIC;
SELECT pg_temp.expect_block('PEOS_DEFAULT_ACL_DRIFT');
ROLLBACK TO partial_fixture;

DO $test$
DECLARE a jsonb;
BEGIN
  a:=pg_temp.reconcile_fixture();
  IF a->>'roles'<>'2' OR a->>'memberships'<>'3' THEN RAISE EXCEPTION 'PEOS_DEVELOPMENT_FIXTURE_COUNT'; END IF;
  IF EXISTS (SELECT 1 FROM pg_authid WHERE rolname IN (SELECT name FROM pg_temp.expected_roles) AND rolpassword IS NOT NULL)
  THEN RAISE EXCEPTION 'PEOS_UNEXPECTED_PASSWORD'; END IF;
END $test$;
SAVEPOINT canonical_fixture;
ALTER TABLE iam_reconcile_fixture.protected_items OWNER TO postgres;
SELECT pg_temp.expect_block('PEOS_TABLE_OWNER_ACL_OR_RLS_DRIFT');
ROLLBACK TO canonical_fixture;
GRANT INSERT ON iam_reconcile_fixture.protected_items TO iam_app_runtime;
SELECT pg_temp.expect_block('PEOS_TABLE_OWNER_ACL_OR_RLS_DRIFT');
ROLLBACK TO canonical_fixture;
ALTER TABLE iam_reconcile_fixture.protected_items NO FORCE ROW LEVEL SECURITY;
SELECT pg_temp.expect_block('PEOS_TABLE_OWNER_ACL_OR_RLS_DRIFT');
ROLLBACK TO canonical_fixture;
GRANT USAGE ON SCHEMA iam_reconcile_fixture TO PUBLIC;
SELECT pg_temp.expect_block('PEOS_SCHEMA_OWNER_OR_ACL_DRIFT');
ROLLBACK TO canonical_fixture;
ALTER SCHEMA iam_reconcile_fixture OWNER TO postgres;
SELECT pg_temp.expect_block('PEOS_SCHEMA_OWNER_OR_ACL_DRIFT');
ROLLBACK TO canonical_fixture;
DO $test$
BEGIN
  IF pg_temp.reconcile_fixture()<> '{"roles":0,"memberships":0,"database_grants":0,"public_removed":0,"objects":0,"object_grants":0}'::jsonb
  THEN RAISE EXCEPTION 'PEOS_NOT_IDEMPOTENT'; END IF;
END $test$;
INSERT INTO iam_reconcile_fixture.protected_items VALUES (1);
SET LOCAL ROLE iam_app_runtime_login;
DO $test$ BEGIN
  IF EXISTS (SELECT 1 FROM iam_reconcile_fixture.protected_items) THEN RAISE EXCEPTION 'PEOS_RLS_LEAK'; END IF;
END $test$;
RESET ROLE;
-- Final committed fixture is intentionally used by the already-reviewed
-- authenticated migration-runner test. Only that ephemeral service persists.
COMMIT;
SELECT 'PASS_ROLE_RECONCILIATION_FIXTURE';
