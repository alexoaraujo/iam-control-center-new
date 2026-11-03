-- Comprehensive role-contract assertions; disposable PostgreSQL 18 only.
\set ON_ERROR_STOP on
DO $role_attribute_matrix$
DECLARE item record; actual record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('iam_owner', false, false), ('iam_migrator', false, false),
    ('iam_migrator_login', true, false), ('iam_app_runtime', false, true),
    ('iam_app_runtime_login', true, true)
  ) AS expected(role_name, can_login, can_inherit)
  LOOP
    SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      INTO actual FROM pg_roles WHERE rolname = item.role_name;
    IF NOT FOUND THEN RAISE EXCEPTION 'missing required role: %', item.role_name; END IF;
    IF actual.rolcanlogin IS DISTINCT FROM item.can_login
       OR actual.rolinherit IS DISTINCT FROM item.can_inherit
       OR actual.rolsuper OR actual.rolcreatedb OR actual.rolcreaterole
       OR actual.rolreplication OR actual.rolbypassrls THEN
      RAISE EXCEPTION 'role attribute contract failed for %', item.role_name;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS local ROLE-01: complete five-role attribute matrix';
END $role_attribute_matrix$;

DO $membership_matrix$
DECLARE item record; actual record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('iam_migrator_login', 'iam_migrator', false, true, false),
    ('iam_migrator', 'iam_owner', false, true, false),
    ('iam_app_runtime_login', 'iam_app_runtime', true, false, false)
  ) AS expected(member_name, granted_name, inherit_opt, set_opt, admin_opt)
  LOOP
    SELECT m.inherit_option, m.set_option, m.admin_option INTO actual
      FROM pg_auth_members m
      JOIN pg_roles member_role ON member_role.oid=m.member
      JOIN pg_roles granted_role ON granted_role.oid=m.roleid
     WHERE member_role.rolname=item.member_name AND granted_role.rolname=item.granted_name;
    IF NOT FOUND OR actual.inherit_option IS DISTINCT FROM item.inherit_opt
       OR actual.set_option IS DISTINCT FROM item.set_opt
       OR actual.admin_option IS DISTINCT FROM item.admin_opt THEN
      RAISE EXCEPTION 'membership contract failed: % -> %', item.member_name, item.granted_name;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    WHERE member_role.rolname IN ('iam_owner','iam_migrator','iam_migrator_login','iam_app_runtime','iam_app_runtime_login')
      AND m.admin_option
  ) THEN RAISE EXCEPTION 'unexpected ADMIN TRUE membership exists'; END IF;
  RAISE NOTICE 'PASS local ROLE-02: exact INHERIT/SET/ADMIN membership matrix';
END $membership_matrix$;

DO $privilege_boundaries$
BEGIN
  IF NOT has_database_privilege('iam_owner',current_database(),'CREATE') THEN
    RAISE EXCEPTION 'iam_owner must have database CREATE';
  END IF;
  IF has_database_privilege('iam_app_runtime_login',current_database(),'CREATE') THEN
    RAISE EXCEPTION 'runtime login unexpectedly has database CREATE';
  END IF;
  IF pg_has_role('iam_migrator_login','iam_owner','USAGE') THEN
    RAISE EXCEPTION 'migrator login unexpectedly inherits owner privileges';
  END IF;
  IF NOT pg_has_role('iam_migrator_login','iam_owner','MEMBER') THEN
    RAISE EXCEPTION 'migrator login must have the transitive owner membership path';
  END IF;
  IF NOT pg_has_role('iam_app_runtime_login','iam_app_runtime','USAGE')
     OR NOT has_table_privilege('iam_app_runtime_login','runtime_fixture.read_probe','SELECT') THEN
    RAISE EXCEPTION 'runtime login must inherit the intended runtime read grant';
  END IF;
  RAISE NOTICE 'PASS local ROLE-03: database CREATE, migrator non-inheritance, runtime inheritance';
END $privilege_boundaries$;

DO $cycle_guard$
DECLARE detected_cycle boolean; visited_count integer;
BEGIN
  WITH RECURSIVE edges(src,dst) AS (
    VALUES ('role_a'::text,'role_b'::text), ('role_b'::text,'role_a'::text)
  ), walk(start_node,node,path) AS (
    SELECT src,dst,ARRAY[src,dst]::text[] FROM edges
    UNION ALL
    SELECT w.start_node,e.dst,w.path||e.dst
      FROM walk w JOIN edges e ON e.src=w.node
     WHERE NOT e.dst=ANY(w.path)
  )
  SELECT EXISTS(SELECT 1 FROM walk w JOIN edges e ON e.src=w.node WHERE e.dst=ANY(w.path)),
         (SELECT count(DISTINCT node) FROM walk)
    INTO detected_cycle,visited_count;
  IF NOT detected_cycle OR visited_count<>2 THEN
    RAISE EXCEPTION 'cycle guard failed: detected %, visited %',detected_cycle,visited_count;
  END IF;
  RAISE NOTICE 'PASS local ROLE-04: recursive traversal detects cycle and terminates';
