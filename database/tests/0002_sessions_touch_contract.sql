-- Migration 0002 contract test.
-- Run only against an isolated Development-derived schema after applying 0002.
-- The caller must already have executed SET ROLE iam_migrator; SET ROLE iam_owner.
BEGIN;

DO $contract$
DECLARE
  actual_function text;
  before_ts timestamptz;
  after_ts timestamptz;
BEGIN
  SELECT p.oid::regprocedure::text INTO actual_function
    FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid
   WHERE n.nspname='iam' AND c.relname='sessions'
     AND t.tgname='sessions_touch' AND NOT t.tgisinternal;

  IF actual_function IS DISTINCT FROM 'iam.touch_session_last_seen_at()' THEN
    RAISE EXCEPTION 'sessions_touch points to %, expected iam.touch_session_last_seen_at()', actual_function;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='iam' AND table_name='sessions'
       AND column_name='last_seen_at' AND data_type='timestamp with time zone'
  ) THEN
    RAISE EXCEPTION 'iam.sessions.last_seen_at contract missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='iam' AND table_name='sessions' AND column_name='updated_at'
  ) THEN
    RAISE EXCEPTION 'unexpected updated_at column appeared on iam.sessions';
  END IF;

  CREATE TABLE iam.sessions_touch_test_probe (
    id integer PRIMARY KEY,
    last_seen_at timestamptz NOT NULL
  );
  CREATE TRIGGER sessions_touch_test_probe
    BEFORE UPDATE ON iam.sessions_touch_test_probe
    FOR EACH ROW EXECUTE FUNCTION iam.touch_session_last_seen_at();
  INSERT INTO iam.sessions_touch_test_probe VALUES (1, clock_timestamp());
  SELECT last_seen_at INTO before_ts FROM iam.sessions_touch_test_probe WHERE id=1;
  PERFORM pg_sleep(0.03);
  UPDATE iam.sessions_touch_test_probe SET id=1 WHERE id=1;
  SELECT last_seen_at INTO after_ts FROM iam.sessions_touch_test_probe WHERE id=1;
  IF after_ts <= before_ts THEN
    RAISE EXCEPTION 'session last_seen_at did not advance on UPDATE';
  END IF;
  DROP TABLE iam.sessions_touch_test_probe;

  CREATE TABLE iam.updated_at_touch_test_probe (
    id integer PRIMARY KEY,
    updated_at timestamptz NOT NULL
  );
  CREATE TRIGGER updated_at_touch_test_probe
    BEFORE UPDATE ON iam.updated_at_touch_test_probe
    FOR EACH ROW EXECUTE FUNCTION iam.touch_updated_at();
  INSERT INTO iam.updated_at_touch_test_probe VALUES (1, clock_timestamp());
  SELECT updated_at INTO before_ts FROM iam.updated_at_touch_test_probe WHERE id=1;
  PERFORM pg_sleep(0.03);
  UPDATE iam.updated_at_touch_test_probe SET id=1 WHERE id=1;
  SELECT updated_at INTO after_ts FROM iam.updated_at_touch_test_probe WHERE id=1;
  IF after_ts <= before_ts THEN
    RAISE EXCEPTION 'shared iam.touch_updated_at() behavior regressed';
  END IF;
  DROP TABLE iam.updated_at_touch_test_probe;
END
$contract$;

ROLLBACK;
