-- REVIEW/FIXTURE ONLY. Independent logical witness DB in disposable PG18 CI.
-- Never apply to IAM, Neon, or a real custody target.
BEGIN;
DO $guard$ BEGIN
 IF current_database() <> 'peos_g2_witness_fixture' OR session_user <> 'postgres'
 OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
 OR nullif(current_setting('neon.branch_id',true),'') IS NOT NULL
 OR inet_server_addr() IS NULL THEN RAISE EXCEPTION 'BLOCKED_NON_FIXTURE'; END IF;
END $guard$;
CREATE ROLE g2_witness_owner NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE ROLE g2_witness_reserver NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB;
CREATE SCHEMA g2_witness AUTHORIZATION g2_witness_owner;
SET LOCAL ROLE g2_witness_owner;
REVOKE ALL ON SCHEMA g2_witness FROM PUBLIC;
CREATE TABLE g2_witness.epoch_pin (
 singleton boolean PRIMARY KEY CHECK(singleton), epoch text NOT NULL CHECK(epoch ~ '^[0-9a-f]{64}$')
);
INSERT INTO g2_witness.epoch_pin VALUES(true,repeat('e',64));
CREATE TABLE g2_witness.retired_run (
 repository text NOT NULL CHECK(repository='alexoaraujo/iam-control-center-new'),
 run_id bigint NOT NULL CHECK(run_id>0),
 attempt integer NOT NULL CHECK(attempt=1),
 epoch text NOT NULL CHECK(epoch ~ '^[0-9a-f]{64}$'),
 nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[0-9a-f]{64}$'),
 sha text NOT NULL CHECK(sha ~ '^[0-9a-f]{40}$'),
 receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[0-9a-f]{64}$'),
 approval_hash text NOT NULL CHECK(approval_hash ~ '^[0-9a-f]{64}$'),
 retired_at timestamptz NOT NULL,
 PRIMARY KEY(repository,run_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA g2_witness FROM PUBLIC;
-- Only a separately trusted service may call after validating signature, approval
-- and endpoint binding. Permanent burn precedes primary consume. No retry/unburn API.
CREATE FUNCTION g2_witness.reserve(p_epoch text,p_repo text,p_run bigint,p_attempt integer,
 p_nonce text,p_sha text,p_receipt text,p_approval text,p_valid_until timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $f$
DECLARE actual_epoch text; t timestamptz;
BEGIN
 SELECT epoch INTO STRICT actual_epoch FROM g2_witness.epoch_pin WHERE singleton FOR SHARE;
 t:=clock_timestamp();
 IF p_epoch IS DISTINCT FROM actual_epoch OR p_repo IS DISTINCT FROM 'alexoaraujo/iam-control-center-new'
 OR p_run IS NULL OR p_run<=0 OR p_attempt IS DISTINCT FROM 1
 OR p_nonce IS NULL OR p_nonce !~ '^[0-9a-f]{64}$'
 OR p_sha IS NULL OR p_sha !~ '^[0-9a-f]{40}$'
 OR p_receipt IS NULL OR p_receipt !~ '^[0-9a-f]{64}$'
 OR p_approval IS NULL OR p_approval !~ '^[0-9a-f]{64}$'
 OR p_valid_until IS NULL OR p_valid_until<=t OR p_valid_until>t+interval '5 minutes'
 THEN RETURN false; END IF;
 INSERT INTO g2_witness.retired_run(repository,run_id,attempt,epoch,nonce,sha,receipt_hash,approval_hash,retired_at)
 VALUES(p_repo,p_run,p_attempt,p_epoch,p_nonce,p_sha,p_receipt,p_approval,t)
 ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $f$;
REVOKE ALL ON FUNCTION g2_witness.reserve(text,text,bigint,integer,text,text,text,text,timestamptz) FROM PUBLIC;
GRANT USAGE ON SCHEMA g2_witness TO g2_witness_reserver;
GRANT EXECUTE ON FUNCTION g2_witness.reserve(text,text,bigint,integer,text,text,text,text,timestamptz) TO g2_witness_reserver;
RESET ROLE;
COMMIT;
