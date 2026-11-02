\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  IF current_database() = 'postgres' THEN
    RAISE EXCEPTION 'Refusing to install fixture in default postgres database';
  END IF;
END $$;

CREATE ROLE iam_ctx_owner NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE iam_ctx_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;

CREATE SCHEMA iam_ctx AUTHORIZATION iam_ctx_owner;
CREATE SCHEMA iam_ctx_private AUTHORIZATION iam_ctx_owner;

SET ROLE iam_ctx_owner;

CREATE TABLE iam_ctx.tenants (
  tenant_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active','suspended'))
);

CREATE TABLE iam_ctx.memberships (
  membership_id text PRIMARY KEY,
  identity_id text NOT NULL,
  tenant_id text NOT NULL REFERENCES iam_ctx.tenants(tenant_id),
  status text NOT NULL CHECK (status IN ('active','revoked')),
  can_write boolean NOT NULL DEFAULT false
);

-- Fixture-only opaque token registry. This is NOT a crypto implementation.
CREATE TABLE iam_ctx_private.context_fixture (
  token text PRIMARY KEY,
  identity_id text NOT NULL,
  tenant_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  enabled boolean NOT NULL DEFAULT true
);

INSERT INTO iam_ctx.tenants VALUES
  ('tenant-a','active'), ('tenant-b','active'), ('tenant-suspended','suspended');

INSERT INTO iam_ctx.memberships VALUES
  ('m-a','identity-a','tenant-a','active',true),
  ('m-b','identity-b','tenant-b','active',true),
  ('m-suspended','identity-a','tenant-suspended','active',true);

INSERT INTO iam_ctx_private.context_fixture VALUES
  ('fixture-token-a','identity-a','tenant-a',now() + interval '5 minutes',true),
  ('fixture-token-expired','identity-a','tenant-a',now() - interval '1 minute',true),
  ('fixture-token-disabled','identity-a','tenant-a',now() + interval '5 minutes',false),
  ('fixture-token-no-membership','identity-c','tenant-c',now() + interval '5 minutes',true);

CREATE FUNCTION iam_ctx_private.current_tenant_id()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT f.tenant_id
  FROM iam_ctx_private.context_fixture f
  JOIN iam_ctx.memberships m
    ON m.identity_id = f.identity_id
   AND m.tenant_id = f.tenant_id
   AND m.status = 'active'
  JOIN iam_ctx.tenants t
    ON t.tenant_id = f.tenant_id
   AND t.status = 'active'
  WHERE f.token = current_setting('app.context_token', true)
    AND f.enabled
    AND f.expires_at > statement_timestamp()
  LIMIT 1
$fn$;

CREATE FUNCTION iam_ctx_private.current_identity_id()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT f.identity_id
  FROM iam_ctx_private.context_fixture f
  WHERE f.token = current_setting('app.context_token', true)
    AND f.enabled
    AND f.expires_at > statement_timestamp()
    AND iam_ctx_private.current_tenant_id() IS NOT NULL
  LIMIT 1
$fn$;

CREATE FUNCTION iam_ctx_private.context_is_valid()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
  SELECT iam_ctx_private.current_tenant_id() IS NOT NULL
$fn$;

CREATE FUNCTION iam_ctx_private.guarded_write(p_tenant text, p_membership text, p_value text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM iam_ctx_private.context_fixture f
    JOIN iam_ctx.memberships m
      ON m.identity_id = f.identity_id
     AND m.tenant_id = f.tenant_id
     AND m.membership_id = p_membership
     AND m.status = 'active'
     AND m.can_write
    JOIN iam_ctx.tenants t
      ON t.tenant_id = m.tenant_id
     AND t.status = 'active'
    WHERE f.token = current_setting('app.context_token', true)
      AND f.enabled
      AND f.expires_at > statement_timestamp()
      AND f.tenant_id = p_tenant
  ) THEN
    RAISE EXCEPTION 'authorization_denied' USING ERRCODE = '42501';
  END IF;
  INSERT INTO iam_ctx_private.write_log(tenant_id, value)
  VALUES (p_tenant, p_value);
  RETURN true;
END
$fn$;

CREATE TABLE iam_ctx_private.write_log (
  write_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  value text NOT NULL
);

CREATE TABLE iam_ctx.identities (
  identity_id text PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  display_name text
);

INSERT INTO iam_ctx.identities VALUES
 ('identity-a','https://issuer.example/','subject-a','A'),
 ('identity-b','https://issuer.example/','subject-b','B');

ALTER TABLE iam_ctx.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam_ctx.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam_ctx.identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_scope ON iam_ctx.tenants
  USING (tenant_id = iam_ctx_private.current_tenant_id());

CREATE POLICY membership_scope ON iam_ctx.memberships
  USING (tenant_id = iam_ctx_private.current_tenant_id());

CREATE POLICY identity_scope ON iam_ctx.identities
  USING (identity_id = iam_ctx_private.current_identity_id());

RESET ROLE;

GRANT USAGE ON SCHEMA iam_ctx, iam_ctx_private TO iam_ctx_runtime;
GRANT SELECT ON iam_ctx.tenants, iam_ctx.memberships, iam_ctx.identities TO iam_ctx_runtime;
GRANT UPDATE (display_name) ON iam_ctx.identities TO iam_ctx_runtime;
GRANT EXECUTE ON FUNCTION iam_ctx_private.current_tenant_id() TO iam_ctx_runtime;
GRANT EXECUTE ON FUNCTION iam_ctx_private.context_is_valid() TO iam_ctx_runtime;
GRANT EXECUTE ON FUNCTION iam_ctx_private.current_identity_id() TO iam_ctx_runtime;
GRANT EXECUTE ON FUNCTION iam_ctx_private.guarded_write(text,text,text) TO iam_ctx_runtime;

REVOKE ALL ON SCHEMA iam_ctx_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA iam_ctx_private FROM PUBLIC, iam_ctx_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA iam_ctx_private FROM PUBLIC, iam_ctx_runtime;
REVOKE ALL ON FUNCTION iam_ctx_private.current_tenant_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION iam_ctx_private.context_is_valid() FROM PUBLIC;
REVOKE ALL ON FUNCTION iam_ctx_private.current_identity_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION iam_ctx_private.guarded_write(text,text,text) FROM PUBLIC;

COMMIT;
