-- Experimental only: disposable PostgreSQL harness. Never run against Neon.
\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE ROLE iam_ctx_poc_owner NOLOGIN;
CREATE ROLE iam_ctx_poc_runtime NOLOGIN;
CREATE SCHEMA iam_ctx_poc AUTHORIZATION iam_ctx_poc_owner;
CREATE SCHEMA iam_ctx_private AUTHORIZATION iam_ctx_poc_owner;
REVOKE ALL ON SCHEMA iam_ctx_private FROM PUBLIC;

SET ROLE iam_ctx_poc_owner;

CREATE TABLE iam_ctx_private.signing_keys (
  key_id text PRIMARY KEY,
  secret bytea NOT NULL,
  active boolean NOT NULL DEFAULT false
);
INSERT INTO iam_ctx_private.signing_keys(key_id, secret, active)
VALUES ('poc-v1', decode(repeat('a5', 32), 'hex'), true);

CREATE TABLE iam_ctx_poc.records (
  tenant_id uuid NOT NULL,
  record_key text NOT NULL,
  PRIMARY KEY (tenant_id, record_key)
);
INSERT INTO iam_ctx_poc.records VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'tenant-a'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'tenant-b');

CREATE FUNCTION iam_ctx_private.issue_context(p_tenant uuid, p_ttl_seconds integer DEFAULT 60)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, iam_ctx_private, public
AS $fn$
DECLARE payload text; secret_value bytea;
BEGIN
  IF p_ttl_seconds < 1 OR p_ttl_seconds > 300 THEN RAISE EXCEPTION 'invalid TTL'; END IF;
  SELECT secret INTO STRICT secret_value FROM iam_ctx_private.signing_keys WHERE active;
  payload := json_build_object('v', 1, 'kid', 'poc-v1',
    'tenant_id', p_tenant::text,
    'exp', floor(extract(epoch FROM clock_timestamp()))::bigint + p_ttl_seconds)::text;
  RETURN encode(convert_to(payload, 'UTF8'), 'hex') || '.' ||
    encode(public.hmac(convert_to(payload, 'UTF8'), secret_value, 'sha256'), 'hex');
END
$fn$;

CREATE FUNCTION iam_ctx_private.current_tenant_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, iam_ctx_private, public
AS $fn$
DECLARE
  token text; payload_hex text; signature_hex text; payload text;
  claims json; secret_value bytea; expected_signature bytea;
BEGIN
  token := current_setting('app.tenant_context', true);
  IF token IS NULL OR length(token) > 2048 OR token !~ '^[0-9a-f]+\.[0-9a-f]{64}$' THEN RETURN NULL; END IF;
  payload_hex := split_part(token, '.', 1);
  signature_hex := split_part(token, '.', 2);
  payload := convert_from(decode(payload_hex, 'hex'), 'UTF8');
  claims := payload::json;
  IF claims->>'v' <> '1' OR claims->>'kid' <> 'poc-v1' THEN RETURN NULL; END IF;
  SELECT secret INTO STRICT secret_value FROM iam_ctx_private.signing_keys
    WHERE key_id = claims->>'kid' AND active;
  expected_signature := public.hmac(convert_to(payload, 'UTF8'), secret_value, 'sha256');
  IF expected_signature <> decode(signature_hex, 'hex') THEN RETURN NULL; END IF;
  IF (claims->>'exp')::bigint <= floor(extract(epoch FROM clock_timestamp()))::bigint THEN RETURN NULL; END IF;
  RETURN (claims->>'tenant_id')::uuid;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$fn$;

ALTER TABLE iam_ctx_poc.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam_ctx_poc.records FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON iam_ctx_poc.records
  USING (tenant_id = iam_ctx_private.current_tenant_id())
  WITH CHECK (tenant_id = iam_ctx_private.current_tenant_id());

REVOKE ALL ON ALL TABLES IN SCHEMA iam_ctx_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA iam_ctx_private FROM PUBLIC;
GRANT USAGE ON SCHEMA iam_ctx_poc, iam_ctx_private TO iam_ctx_poc_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON iam_ctx_poc.records TO iam_ctx_poc_runtime;
GRANT EXECUTE ON FUNCTION iam_ctx_private.current_tenant_id() TO iam_ctx_poc_runtime;
RESET ROLE;

