-- IAM Control Center — proposed initial PostgreSQL schema
-- STATUS: REVIEW PROPOSAL ONLY. This file intentionally lives outside
-- database/migrations/ and must not be applied to any shared Neon database.
-- The test harness applies it only to disposable PostgreSQL databases.
--
-- Prerequisites for the disposable test harness / eventual reviewed runner:
--   * schemas are empty (no app objects without a verified migration ledger);
--   * roles iam_owner and iam_app_runtime already exist;
--   * the caller executes as iam_owner (separate from runtime credentials).
--
-- Scope: accepted identity key (issuer, subject), tenant-scoped memberships
-- and RBAC, relational tenant-consistency constraints, append-only audit events,
-- and a migration ledger. Invitation workflow and global bootstrap access remain
-- excluded until ADR-0003 / invitation contracts are explicitly approved.

CREATE SCHEMA IF NOT EXISTS iam;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS app_private;

CREATE TABLE iam.schema_migrations (
    version       text PRIMARY KEY,
    name          text NOT NULL CHECK (btrim(name) <> ''),
    checksum      text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
    applied_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE iam.tenants (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          text NOT NULL UNIQUE
                  CHECK (slug ~ '^[a-z0-9]+([a-z0-9-]*[a-z0-9])?$'),
    name          text NOT NULL CHECK (btrim(name) <> ''),
    status        text NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE iam.identities (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    issuer        text NOT NULL CHECK (btrim(issuer) <> ''),
    subject       text NOT NULL CHECK (btrim(subject) <> ''),
    email         text,
    display_name  text,
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT identities_issuer_subject_key UNIQUE (issuer, subject)
);
-- Email is intentionally not unique and is not an authentication/authorization key.

CREATE TABLE iam.memberships (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identity_id   uuid NOT NULL REFERENCES iam.identities(id) ON DELETE RESTRICT,
    tenant_id     uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE RESTRICT,
    status        text NOT NULL DEFAULT 'invited'
                  CHECK (status IN ('invited', 'active', 'suspended', 'revoked')),
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT memberships_tenant_id_identity_id_key UNIQUE (tenant_id, identity_id),
    CONSTRAINT memberships_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE TABLE iam.roles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE RESTRICT,
    role_key      text NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9._-]*$'),
    display_name  text NOT NULL CHECK (btrim(display_name) <> ''),
    description   text,
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT roles_tenant_id_role_key_key UNIQUE (tenant_id, role_key),
    CONSTRAINT roles_id_tenant_id_key UNIQUE (id, tenant_id)
);

CREATE TABLE iam.permissions (
    key           text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9._-]*$'),
    description   text NOT NULL CHECK (btrim(description) <> ''),
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE iam.membership_roles (
    membership_id uuid NOT NULL,
    role_id       uuid NOT NULL,
    tenant_id     uuid NOT NULL,
    assigned_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT membership_roles_membership_role_tenant_key
        PRIMARY KEY (membership_id, role_id, tenant_id),
    CONSTRAINT membership_roles_membership_tenant_fkey
        FOREIGN KEY (membership_id, tenant_id)
        REFERENCES iam.memberships (id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT membership_roles_role_tenant_fkey
        FOREIGN KEY (role_id, tenant_id)
        REFERENCES iam.roles (id, tenant_id) ON DELETE RESTRICT
);

CREATE TABLE iam.role_permissions (
    role_id       uuid NOT NULL REFERENCES iam.roles(id) ON DELETE RESTRICT,
    permission_key text NOT NULL REFERENCES iam.permissions(key) ON DELETE RESTRICT,
    created_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (role_id, permission_key)
);

CREATE TABLE audit.events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES iam.tenants(id) ON DELETE RESTRICT,
    actor_identity_id   uuid REFERENCES iam.identities(id) ON DELETE RESTRICT,
    actor_membership_id uuid,
    event_key           text NOT NULL CHECK (event_key ~ '^[a-z][a-z0-9._-]*$'),
    outcome             text NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
    target_type         text,
    target_id           text,
    metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
                        CHECK (jsonb_typeof(metadata) = 'object'),
    occurred_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT audit_events_actor_membership_tenant_fkey
        FOREIGN KEY (actor_membership_id, tenant_id)
        REFERENCES iam.memberships (id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX memberships_identity_status_idx
    ON iam.memberships (identity_id, status);
CREATE INDEX memberships_tenant_status_idx
    ON iam.memberships (tenant_id, status);
CREATE INDEX roles_tenant_role_key_idx
    ON iam.roles (tenant_id, role_key);
CREATE INDEX membership_roles_tenant_idx
    ON iam.membership_roles (tenant_id, membership_id);
CREATE INDEX role_permissions_role_idx
    ON iam.role_permissions (role_id);
CREATE INDEX audit_events_tenant_occurred_idx
    ON audit.events (tenant_id, occurred_at DESC);
CREATE INDEX audit_events_tenant_event_occurred_idx
    ON audit.events (tenant_id, event_key, occurred_at DESC);

-- Tenant context is a query-scope hint, NOT proof of OIDC identity or authority.
-- Invalid/missing values fail closed to NULL. A caller able to execute arbitrary
-- SQL can set a custom GUC; the test suite deliberately demonstrates that limit.
CREATE FUNCTION app_private.current_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
    context_value text;
BEGIN
    context_value := NULLIF(current_setting('app.tenant_id', true), '');
    IF context_value IS NULL THEN
        RETURN NULL;
    END IF;
    RETURN context_value::uuid;
EXCEPTION
    WHEN invalid_text_representation THEN
        RETURN NULL;
END;
$function$;

ALTER TABLE iam.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.membership_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE iam.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE audit.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.events FORCE ROW LEVEL SECURITY;

CREATE POLICY memberships_tenant_select
    ON iam.memberships
    FOR SELECT TO iam_app_runtime
    USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY roles_tenant_select
    ON iam.roles
    FOR SELECT TO iam_app_runtime
    USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY membership_roles_tenant_select
    ON iam.membership_roles
    FOR SELECT TO iam_app_runtime
    USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY role_permissions_tenant_select
    ON iam.role_permissions
    FOR SELECT TO iam_app_runtime
    USING (
        EXISTS (
            SELECT 1
            FROM iam.roles AS scoped_role
            WHERE scoped_role.id = role_permissions.role_id
              AND scoped_role.tenant_id = app_private.current_tenant_id()
        )
    );

CREATE POLICY audit_events_tenant_select
    ON audit.events
    FOR SELECT TO iam_app_runtime
    USING (tenant_id = app_private.current_tenant_id());

CREATE POLICY audit_events_tenant_insert
    ON audit.events
    FOR INSERT TO iam_app_runtime
    WITH CHECK (tenant_id = app_private.current_tenant_id());

-- Least-privilege starting point. No runtime grants are made for global
-- identities, tenants, permissions, or the migration ledger until bootstrap
-- and catalog-access contracts are reviewed. Membership/role mutation is also
-- withheld pending endpoint-level authorization and a real runtime-login test.
GRANT USAGE ON SCHEMA iam, audit, app_private TO iam_app_runtime;
REVOKE ALL ON FUNCTION app_private.current_tenant_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.current_tenant_id() TO iam_app_runtime;
GRANT SELECT ON iam.memberships, iam.roles, iam.membership_roles, iam.role_permissions
    TO iam_app_runtime;
GRANT SELECT, INSERT ON audit.events TO iam_app_runtime;
REVOKE UPDATE, DELETE, TRUNCATE ON audit.events FROM iam_app_runtime;

-- Explicitly not included yet:
--   * iam.invitations (invitation/token lifecycle contract not approved);
--   * RLS/access paths for iam.tenants, iam.identities, iam.permissions;
--   * tenant discovery / login bootstrap function or SECURITY DEFINER API;
--   * seed permission/role catalog;
--   * runtime INSERT/UPDATE of membership and role relationships;
--   * changes to existing role membership or owner/runtime credentials.
