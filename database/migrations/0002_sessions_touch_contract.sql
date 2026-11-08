-- IAM Control Center — migration 0002 (CORRECTIVE)
-- Correct the sessions trigger contract without changing the shared updated_at function.
-- Target: reviewed Development-derived schema only; fail closed on other schema lineages.
BEGIN;

DO $preflight$
DECLARE
  trigger_function text;
BEGIN
  IF current_user <> 'iam_owner' THEN
    RAISE EXCEPTION 'effective current_user must be iam_owner; got %', current_user;
  END IF;

  IF to_regclass('iam.sessions') IS NULL THEN
    RAISE EXCEPTION 'iam.sessions is missing; this migration requires the Development-derived baseline';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='iam' AND table_name='sessions'
       AND column_name='last_seen_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'iam.sessions.last_seen_at timestamptz is required';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='iam' AND table_name='sessions' AND column_name='updated_at'
  ) THEN
    RAISE EXCEPTION 'unexpected iam.sessions.updated_at; review schema lineage before applying';
  END IF;

  SELECT p.oid::regprocedure::text INTO trigger_function
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE n.nspname='iam' AND c.relname='sessions'
     AND t.tgname='sessions_touch' AND NOT t.tgisinternal;

  IF NOT FOUND OR trigger_function <> 'iam.touch_updated_at()' THEN
    RAISE EXCEPTION 'expected sessions_touch -> iam.touch_updated_at(); found %', trigger_function;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION iam.touch_session_last_seen_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  NEW.last_seen_at := clock_timestamp();
  RETURN NEW;
END
$function$;

ALTER FUNCTION iam.touch_session_last_seen_at() OWNER TO iam_owner;
REVOKE ALL ON FUNCTION iam.touch_session_last_seen_at() FROM PUBLIC;

DROP TRIGGER sessions_touch ON iam.sessions;
CREATE TRIGGER sessions_touch
  BEFORE UPDATE ON iam.sessions
  FOR EACH ROW
  EXECUTE FUNCTION iam.touch_session_last_seen_at();

COMMIT;
