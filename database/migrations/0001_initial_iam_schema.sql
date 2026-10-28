-- IAM Control Center — migration 0001
-- Initial clean schema. Reviewed proposal; test only on isolated branch until PR approval.
-- PostgreSQL 18; no extension required.
BEGIN;

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE iam.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL CHECK (issuer ~ '^https://'),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
  email text,
  email_verified boolean NOT NULL DEFAULT false,
  display_name text,
  last_authenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identities_issuer_subject_key UNIQUE (issuer, subject)
);

CREATE TABLE iam.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL REFERENCES iam.identities(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_id_tenant_id_key UNIQUE (id, tenant_id),
  CONSTRAINT memberships_tenant_identity_key UNIQUE (tenant_id, identity_id)
);

CREATE TABLE iam.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_.:-]{1,95}$'),
  display_name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_id_tenant_id_key UNIQUE (id, tenant_id),
  CONSTRAINT roles_tenant_key_key UNIQUE (tenant_id, key)
);

CREATE TABLE iam.permissions (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.:-]{1,127}$'),
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.membership_roles (
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (membership_id, role_id),
  CONSTRAINT membership_roles_membership_tenant_fk
    FOREIGN KEY (membership_id, tenant_id) REFERENCES iam.memberships(id, tenant_id) ON DELETE CASCADE,
  CONSTRAINT membership_roles_role_tenant_fk
    FOREIGN KEY (role_id, tenant_id) REFERENCES iam.roles(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE iam.role_permissions (
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_key text NOT NULL REFERENCES iam.permissions(key) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role_id, permission_key),
  CONSTRAINT role_permissions_role_tenant_fk
    FOREIGN KEY (role_id, tenant_id) REFERENCES iam.roles(id, tenant_id) ON DELETE CASCADE
);

CREATE TABLE iam.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
  email_normalized text NOT NULL CHECK (email_normalized = lower(btrim(email_normalized))),
  token_hash bytea NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at timestamptz NOT NULL,
  invited_by_membership_id uuid,
  accepted_by_identity_id uuid REFERENCES iam.identities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_inviter_tenant_fk
    FOREIGN KEY (invited_by_membership_id, tenant_id)
    REFERENCES iam.memberships(id, tenant_id) ON DELETE SET NULL (invited_by_membership_id)
);

CREATE TABLE audit.events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  tenant_id uuid REFERENCES iam.tenants(id) ON DELETE RESTRICT,
  actor_identity_id uuid REFERENCES iam.identities(id) ON DELETE RESTRICT,
  actor_membership_id uuid,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 160),
  target_type text,
  target_id text,
  outcome text NOT NULL CHECK (outcome IN ('success','denied','failure')),
  request_id text,
  source_ip inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT events_actor_membership_tenant_fk
    FOREIGN KEY (actor_membership_id, tenant_id)
    REFERENCES iam.memberships(id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE iam.schema_migrations (
  version text PRIMARY KEY,
  name text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text NOT NULL DEFAULT current_user
);

CREATE INDEX memberships_identity_status_idx ON iam.memberships(identity_id, status);
CREATE INDEX memberships_tenant_status_idx ON iam.memberships(tenant_id, status);
CREATE INDEX membership_roles_tenant_membership_idx ON iam.membership_roles(tenant_id, membership_id);
CREATE INDEX role_permissions_tenant_role_idx ON iam.role_permissions(tenant_id, role_id);
CREATE INDEX invitations_tenant_status_expiry_idx ON iam.invitations(tenant_id, status, expires_at);
CREATE INDEX audit_events_tenant_time_idx ON audit.events(tenant_id, occurred_at DESC);
CREATE INDEX audit_events_actor_time_idx ON audit.events(actor_identity_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION app_private.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $function$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$function$;

ALTER TABLE iam.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_current_tenant ON iam.tenants
  USING (id = app_private.current_tenant_id())
  WITH CHECK (id = app_private.current_tenant_id());

ALTER TABLE iam.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_current_tenant ON iam.memberships
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

ALTER TABLE iam.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.roles FORCE ROW LEVEL SECURITY;
CREATE POLICY roles_current_tenant ON iam.roles
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

ALTER TABLE iam.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.membership_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY membership_roles_current_tenant ON iam.membership_roles
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

ALTER TABLE iam.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_current_tenant ON iam.role_permissions
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

ALTER TABLE iam.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitations_current_tenant ON iam.invitations
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_events_current_tenant ON audit.events
  USING (tenant_id IS NOT NULL AND tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id IS NOT NULL AND tenant_id = app_private.current_tenant_id());

-- Global identity and permission catalog access is explicit; no anonymous/PUBLIC grants.
REVOKE ALL ON SCHEMA iam, audit, app_private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA iam, audit FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA iam, audit FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;

DO $grants$
DECLARE
  runtime_role text;
BEGIN
  FOREACH runtime_role IN ARRAY ARRAY['iam_app_runtime','iam_app_runtime_dev_safe'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = runtime_role) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA iam, audit, app_private TO %I', runtime_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON iam.identities TO %I', runtime_role);
      EXECUTE format('GRANT SELECT ON iam.permissions TO %I', runtime_role);
      -- Runtime may manage memberships/invitations, but tenant provisioning and role/permission administration
      -- are intentionally withheld until trusted, narrowly-scoped server-side operations are implemented.
      EXECUTE format('GRANT SELECT ON iam.tenants, iam.roles, iam.membership_roles, iam.role_permissions TO %I', runtime_role);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON iam.memberships, iam.invitations TO %I', runtime_role);
      EXECUTE format('GRANT SELECT, INSERT ON audit.events TO %I', runtime_role);
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO %I', runtime_role);
      EXECUTE format('GRANT EXECUTE ON FUNCTION app_private.current_tenant_id() TO %I', runtime_role);
      EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON audit.events FROM %I', runtime_role);
      EXECUTE format('REVOKE ALL ON iam.schema_migrations FROM %I', runtime_role);
    END IF;
  END LOOP;
END
$grants$;

REVOKE ALL ON iam.schema_migrations FROM PUBLIC;
COMMIT;
