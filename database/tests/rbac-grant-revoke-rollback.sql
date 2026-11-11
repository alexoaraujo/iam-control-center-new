-- PostgreSQL 18 disposable CI: relational RBAC grant, revoke, suspend and deny-by-default.
-- Invoked only after source schema restore; all synthetic fixture rows are ROLLBACKed.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE iam_owner;

INSERT INTO iam.tenants(id,display_name) VALUES
 ('71111111-1111-4111-8111-111111111111','CI RBAC A'),
 ('72222222-2222-4222-8222-222222222222','CI RBAC B');
INSERT INTO iam.identities(id,issuer,subject) VALUES
 ('7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','https://ci-rbac.invalid/','ci-a'),
 ('7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','https://ci-rbac.invalid/','ci-b');
INSERT INTO iam.memberships(id,tenant_id,identity_id,status) VALUES
 ('7aaaaaaa-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','7aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','active'),
 ('7bbbbbbb-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222','7bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','active');
INSERT INTO iam.roles(id,tenant_id,role_key,display_name)
 VALUES ('7ccccccc-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111','ci_validation_reader','CI RBAC Reader');
INSERT INTO iam.role_permissions(tenant_id,role_id,permission_key)
 VALUES('71111111-1111-4111-8111-111111111111','7ccccccc-1111-4111-8111-111111111111','iam.tenant.read');

DO $rbac_contract$
DECLARE
 ta uuid := '71111111-1111-4111-8111-111111111111';
 tb uuid := '72222222-2222-4222-8222-222222222222';
 ma uuid := '7aaaaaaa-1111-4111-8111-111111111111';
 mb uuid := '7bbbbbbb-2222-4222-8222-222222222222';
 ra uuid := '7ccccccc-1111-4111-8111-111111111111';
 granted boolean;
 rejected boolean := false;
BEGIN
 -- Dynamic permission resolution is a relational contract, not the API's security evaluator.
 SELECT EXISTS(
  SELECT 1 FROM iam.memberships m
  JOIN iam.membership_roles mr ON mr.tenant_id=m.tenant_id AND mr.membership_id=m.id
  JOIN iam.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id
  WHERE m.tenant_id=ta AND m.id=ma AND m.status='active' AND rp.permission_key='iam.tenant.read'
 ) INTO granted;
 IF granted THEN RAISE EXCEPTION 'RBAC deny-by-default failed before grant'; END IF;

 INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id) VALUES(ta,ma,ra);
 SELECT EXISTS(
  SELECT 1 FROM iam.memberships m
  JOIN iam.membership_roles mr ON mr.tenant_id=m.tenant_id AND mr.membership_id=m.id
  JOIN iam.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id
  WHERE m.tenant_id=ta AND m.id=ma AND m.status='active' AND rp.permission_key='iam.tenant.read'
 ) INTO granted;
 IF NOT granted THEN RAISE EXCEPTION 'RBAC grant not visible'; END IF;

 SELECT EXISTS(
  SELECT 1 FROM iam.memberships m
  JOIN iam.membership_roles mr ON mr.tenant_id=m.tenant_id AND mr.membership_id=m.id
  JOIN iam.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id
  WHERE m.tenant_id=tb AND m.id=mb AND m.status='active' AND rp.permission_key='iam.tenant.read'
 ) INTO granted;
 IF granted THEN RAISE EXCEPTION 'RBAC grant leaked across tenant boundary'; END IF;

 SELECT EXISTS(
  SELECT 1 FROM iam.memberships m
  JOIN iam.membership_roles mr ON mr.tenant_id=m.tenant_id AND mr.membership_id=m.id
  JOIN iam.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id
  WHERE m.tenant_id=ta AND m.id=ma AND m.status='active' AND rp.permission_key='iam.tenant.update'
 ) INTO granted;
 IF granted THEN RAISE EXCEPTION 'RBAC sensitive permission auto-granted'; END IF;

 BEGIN
  INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id) VALUES(tb,mb,ra);
 EXCEPTION WHEN foreign_key_violation THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'RBAC cross-tenant role assignment permitted'; END IF;

 DELETE FROM iam.membership_roles WHERE tenant_id=ta AND membership_id=ma AND role_id=ra;
 SELECT EXISTS(
  SELECT 1 FROM iam.memberships m
  JOIN iam.membership_roles mr ON mr.tenant_id=m.tenant_id AND mr.membership_id=m.id
  JOIN iam.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id
  WHERE m.tenant_id=ta AND m.id=ma AND m.status='active' AND rp.permission_key='iam.tenant.read'
 ) INTO granted;
 IF granted THEN RAISE EXCEPTION 'RBAC revoked permission remained effective'; END IF;

 INSERT INTO iam.membership_roles(tenant_id,membership_id,role_id) VALUES(ta,ma,ra);
 UPDATE iam.memberships SET status='suspended' WHERE tenant_id=ta AND id=ma;
 SELECT EXISTS(
  SELECT 1 FROM iam.memberships m
  JOIN iam.membership_roles mr ON mr.tenant_id=m.tenant_id AND mr.membership_id=m.id
  JOIN iam.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id
  WHERE m.tenant_id=ta AND m.id=ma AND m.status='active' AND rp.permission_key='iam.tenant.read'
 ) INTO granted;
 IF granted THEN RAISE EXCEPTION 'RBAC suspension did not deny permission'; END IF;
END $rbac_contract$;

ROLLBACK;

DO $rbac_no_leak$
BEGIN
 IF EXISTS(SELECT 1 FROM iam.tenants WHERE id IN('71111111-1111-4111-8111-111111111111'::uuid,'72222222-2222-4222-8222-222222222222'::uuid))
 OR EXISTS(SELECT 1 FROM iam.identities WHERE issuer='https://ci-rbac.invalid/')
 OR EXISTS(SELECT 1 FROM iam.roles WHERE role_key='ci_validation_reader')
 OR EXISTS(SELECT 1 FROM iam.membership_roles)
 OR EXISTS(SELECT 1 FROM iam.role_permissions WHERE permission_key='iam.tenant.read')
 THEN RAISE EXCEPTION 'RBAC CI fixture survived transaction rollback'; END IF;
END $rbac_no_leak$;

SELECT 'PASS: disposable PostgreSQL 18 RBAC grant/revoke/deny/suspend/cross-tenant FK and full fixture rollback' AS result;
