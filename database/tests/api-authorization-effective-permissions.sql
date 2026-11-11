-- Disposable PostgreSQL 18 CI only. End-to-end database permission resolution
-- with synthetic signed context and the exact IAM effective_permissions function.
-- Runs after source schema restore; fixtures are inside ONE rolled-back transaction.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE iam_owner;
INSERT INTO iam.permissions(permission_key,description,resource,action,is_sensitive)
VALUES ('iam.tenant.read','Synthetic CI permission','tenant','read',false),
       ('iam.tenant.update','Synthetic sensitive permission','tenant','update',true);
INSERT INTO iam.tenants(id,display_name)
VALUES ('81111111-1111-4111-8111-111111111111','CI Authorize A'),
       ('82222222-2222-4222-8222-222222222222','CI Authorize B');
INSERT INTO iam.identities(id,issuer,subject)
VALUES ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci-rbac.invalid/','ci-member-a'),
       ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','https://ci-rbac.invalid/','ci-member-b');
INSERT INTO iam.memberships(id,tenant_id,identity_id,status)
VALUES ('8aaaaaaa-1111-4111-8111-111111111111','81111111-1111-4111-8111-111111111111','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active'),
       ('8bbbbbbb-2222-4222-8222-222222222222','82222222-2222-4222-8222-222222222222','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active');
INSERT INTO iam.roles(id,tenant_id,role_key,display_name)
VALUES ('8ccccccc-1111-4111-8111-111111111111','81111111-1111-4111-8111-111111111111','ci_permission_reader','Synthetic Reader A'),
       ('8ddddddd-2222-4222-8222-222222222222','82222222-2222-4222-8222-222222222222','ci_permission_reader_b','Synthetic Reader B');
INSERT INTO iam.role_permissions(tenant_id,role_id,permission_key)
VALUES ('81111111-1111-4111-8111-111111111111','8ccccccc-1111-4111-8111-111111111111','iam.tenant.read'),
       ('82222222-2222-4222-8222-222222222222','8ddddddd-2222-4222-8222-222222222222','iam.tenant.read');
INSERT INTO app_private.context_keys(key_id,secret,active)
VALUES ('ci-api-authz-key', decode(repeat('42',32),'hex'),true);

RESET ROLE;
SET LOCAL ROLE iam_app_runtime;
-- Default deny before any role assignment and no context.
DO $default_deny$
BEGIN
 IF EXISTS(SELECT 1 FROM iam.effective_permissions('8aaaaaaa-1111-4111-8111-111111111111'::uuid))
 THEN RAISE EXCEPTION 'permission visible without signed tenant context'; END IF;
END $default_deny$;

-- Context is established in a distinct statement, as the API does via the
-- Neon HTTP transaction array. Never set a context inside the same SELECT
-- statement that evaluates RLS/STABLE membership predicates.
DO $set_a$
DECLARE
 exp bigint := extract(epoch from clock_timestamp())::bigint+120;
 nonce text := 'ci-rbac-api-a';
 sig text;
