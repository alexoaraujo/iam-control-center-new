-- PEOS: READ-ONLY recovery source/clone fingerprint. No SQL execution grants.
-- Returns only counts + SHA-256 digests, never usernames, records or secret values.
-- For a reviewed SMALL validation dataset only: aggregation materializes canonical JSON.
-- Do not use for unbounded large databases; use a reviewed streaming backup protocol.
-- A digest match proves snapshot equality, NOT pg_dump, pg_restore or PITR recovery.
WITH table_fingerprints AS (
  SELECT 'app_private'::text AS schema_name, 'context_keys'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "app_private"."context_keys" t
  UNION ALL
  SELECT 'audit'::text AS schema_name, 'events'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "audit"."events" t
  UNION ALL
  SELECT 'audit'::text AS schema_name, 'outbox'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "audit"."outbox" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'access_policies'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."access_policies" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'api_keys'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."api_keys" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'group_memberships'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."group_memberships" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'group_roles'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."group_roles" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'groups'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."groups" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'idempotency_keys'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."idempotency_keys" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'identities'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."identities" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'identity_providers'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."identity_providers" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'invitations'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."invitations" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'membership_roles'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."membership_roles" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'memberships'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."memberships" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'organizations'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."organizations" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'permissions'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."permissions" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'role_permissions'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."role_permissions" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'roles'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."roles" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'schema_migrations'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."schema_migrations" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'security_events'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."security_events" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'service_accounts'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."service_accounts" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'sessions'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."sessions" t
  UNION ALL
  SELECT 'iam'::text AS schema_name, 'tenants'::text AS table_name,
         count(*)::bigint AS row_count,
         encode(digest(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), ''), 'sha256'),'hex') AS content_sha256
  FROM "iam"."tenants" t
), catalogue AS (
 SELECT count(*)::bigint AS discovered_tables
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('iam','audit','app_private') AND c.relkind IN ('r','p')
), aggregate AS (
 SELECT count(*)::bigint AS checked_tables,
        sum(row_count)::bigint AS total_rows,
        jsonb_agg(jsonb_build_object(
          'schema',schema_name,
          'table',table_name,
          'count',row_count,
          'sha256',content_sha256
        ) ORDER BY schema_name,table_name) AS table_digests
 FROM table_fingerprints
)
SELECT jsonb_build_object(
 'format','iam-recovery-branch-fingerprint/v1',
 'database',current_database(),
 'postgres_version',current_setting('server_version_num')::integer,
 'catalogue_tables',catalogue.discovered_tables,
 'tables_checked',aggregate.checked_tables,
 'total_rows',aggregate.total_rows,
 'table_digests',aggregate.table_digests,
 'verdict',CASE
   WHEN current_database()<>'iam_database'
      OR current_setting('server_version_num')::integer<>180007
      THEN 'BLOCKED_WRONG_DATABASE_OR_PG_VERSION'
   WHEN catalogue.discovered_tables<>23 OR aggregate.checked_tables<>23
      THEN 'BLOCKED_TABLE_INVENTORY_DRIFT'
   WHEN aggregate.total_rows>1000 THEN 'BLOCKED_REQUIRES_STREAMING_BACKUP'
   ELSE 'METADATA_AND_ROW_DIGESTS_ONLY_NOT_RESTORE'
 END
) AS recovery_fingerprint
FROM catalogue,aggregate;
