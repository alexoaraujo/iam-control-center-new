-- IAM G1: one-statement, read-only canonical role/member contract (PostgreSQL 18).
-- Run separately on Development, disposable lease, and isolated restore branch.
-- DO NOT derive PASS by copying a drifted role graph from one branch to another.
-- No CREATE/ALTER/GRANT/REVOKE, secrets or data reads in this query.
WITH expected_roles(name,can_login,can_inherit) AS (
 VALUES
 ('iam_owner', false, false),
 ('iam_migrator', false, false),
 ('iam_migrator_login', true, false),
 ('iam_worker', false, true),
 ('iam_worker_login', true, false),
 ('iam_app_runtime', false, true),
 ('iam_app_runtime_login', true, true)
), role_errors AS (
 SELECT e.name,
   CASE WHEN r.oid IS NULL THEN 'MISSING'
        ELSE 'ATTRIBUTES_NOT_CANONICAL' END AS reason,
   e.can_login AS expected_login,
   e.can_inherit AS expected_inherit,
   r.rolcanlogin AS actual_login,
   r.rolinherit AS actual_inherit
 FROM expected_roles e LEFT JOIN pg_roles r ON r.rolname=e.name
 WHERE r.oid IS NULL OR
   r.rolcanlogin IS DISTINCT FROM e.can_login OR
   r.rolinherit IS DISTINCT FROM e.can_inherit OR
   r.rolbypassrls IS DISTINCT FROM false OR
   r.rolsuper IS DISTINCT FROM false OR
   r.rolcreaterole IS DISTINCT FROM false OR
   r.rolcreatedb IS DISTINCT FROM false
), expected_members(member_name,group_name,admin_allowed,inherit_allowed,set_allowed) AS (
 VALUES
 ('iam_migrator','iam_owner',false,false,true),
 ('iam_migrator_login','iam_migrator',false,false,true),
 ('iam_worker_login','iam_worker',false,true,true),
 ('iam_app_runtime_login','iam_app_runtime',false,true,false)
), actual_members AS (
 SELECT member.rolname AS member_name,
        parent.rolname AS group_name,
        m.admin_option AS admin_allowed,
        m.inherit_option AS inherit_allowed,
        m.set_option AS set_allowed
 FROM pg_auth_members m
 JOIN pg_roles member ON member.oid=m.member
 JOIN pg_roles parent ON parent.oid=m.roleid
 WHERE member.rolname LIKE 'iam_%'
), membership_errors AS (
 SELECT e.member_name,e.group_name,
    CASE WHEN a.member_name IS NULL THEN 'MISSING'
         ELSE 'OPTIONS_NOT_CANONICAL' END AS reason,
    e.admin_allowed AS expected_admin,e.inherit_allowed AS expected_inherit,
    e.set_allowed AS expected_set,
    a.admin_allowed AS actual_admin,a.inherit_allowed AS actual_inherit,
    a.set_allowed AS actual_set
 FROM expected_members e
 LEFT JOIN actual_members a
 ON a.member_name=e.member_name AND a.group_name=e.group_name
 WHERE a.member_name IS NULL OR
   a.admin_allowed IS DISTINCT FROM e.admin_allowed OR
   a.inherit_allowed IS DISTINCT FROM e.inherit_allowed OR
   a.set_allowed IS DISTINCT FROM e.set_allowed
), unexpected_members AS (
 SELECT a.member_name,a.group_name
 FROM actual_members a
 LEFT JOIN expected_members e
 ON a.member_name=e.member_name AND a.group_name=e.group_name
 WHERE e.member_name IS NULL
)
SELECT current_database() AS inspected_database,
  current_user AS inspection_identity,
  (SELECT count(*) FROM role_errors) AS role_error_count,
  (SELECT count(*) FROM membership_errors) AS membership_error_count,
  (SELECT count(*) FROM unexpected_members) AS unexpected_membership_count,
  (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.name),'[]'::jsonb)
   FROM role_errors x) AS role_findings,
  (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.member_name,x.group_name),'[]'::jsonb)
   FROM membership_errors x) AS membership_findings,
  (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.member_name,x.group_name),'[]'::jsonb)
   FROM unexpected_members x) AS unexpected_memberships,
  (SELECT jsonb_build_object(
    'role',r.rolname,'login',r.rolcanlogin,'inherit',r.rolinherit,
    'bypassrls',r.rolbypassrls)
    FROM pg_roles r WHERE r.rolname='iam_schema_export_reader') AS reader_role,
  NOT EXISTS (SELECT 1 FROM role_errors)
    AND NOT EXISTS (SELECT 1 FROM membership_errors)
    AND NOT EXISTS (SELECT 1 FROM unexpected_members) AS canonical_role_graph_pass;
