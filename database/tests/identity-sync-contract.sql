-- Disposable PostgreSQL 18 contract. Runs only after migration 0001 in database/tests/run.sh.
-- Mirrors the identity-sync.ts INSERT / ON CONFLICT contract with synthetic identities.
-- ALL grants, policies and fixture data are rolled back. Never run against Neon.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'iam_schema_test'
     OR current_setting('server_version_num')::int < 180000 THEN
    RAISE EXCEPTION 'identity-sync contract requires disposable PostgreSQL 18 iam_schema_test';
  END IF;
  IF (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname='iam_app_runtime_login') THEN
    RAISE EXCEPTION 'test runtime role must not bypass RLS';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='iam.identities'::regclass) THEN
    RAISE EXCEPTION 'identity RLS/FORCE RLS must be active';
  END IF;
END $guard$;

-- Baseline: even an authenticated runtime identity has no INSERT capability.
SET LOCAL ROLE iam_app_runtime_login;
DO $default_deny$
BEGIN
  BEGIN
    INSERT INTO iam.identities (issuer,subject) VALUES ('https://auth-fixture.example/','auth0|blocked');
    RAISE EXCEPTION 'default-deny unexpectedly permitted identity creation';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $default_deny$;
RESET ROLE;

-- Test-only, narrowly scoped policy and grants. They do not exist in the real baseline.
GRANT USAGE ON SCHEMA iam TO iam_app_runtime_login;
GRANT SELECT, INSERT, UPDATE ON iam.identities TO iam_app_runtime_login;
CREATE POLICY identity_sync_disposable_fixture ON iam.identities
  FOR ALL TO iam_app_runtime_login
  USING (
    issuer='https://auth-fixture.example/'
    AND subject IN ('auth0|fixture-a','google-oauth2|fixture-b')
  )
  WITH CHECK (
    issuer='https://auth-fixture.example/'
    AND subject IN ('auth0|fixture-a','google-oauth2|fixture-b')
  );

SET LOCAL ROLE iam_app_runtime_login;
-- Historical import: absent authentication event must remain NULL.
INSERT INTO iam.identities
  (issuer,subject,email,email_verified,display_name,last_authenticated_at)
VALUES
  ('https://auth-fixture.example/','auth0|fixture-a','first@example.test',true,'First',NULL)
ON CONFLICT (issuer,subject)
DO UPDATE SET email=COALESCE(EXCLUDED.email,iam.identities.email),
  email_verified=EXCLUDED.email_verified,
  display_name=COALESCE(EXCLUDED.display_name,iam.identities.display_name),
  last_authenticated_at=iam.identities.last_authenticated_at;

-- Replay of incomplete import must not clear existing profile or manufacture a login.
INSERT INTO iam.identities
  (issuer,subject,email,email_verified,display_name,last_authenticated_at)
VALUES
  ('https://auth-fixture.example/','auth0|fixture-a',NULL,false,NULL,NULL)
ON CONFLICT (issuer,subject)
DO UPDATE SET email=COALESCE(EXCLUDED.email,iam.identities.email),
  email_verified=iam.identities.email_verified,
  display_name=COALESCE(EXCLUDED.display_name,iam.identities.display_name),
  last_authenticated_at=iam.identities.last_authenticated_at;

-- A second distinct subject must be persisted separately.
INSERT INTO iam.identities (issuer,subject,email,email_verified,display_name,last_authenticated_at)
VALUES ('https://auth-fixture.example/','google-oauth2|fixture-b','second@example.test',false,'Second',NULL);

DO $assert_identities$
BEGIN
  IF (SELECT count(*) FROM iam.identities WHERE issuer='https://auth-fixture.example/') <> 2 THEN
    RAISE EXCEPTION 'import replay duplicated or lost identities';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM iam.identities
     WHERE issuer='https://auth-fixture.example/' AND subject='auth0|fixture-a'
       AND email='first@example.test' AND email_verified AND display_name='First'
       AND last_authenticated_at IS NULL
  ) THEN RAISE EXCEPTION 'incomplete replay damaged profile or fabricated login'; END IF;
END $assert_identities$;

-- Explicit isolation and issuer mismatch attempts must be denied by FORCE RLS.
DO $assert_denials$
BEGIN
  BEGIN
    INSERT INTO iam.identities(issuer,subject) VALUES ('https://auth-fixture.example/','auth0|forbidden');
    RAISE EXCEPTION 'unexpected cross-subject insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO iam.identities(issuer,subject) VALUES ('https://other-issuer.example/','auth0|fixture-a');
    RAISE EXCEPTION 'unexpected cross-issuer insert';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM iam.identities WHERE subject='auth0|forbidden') THEN
    RAISE EXCEPTION 'forbidden identity visible under test RLS';
  END IF;
END $assert_denials$;
RESET ROLE;
DO $assert_no_grants$
BEGIN
  IF EXISTS (
    SELECT 1 FROM iam.memberships m JOIN iam.identities i ON i.id=m.identity_id
    WHERE i.issuer='https://auth-fixture.example/'
  ) THEN RAISE EXCEPTION 'identity synchronization granted a membership'; END IF;
END $assert_no_grants$;
ROLLBACK;
-- Post-rollback check: no fixture rows, grants or temporary policy survive.
DO $verify_cleanup$
BEGIN
  IF EXISTS (SELECT 1 FROM iam.identities WHERE issuer='https://auth-fixture.example/')
     OR EXISTS (SELECT 1 FROM pg_policies
       WHERE schemaname='iam' AND tablename='identities' AND policyname='identity_sync_disposable_fixture')
     OR has_table_privilege('iam_app_runtime_login','iam.identities','INSERT') THEN
    RAISE EXCEPTION 'disposable identity-sync fixture leaked outside rollback';
  END IF;
END $verify_cleanup$;
