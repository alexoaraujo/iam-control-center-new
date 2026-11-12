-- Read-only, reviewer-oriented SECURITY DEFINER access preflight.
-- Run only against the explicitly verified origin/NEW/clone iam_database branch.
-- Does not execute routines, query user records, modify ACLs or expose routine bodies.
WITH functions AS (
 SELECT n.nspname AS schema_name,p.proname AS routine_name,
        pg_get_function_identity_arguments(p.oid) AS identity_arguments,
        pg_get_userbyid(p.proowner) AS routine_owner,
        COALESCE((SELECT bool_or(x.privilege_type='EXECUTE')
                  FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) x
                  WHERE x.grantee=0),false) AS public_execute,
        COALESCE((SELECT bool_or(x.privilege_type='USAGE')
                  FROM aclexplode(COALESCE(n.nspacl,acldefault('n',n.nspowner))) x
                  WHERE x.grantee=0),false) AS public_schema_usage,
        has_function_privilege('iam_app_runtime_login',p.oid,'EXECUTE') AS runtime_execute,
        EXISTS (SELECT 1 FROM unnest(COALESCE(p.proconfig,ARRAY[]::text[])) cfg
                WHERE cfg ~* '^search_path\s*=' AND cfg ~* '(^|[, =])public([, ]|$)') AS search_path_includes_public
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('iam','audit','app_private') AND p.prosecdef
)
SELECT jsonb_build_object(
 'security_definer_count',count(*),
 'public_executable_count',count(*) FILTER(WHERE public_execute),
 'public_executable_and_schema_usage_count',count(*) FILTER(WHERE public_execute AND public_schema_usage),
 'public_in_search_path_count',count(*) FILTER(WHERE search_path_includes_public),
 'verdict', CASE
   WHEN count(*)=0 THEN 'BLOCKED_NO_SECURITY_DEFINER_ROUTINES'
   WHEN count(*) FILTER(WHERE public_execute AND public_schema_usage)>0 THEN 'BLOCKED_PUBLIC_REACHABLE_SECURITY_DEFINER'
   WHEN count(*) FILTER(WHERE search_path_includes_public)>0 THEN 'REVIEW_SECURITY_DEFINER_SEARCH_PATH'
   WHEN count(*) FILTER(WHERE public_execute)>0 THEN 'REVIEW_PUBLIC_EXECUTE_WITHOUT_SCHEMA_USAGE'
   ELSE 'METADATA_ONLY_NO_PUBLIC_REACHABLE_ROUTINES' END,
 'routines',jsonb_agg(jsonb_build_object(
    'schema',schema_name,'name',routine_name,'arguments',identity_arguments,
    'owner',routine_owner,'public_execute',public_execute,
    'public_schema_usage',public_schema_usage,'runtime_execute',runtime_execute,
    'search_path_includes_public',search_path_includes_public
 ) ORDER BY schema_name,routine_name)
) AS security_definer_preflight FROM functions;