-- The trusted test harness runs as postgres; runtime receives no issuer grant.
CREATE FUNCTION public.assert_true(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT coalesce(p_ok, false) THEN RAISE EXCEPTION 'ASSERTION FAILED: %', p_message; END IF;
END
$fn$;

SELECT iam_ctx_private.issue_context('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 60) AS token_a \gset
SELECT iam_ctx_private.issue_context('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 60) AS token_b \gset
SELECT iam_ctx_private.issue_context('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1) AS expired_token \gset

SET ROLE iam_ctx_poc_runtime;
SELECT set_config('app.tenant_context', :'token_a', false);
SELECT public.assert_true((SELECT count(*) = 1 AND min(record_key) = 'tenant-a' FROM iam_ctx_poc.records),
  'valid A context must expose only tenant A');
SELECT set_config('app.tenant_context', :'token_b', false);
SELECT public.assert_true((SELECT count(*) = 1 AND min(record_key) = 'tenant-b' FROM iam_ctx_poc.records),
  'valid B context must expose only tenant B');

-- Keep A's signature while replacing the signed payload tenant UUID with B.
SELECT set_config('app.tenant_context',
  encode(convert_to(replace(convert_from(decode(split_part(:'token_a', '.', 1), 'hex'), 'UTF8'),
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'UTF8'), 'hex')
  || '.' || split_part(:'token_a', '.', 2), false);
SELECT public.assert_true((SELECT count(*) = 0 FROM iam_ctx_poc.records),
  'payload tenant tampering must expose no rows');

SELECT pg_sleep(2);
SELECT set_config('app.tenant_context', :'expired_token', false);
SELECT public.assert_true((SELECT count(*) = 0 FROM iam_ctx_poc.records),
  'expired context must expose no rows');
SELECT set_config('app.tenant_context', 'malformed', false);
SELECT public.assert_true((SELECT count(*) = 0 FROM iam_ctx_poc.records),
  'malformed context must expose no rows');
SELECT set_config('app.tenant_context', '', false);
SELECT public.assert_true((SELECT count(*) = 0 FROM iam_ctx_poc.records),
  'missing context must expose no rows');

SELECT set_config('app.tenant_context', :'token_a', false);
DO $test$
BEGIN
  BEGIN
    INSERT INTO iam_ctx_poc.records VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'forbidden');
    RAISE EXCEPTION 'ASSERTION FAILED: cross-tenant INSERT unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM * FROM iam_ctx_private.signing_keys;
    RAISE EXCEPTION 'ASSERTION FAILED: runtime read signing key';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM iam_ctx_private.issue_context('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 60);
    RAISE EXCEPTION 'ASSERTION FAILED: runtime invoked issuer';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'CREATE OR REPLACE FUNCTION iam_ctx_private.current_tenant_id() RETURNS uuid LANGUAGE sql AS $ SELECT NULL::uuid $';
    RAISE EXCEPTION 'ASSERTION FAILED: runtime replaced verifier';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'ALTER TABLE iam_ctx_poc.records DISABLE ROW LEVEL SECURITY';
    RAISE EXCEPTION 'ASSERTION FAILED: runtime disabled RLS';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    EXECUTE 'SET ROLE iam_ctx_poc_owner';
    RAISE EXCEPTION 'ASSERTION FAILED: runtime assumed owner role';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE iam_ctx_poc.records SET record_key = 'tampered' WHERE tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  IF FOUND THEN RAISE EXCEPTION 'ASSERTION FAILED: cross-tenant UPDATE changed a row'; END IF;
  DELETE FROM iam_ctx_poc.records WHERE tenant_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  IF FOUND THEN RAISE EXCEPTION 'ASSERTION FAILED: cross-tenant DELETE removed a row'; END IF;
  UPDATE iam_ctx_poc.records SET record_key = 'tenant-a-updated'
    WHERE tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  IF NOT FOUND THEN RAISE EXCEPTION 'ASSERTION FAILED: own-tenant UPDATE was denied'; END IF;
END
$test$;
RESET ROLE;

-- Transaction-local GUC must not leak to the next transaction on a pooled session.
BEGIN;
SET ROLE iam_ctx_poc_runtime;
SELECT set_config('app.tenant_context', :'token_a', true);
SELECT public.assert_true((SELECT count(*) = 1 FROM iam_ctx_poc.records),
  'transaction-local context must authorize its tenant');
RESET ROLE;
COMMIT;
SET ROLE iam_ctx_poc_runtime;
SELECT public.assert_true((SELECT count(*) = 0 FROM iam_ctx_poc.records),
  'transaction-local context must not leak after COMMIT');
RESET ROLE;

SELECT 'IAM-CTX-POC-01 SQL assertions completed' AS result;