BEGIN
 sig := encode(public.hmac(convert_to(
 '81111111-1111-4111-8111-111111111111|8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|' ||
 exp::text || '|' || nonce,'UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex');
 PERFORM iam.set_tenant_context('81111111-1111-4111-8111-111111111111','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',exp,nonce,sig);
END $set_a$;
DO $before_grant$
BEGIN
 IF app_private.current_tenant_id() IS DISTINCT FROM '81111111-1111-4111-8111-111111111111'::uuid
    OR EXISTS(SELECT 1 FROM iam.effective_permissions('8aaaaaaa-1111-4111-8111-111111111111'::uuid))
 THEN RAISE EXCEPTION 'default deny or signed-context binding invalid'; END IF;
END $before_grant$;
SELECT iam.clear_tenant_context();
RESET ROLE;
SET LOCAL ROLE iam_owner;
INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id)
VALUES('81111111-1111-4111-8111-111111111111','8aaaaaaa-1111-4111-8111-111111111111','8ccccccc-1111-4111-8111-111111111111'),
      ('82222222-2222-4222-8222-222222222222','8bbbbbbb-2222-4222-8222-222222222222','8ddddddd-2222-4222-8222-222222222222');

RESET ROLE;
SET LOCAL ROLE iam_app_runtime;
DO $set_granted_a$
DECLARE
 exp bigint := extract(epoch from clock_timestamp())::bigint+120;
 nonce text := 'ci-rbac-api-granted-a';
 sig text;
BEGIN
 sig := encode(public.hmac(convert_to(
 '81111111-1111-4111-8111-111111111111|8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|' ||
 exp::text || '|' || nonce,'UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex');
 PERFORM iam.set_tenant_context('81111111-1111-4111-8111-111111111111','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',exp,nonce,sig);
END $set_granted_a$;
DO $allow_only_grant$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM iam.effective_permissions('8aaaaaaa-1111-4111-8111-111111111111'::uuid)
               WHERE permission_key='iam.tenant.read')
    OR EXISTS(SELECT 1 FROM iam.effective_permissions('8aaaaaaa-1111-4111-8111-111111111111'::uuid)
               WHERE permission_key='iam.tenant.update')
    OR EXISTS(SELECT 1 FROM iam.effective_permissions('8bbbbbbb-2222-4222-8222-222222222222'::uuid))
 THEN RAISE EXCEPTION 'granted permission missing, excess sensitive privilege or tenant leakage'; END IF;
END $allow_only_grant$;
SELECT iam.clear_tenant_context();

-- Bidirectional tenant isolation: B's independently granted permission must
-- resolve under B's signed context, but never expose A's membership/permission.
-- No state escapes the wrapping PostgreSQL 18 fixture transaction.
DO $set_granted_b$
DECLARE
 exp bigint := extract(epoch from clock_timestamp())::bigint+120;
 nonce text := 'ci-rbac-api-granted-b';
 sig text;
BEGIN
 sig := encode(public.hmac(convert_to(
 '82222222-2222-4222-8222-222222222222|8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb|' ||
 exp::text || '|' || nonce,'UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex');
 PERFORM iam.set_tenant_context('82222222-2222-4222-8222-222222222222','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',exp,nonce,sig);
END $set_granted_b$;
DO $allow_only_grant_b$
BEGIN
 IF app_private.current_tenant_id() IS DISTINCT FROM '82222222-2222-4222-8222-222222222222'::uuid
    OR NOT EXISTS(SELECT 1 FROM iam.effective_permissions('8bbbbbbb-2222-4222-8222-222222222222'::uuid)
               WHERE permission_key='iam.tenant.read')
    OR EXISTS(SELECT 1 FROM iam.effective_permissions('8aaaaaaa-1111-4111-8111-111111111111'::uuid))
    OR EXISTS(SELECT 1 FROM iam.effective_permissions('8bbbbbbb-2222-4222-8222-222222222222'::uuid)
               WHERE permission_key='iam.tenant.update')
 THEN RAISE EXCEPTION 'tenant B grant missing, exceeded scope or leaked tenant A'; END IF;
END $allow_only_grant_b$;
SELECT iam.clear_tenant_context();
RESET ROLE;
SET LOCAL ROLE iam_owner;
DELETE FROM iam.membership_roles WHERE tenant_id='82222222-2222-4222-8222-222222222222'
 AND membership_id='8bbbbbbb-2222-4222-8222-222222222222';
DELETE FROM iam.membership_roles WHERE tenant_id='81111111-1111-4111-8111-111111111111'
 AND membership_id='8aaaaaaa-1111-4111-8111-111111111111';

RESET ROLE;
SET LOCAL ROLE iam_app_runtime;
DO $set_revoked_a$
DECLARE
 exp bigint := extract(epoch from clock_timestamp())::bigint+120;
 nonce text := 'ci-rbac-api-revoked-a';
 sig text;
BEGIN
 sig := encode(public.hmac(convert_to(
 '81111111-1111-4111-8111-111111111111|8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|' ||
 exp::text || '|' || nonce,'UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex');
 PERFORM iam.set_tenant_context('81111111-1111-4111-8111-111111111111','8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',exp,nonce,sig);
END $set_revoked_a$;
DO $deny_revocation$
BEGIN
 IF EXISTS(SELECT 1 FROM iam.effective_permissions('8aaaaaaa-1111-4111-8111-111111111111'::uuid))
 THEN RAISE EXCEPTION 'revoked permission still effective'; END IF;
END $deny_revocation$;
SELECT iam.clear_tenant_context();
DO $set_revoked_b$
DECLARE
 exp bigint := extract(epoch from clock_timestamp())::bigint+120;
 nonce text := 'ci-rbac-api-revoked-b';
 sig text;
BEGIN
 sig := encode(public.hmac(convert_to(
 '82222222-2222-4222-8222-222222222222|8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb|' ||
 exp::text || '|' || nonce,'UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex');
 PERFORM iam.set_tenant_context('82222222-2222-4222-8222-222222222222','8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',exp,nonce,sig);
END $set_revoked_b$;
DO $deny_revocation_b$
BEGIN
 IF EXISTS(SELECT 1 FROM iam.effective_permissions('8bbbbbbb-2222-4222-8222-222222222222'::uuid))
 THEN RAISE EXCEPTION 'tenant B revoked permission still effective'; END IF;
END $deny_revocation_b$;
SELECT iam.clear_tenant_context();
RESET ROLE;
ROLLBACK;

DO $no_fixture$
BEGIN
 IF EXISTS(SELECT 1 FROM iam.tenants WHERE id='81111111-1111-4111-8111-111111111111'::uuid)
  OR EXISTS(SELECT 1 FROM iam.permissions WHERE permission_key='iam.tenant.read')
  OR EXISTS(SELECT 1 FROM app_private.context_keys WHERE key_id='ci-api-authz-key')
 THEN RAISE EXCEPTION 'RBAC API synthetic fixture escaped rollback'; END IF;
END $no_fixture$;
SELECT 'PASS: signed-context A/B effective_permissions grants, cross-tenant denial, revocations and rollback' AS result;
