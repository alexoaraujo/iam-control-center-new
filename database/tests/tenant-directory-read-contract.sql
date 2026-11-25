-- Disposable source restore only. The static query is taken verbatim from the application.
\set ON_ERROR_STOP on
\set directory_sql `sed -n '/^export const DIRECTORY_SQL = /,/^.;$/p' apps/web/src/lib/directory-query.ts | sed '1d;$d' | tr '\n' ' '`
BEGIN;
SET LOCAL ROLE iam_owner;
INSERT INTO iam.permissions(permission_key,description,resource,action,is_sensitive)
VALUES ('iam.tenant.read','CI tenant read','tenant','read',false),('iam.identity.read','CI identity read','identity','read',false);
INSERT INTO iam.tenants(id,display_name) VALUES
 ('91111111-1111-4111-8111-111111111111','Directory A'),('92222222-2222-4222-8222-222222222222','Directory B');
INSERT INTO iam.identities(id,issuer,subject,display_name) VALUES
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','Actor A'),
 ('9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','https://ci.invalid/','member-a','Member A'),
 ('9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','https://ci.invalid/','member-b','Member B');
INSERT INTO iam.memberships(id,tenant_id,identity_id,status) VALUES
 ('9aaaaaaa-1111-4111-8111-111111111111','91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active'),
 ('9aaaaaaa-1111-4111-8111-111111111112','91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab','active'),
 ('9bbbbbbb-2222-4222-8222-222222222222','92222222-2222-4222-8222-222222222222','9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active');
INSERT INTO iam.roles(id,tenant_id,role_key,display_name) VALUES
 ('9ccccccc-1111-4111-8111-111111111111','91111111-1111-4111-8111-111111111111','ci_directory_reader','CI Directory Reader');
INSERT INTO iam.role_permissions(tenant_id,role_id,permission_key) VALUES
 ('91111111-1111-4111-8111-111111111111','9ccccccc-1111-4111-8111-111111111111','iam.tenant.read'),
 ('91111111-1111-4111-8111-111111111111','9ccccccc-1111-4111-8111-111111111111','iam.identity.read');
INSERT INTO app_private.context_keys(key_id,secret,active) VALUES ('ci-directory-key',decode(repeat('42',32),'hex'),true);
RESET ROLE;
PREPARE directory(uuid,uuid,text,text,text,uuid,text) AS :directory_sql;
SET LOCAL SESSION AUTHORIZATION iam_app_runtime_login;
SELECT set_config('neon.branch_id','br-ci-directory',true);
WITH p AS (SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+120 AS exp)
SELECT iam.set_tenant_context('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',exp,'ci-directory-a',
 encode(public.hmac(convert_to('91111111-1111-4111-8111-111111111111|9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|'||exp::text||'|ci-directory-a','UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex')) FROM p;
EXECUTE directory('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','identities',NULL,'br-ci-directory') \gset
SELECT 1 / ((NOT :'allowed'::boolean AND :'rows'::jsonb = '[]'::jsonb)::int);
SELECT iam.clear_tenant_context();
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE iam_owner;
INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id) VALUES
 ('91111111-1111-4111-8111-111111111111','9aaaaaaa-1111-4111-8111-111111111111','9ccccccc-1111-4111-8111-111111111111');
RESET ROLE;
SET LOCAL SESSION AUTHORIZATION iam_app_runtime_login;
WITH p AS (SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+120 AS exp)
SELECT iam.set_tenant_context('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',exp,'ci-directory-granted',
 encode(public.hmac(convert_to('91111111-1111-4111-8111-111111111111|9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|'||exp::text||'|ci-directory-granted','UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex')) FROM p;
EXECUTE directory('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','organizations',NULL,'br-ci-directory') \gset
SELECT 1 / ((:'allowed'::boolean AND jsonb_array_length(:'rows'::jsonb)=1 AND :'rows'::jsonb->0->>'id'='91111111-1111-4111-8111-111111111111')::int);
EXECUTE directory('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','identities',NULL,'br-ci-directory') \gset
SELECT 1 / ((:'allowed'::boolean AND jsonb_array_length(:'rows'::jsonb)=2 AND NOT :'rows'::jsonb @> '[{"id":"9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}]'::jsonb)::int);
EXECUTE directory('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','identities','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','br-ci-directory') \gset
SELECT 1 / ((:'allowed'::boolean AND jsonb_array_length(:'rows'::jsonb)=1 AND :'rows'::jsonb->0->>'id'='9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab')::int);
EXECUTE directory('92222222-2222-4222-8222-222222222222','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','identities',NULL,'br-ci-directory') \gset
SELECT 1 / ((NOT :'allowed'::boolean AND :'rows'::jsonb = '[]'::jsonb)::int);
EXECUTE directory('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','wrong-subject','identities',NULL,'br-ci-directory') \gset
SELECT 1 / ((NOT :'allowed'::boolean AND :'rows'::jsonb = '[]'::jsonb)::int);
EXECUTE directory('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','identities',NULL,'br-wrong') \gset
SELECT 1 / ((NOT :'allowed'::boolean AND :'rows'::jsonb = '[]'::jsonb)::int);
SELECT iam.clear_tenant_context();
RESET SESSION AUTHORIZATION;
SET LOCAL ROLE iam_owner;
DELETE FROM iam.membership_roles WHERE tenant_id='91111111-1111-4111-8111-111111111111';
RESET ROLE;
SET LOCAL SESSION AUTHORIZATION iam_app_runtime_login;
WITH p AS (SELECT floor(extract(epoch FROM clock_timestamp()))::bigint+120 AS exp)
SELECT iam.set_tenant_context('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',exp,'ci-directory-revoked',
 encode(public.hmac(convert_to('91111111-1111-4111-8111-111111111111|9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|'||exp::text||'|ci-directory-revoked','UTF8'),decode(repeat('42',32),'hex'),'sha256'),'hex')) FROM p;
EXECUTE directory('91111111-1111-4111-8111-111111111111','9aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci.invalid/','actor-a','identities',NULL,'br-ci-directory') \gset
SELECT 1 / ((NOT :'allowed'::boolean AND :'rows'::jsonb = '[]'::jsonb)::int);
RESET SESSION AUTHORIZATION;
DEALLOCATE directory;
ROLLBACK;
SELECT 1 / ((NOT EXISTS (SELECT 1 FROM iam.tenants WHERE id='91111111-1111-4111-8111-111111111111'))::int);
SELECT 'PASS_P2_DIRECTORY_PG18_REAL_QUERY_GRANT_REVOKE_CROSS_TENANT_ROLLBACK';
