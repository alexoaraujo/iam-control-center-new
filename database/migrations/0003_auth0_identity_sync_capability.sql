-- PR #42: narrowly scoped Auth0 identity upsert capability.
-- This is a REVIEW PROPOSAL: execute only on disposable PostgreSQL 18 / Neon
-- validation branch. Not approved for Development or Production.
-- Runtime retains NO direct INSERT / UPDATE on iam.identities.
BEGIN;
DO $preflight$
DECLARE
  v_rls boolean;
  v_force boolean;
BEGIN
  IF current_user <> 'iam_owner' THEN
    RAISE EXCEPTION '0003 requires effective iam_owner (got %)', current_user;
  END IF;
  IF current_setting('server_version_num')::integer < 180000 THEN
    RAISE EXCEPTION '0003 requires PostgreSQL 18';
  END IF;
  SELECT relrowsecurity, relforcerowsecurity INTO v_rls, v_force
    FROM pg_class WHERE oid = to_regclass('iam.identities');
  IF NOT FOUND OR NOT v_rls OR NOT v_force THEN
    RAISE EXCEPTION 'iam.identities must have FORCE RLS';
  END IF;
  IF to_regprocedure('iam.sync_auth0_identity(text,text,text,boolean,text,boolean,boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'sync_auth0_identity already exists; review lineage before altering';
  END IF;
  IF (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='iam_app_runtime_login') IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'IAM runtime LOGIN must exist and have NOBYPASSRLS/NOSUPERUSER';
  END IF;
  IF has_table_privilege('iam_app_runtime_login','iam.identities','INSERT')
     OR has_table_privilege('iam_app_runtime_login','iam.identities','UPDATE') THEN
    RAISE EXCEPTION 'runtime may not have direct identity INSERT or UPDATE';
  END IF;
END $preflight$;

-- Only the verified Auth0 application server may invoke this with claims from
-- an Auth0 SDK session, never values from an HTTP request body. The DB capability
-- is deliberately narrower than table write access.
CREATE FUNCTION iam.sync_auth0_identity(
  p_issuer text, p_subject text, p_email text, p_email_verified boolean,
  p_display_name text, p_is_login boolean, p_verified_present boolean
)
RETURNS TABLE (id uuid, issuer text, subject text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog
AS $function$
BEGIN
  -- Fail closed on a different Auth0 tenant; do not accept wildcard issuers.
  IF p_issuer IS DISTINCT FROM 'https://iam-control-center.us.auth0.com/' THEN
    RAISE EXCEPTION 'Unapproved Auth0 issuer' USING ERRCODE='23514';
  END IF;
  IF p_subject IS NULL OR length(p_subject) NOT BETWEEN 1 AND 255
     OR btrim(p_subject) = '' THEN
    RAISE EXCEPTION 'Invalid Auth0 subject' USING ERRCODE='23514';
  END IF;
  IF p_email IS NOT NULL AND length(p_email) > 320 THEN
    RAISE EXCEPTION 'Invalid Auth0 email length' USING ERRCODE='23514';
  END IF;
  IF p_display_name IS NOT NULL AND length(p_display_name) > 255 THEN
    RAISE EXCEPTION 'Invalid Auth0 display-name length' USING ERRCODE='23514';
  END IF;
  IF p_is_login IS NULL OR p_verified_present IS NULL THEN
    RAISE EXCEPTION 'Missing sync provenance' USING ERRCODE='23514';
  END IF;

  RETURN QUERY
  INSERT INTO iam.identities AS dest
    (issuer,subject,email,email_verified,display_name,last_authenticated_at)
  VALUES
    (p_issuer,p_subject,p_email,COALESCE(p_email_verified,FALSE),p_display_name,
     CASE WHEN p_is_login THEN clock_timestamp() ELSE NULL END)
  ON CONFLICT (issuer,subject)
  DO UPDATE SET
    email = COALESCE(EXCLUDED.email,dest.email),
    email_verified = CASE WHEN p_verified_present
      THEN EXCLUDED.email_verified ELSE dest.email_verified END,
    display_name = COALESCE(EXCLUDED.display_name,dest.display_name),
    last_authenticated_at = CASE WHEN p_is_login
      THEN clock_timestamp() ELSE dest.last_authenticated_at END
  RETURNING dest.id,dest.issuer,dest.subject;
END
$function$;

REVOKE ALL ON FUNCTION iam.sync_auth0_identity(text,text,text,boolean,text,boolean,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iam.sync_auth0_identity(text,text,text,boolean,text,boolean,boolean) TO iam_app_runtime;

-- This function never writes memberships, roles, invitations or other IAM grants.
-- Owner policy on identities must be audited separately before Production approval.
COMMIT;
