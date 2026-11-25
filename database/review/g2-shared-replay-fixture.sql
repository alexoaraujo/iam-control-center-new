-- REVIEW/FIXTURE ONLY. Never run on IAM, Neon or a persistent live target.
BEGIN;
DO $guard$ BEGIN
 IF current_database() <> 'peos_g2_replay_fixture' OR session_user <> 'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
 OR nullif(current_setting('neon.branch_id',true),'') IS NOT NULL
 OR inet_server_addr() IS NULL THEN RAISE EXCEPTION 'BLOCKED_NON_FIXTURE'; END IF;
END $guard$;
CREATE ROLE g2_replay_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE g2_replay_issuer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE g2_replay_consumer NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE SCHEMA g2_replay AUTHORIZATION g2_replay_owner;
SET LOCAL ROLE g2_replay_owner;
REVOKE ALL ON SCHEMA g2_replay FROM PUBLIC;
CREATE TABLE g2_replay.challenge (
 nonce text PRIMARY KEY CHECK(nonce ~ '^[0-9a-f]{64}$'),
 sha text NOT NULL CHECK(sha ~ '^[0-9a-f]{40}$'),
 run_id bigint NOT NULL UNIQUE CHECK(run_id > 0),
 attempt integer NOT NULL CHECK(attempt=1),
 recipient_pin text NOT NULL CHECK(recipient_pin ~ '^[0-9a-f]{64}$'),
 signer_pin text NOT NULL CHECK(signer_pin ~ '^[0-9a-f]{64}$'),
 issued timestamptz NOT NULL, expires timestamptz NOT NULL,
 consumed timestamptz, receipt_hash text, approval_hash text,
 CHECK(expires>issued AND expires<=issued+interval '5 minutes'),
 CHECK((consumed IS NULL AND receipt_hash IS NULL AND approval_hash IS NULL) OR
 (consumed IS NOT NULL AND consumed>=issued AND consumed<expires AND
 receipt_hash IS NOT NULL AND receipt_hash ~ '^[0-9a-f]{64}$' AND
 approval_hash IS NOT NULL AND approval_hash ~ '^[0-9a-f]{64}$'))
);
REVOKE ALL ON TABLE g2_replay.challenge FROM PUBLIC;
CREATE FUNCTION g2_replay.issue(p_nonce text,p_sha text,p_run bigint,p_attempt integer,
 p_recipient text,p_signer text,p_lease_end timestamptz)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE t timestamptz := clock_timestamp(); e timestamptz;
BEGIN
 IF p_lease_end IS NULL OR p_lease_end<=t THEN RAISE EXCEPTION 'LEASE_EXPIRED'; END IF;
 e:=least(p_lease_end,t+interval '5 minutes');
 INSERT INTO g2_replay.challenge(nonce,sha,run_id,attempt,recipient_pin,signer_pin,issued,expires)
 VALUES(p_nonce,p_sha,p_run,p_attempt,p_recipient,p_signer,t,e);
 RETURN e;
END $f$;
-- Trust boundary: consumer must validate signature, receipt, actual GitHub approval
-- and provider binding before invoking. This DB only enforces atomic uniqueness,
-- context and server-time freshness; hashes alone do NOT authenticate either.
CREATE FUNCTION g2_replay.consume(p_nonce text,p_sha text,p_run bigint,p_attempt integer,
 p_recipient text,p_signer text,p_observed timestamptz,p_valid_until timestamptz,
 p_receipt text,p_approval text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE row g2_replay.challenge%ROWTYPE; t timestamptz;
BEGIN
 SELECT * INTO row FROM g2_replay.challenge WHERE nonce=p_nonce FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 t:=clock_timestamp();
 IF row.consumed IS NOT NULL OR t>=row.expires OR t<row.issued
 OR row.sha IS DISTINCT FROM p_sha OR row.run_id IS DISTINCT FROM p_run
 OR row.attempt IS DISTINCT FROM p_attempt OR row.recipient_pin IS DISTINCT FROM p_recipient
 OR row.signer_pin IS DISTINCT FROM p_signer
 OR p_observed IS NULL OR p_valid_until IS NULL
 OR p_observed<row.issued OR p_observed>t OR p_valid_until<=t
 OR p_valid_until>row.expires OR p_valid_until>p_observed+interval '5 minutes'
 OR p_receipt IS NULL OR p_receipt !~ '^[0-9a-f]{64}$'
 OR p_approval IS NULL OR p_approval !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
 UPDATE g2_replay.challenge SET consumed=t,receipt_hash=p_receipt,approval_hash=p_approval
 WHERE nonce=p_nonce AND consumed IS NULL;
 RETURN FOUND;
END $f$;
REVOKE ALL ON FUNCTION g2_replay.issue(text,text,bigint,integer,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION g2_replay.consume(text,text,bigint,integer,text,text,timestamptz,timestamptz,text,text) FROM PUBLIC;
GRANT USAGE ON SCHEMA g2_replay TO g2_replay_issuer,g2_replay_consumer;
GRANT EXECUTE ON FUNCTION g2_replay.issue(text,text,bigint,integer,text,text,timestamptz) TO g2_replay_issuer;
GRANT EXECUTE ON FUNCTION g2_replay.consume(text,text,bigint,integer,text,text,timestamptz,timestamptz,text,text) TO g2_replay_consumer;
RESET ROLE;
COMMIT;