END $cycle_guard$;

DO $runtime_membership_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    WHERE member_role.rolname='iam_app_runtime'
      AND granted_role.rolname IN ('iam_owner','iam_migrator')
  ) THEN RAISE EXCEPTION 'runtime group has prohibited owner/migrator membership'; END IF;
  RAISE NOTICE 'PASS local ROLE-05: runtime has no direct owner/migrator membership';
END $runtime_membership_guard$;

DO $admin_option_negative$
BEGIN
  EXECUTE 'CREATE ROLE iam_security_probe NOLOGIN';
  EXECUTE 'GRANT iam_security_probe TO iam_app_runtime_login WITH INHERIT FALSE, SET FALSE, ADMIN TRUE';
  IF NOT EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    JOIN pg_roles granted_role ON granted_role.oid=m.roleid
    WHERE member_role.rolname='iam_app_runtime_login'
      AND granted_role.rolname='iam_security_probe' AND m.admin_option
  ) THEN RAISE EXCEPTION 'ADMIN TRUE negative fixture was not created'; END IF;
  EXECUTE 'REVOKE iam_security_probe FROM iam_app_runtime_login';
  EXECUTE 'DROP ROLE iam_security_probe';
  RAISE NOTICE 'PASS local ROLE-06: unexpected ADMIN TRUE membership is detectable';
END $admin_option_negative$;

DO $privileged_transitive_negative$
BEGIN
  EXECUTE 'CREATE ROLE neon_superuser NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS';
  EXECUTE 'GRANT neon_superuser TO iam_app_runtime WITH INHERIT FALSE, SET FALSE, ADMIN FALSE';
  IF NOT EXISTS (
    WITH RECURSIVE role_closure(root_oid,role_oid,path) AS (
      SELECT root.oid,m.roleid,ARRAY[root.oid,m.roleid]::oid[]
        FROM pg_roles root JOIN pg_auth_members m ON m.member=root.oid
       WHERE root.rolname IN ('iam_owner','iam_migrator','iam_migrator_login','iam_app_runtime','iam_app_runtime_login')
      UNION ALL
      SELECT c.root_oid,m.roleid,c.path||m.roleid
        FROM role_closure c JOIN pg_auth_members m ON m.member=c.role_oid
       WHERE NOT m.roleid=ANY(c.path)
    )
    SELECT 1 FROM role_closure c JOIN pg_roles granted ON granted.oid=c.role_oid
     WHERE granted.rolname='neon_superuser'
  ) THEN RAISE EXCEPTION 'transitive detector missed neon_superuser'; END IF;
  EXECUTE 'REVOKE neon_superuser FROM iam_app_runtime';
  EXECUTE 'DROP ROLE neon_superuser';
  RAISE NOTICE 'PASS local ROLE-07: prohibited provider role detected transitively';
END $privileged_transitive_negative$;

DO $runtime_owner_negative$
BEGIN
  EXECUTE 'GRANT iam_owner TO iam_app_runtime WITH INHERIT FALSE, SET FALSE, ADMIN FALSE';
  IF NOT pg_has_role('iam_app_runtime','iam_owner','MEMBER') THEN
    RAISE EXCEPTION 'runtime-to-owner membership detector failed';
  END IF;
  EXECUTE 'REVOKE iam_owner FROM iam_app_runtime';
  RAISE NOTICE 'PASS local ROLE-08: unexpected runtime-to-owner path detected';
END $runtime_owner_negative$;

DO $runtime_migrator_negative$
BEGIN
  EXECUTE 'GRANT iam_migrator TO iam_app_runtime WITH INHERIT FALSE, SET FALSE, ADMIN FALSE';
  IF NOT pg_has_role('iam_app_runtime','iam_migrator','MEMBER') THEN
    RAISE EXCEPTION 'runtime-to-migrator membership detector failed';
  END IF;
  EXECUTE 'REVOKE iam_migrator FROM iam_app_runtime';
  RAISE NOTICE 'PASS local ROLE-09: unexpected runtime-to-migrator path detected';
END $runtime_migrator_negative$;
