-- Run as disposable PostgreSQL administrator after schema.sql.
\set ON_ERROR_STOP on
INSERT INTO ctx_lab.test_context_registry
  (token, tenant_id, identity_id, membership_id, expires_at, active)
VALUES
  ('fixture-token-tenant-a',
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000021',
   now() + interval '1 hour', true),
  ('fixture-token-tenant-b',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000022',
   now() + interval '1 hour', true),
  ('fixture-token-expired',
   '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000021',
   now() - interval '1 minute', true);

INSERT INTO ctx_lab.tenant_records(tenant_id, payload)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'tenant-a-record'),
  ('00000000-0000-4000-8000-000000000002', 'tenant-b-record');
