-- Minimal Development-derived schema fixture for migration 0002 contract testing.
-- Deliberately models sessions.last_seen_at without sessions.updated_at.
CREATE TABLE iam.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION iam.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END
$function$;

ALTER FUNCTION iam.touch_updated_at() OWNER TO iam_owner;

CREATE TRIGGER sessions_touch
  BEFORE UPDATE ON iam.sessions
  FOR EACH ROW
  EXECUTE FUNCTION iam.touch_updated_at();
