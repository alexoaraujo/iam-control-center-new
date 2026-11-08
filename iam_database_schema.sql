--
-- PostgreSQL database dump
--

\restrict BTtOBzwWrKDmVJdcDohRkbkfHhjmYFDz9yewOtmlGZApmjt9EE8mJFWj6HjlsBx

-- Required dependency for app_private.current_tenant_id() public.hmac(...).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Dumped from database version 18.6 (ac70818)
-- Dumped by pg_dump version 18.6

-- Started on 2026-11-05 03:46:00

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 7 (class 2615 OID 16624)
-- Name: app_private; Type: SCHEMA; Schema: -; Owner: iam_owner
--

CREATE SCHEMA "app_private";


ALTER SCHEMA "app_private" OWNER TO "iam_owner";

--
-- TOC entry 8 (class 2615 OID 16623)
-- Name: audit; Type: SCHEMA; Schema: -; Owner: iam_owner
--

CREATE SCHEMA "audit";


ALTER SCHEMA "audit" OWNER TO "iam_owner";

--
-- TOC entry 9 (class 2615 OID 16622)
-- Name: iam; Type: SCHEMA; Schema: -; Owner: iam_owner
--

CREATE SCHEMA "iam";


ALTER SCHEMA "iam" OWNER TO "iam_owner";

--
-- TOC entry 943 (class 1247 OID 16672)
-- Name: api_key_status; Type: TYPE; Schema: iam; Owner: iam_owner
--

CREATE TYPE "iam"."api_key_status" AS ENUM (
    'active',
    'revoked',
    'expired'
);


ALTER TYPE "iam"."api_key_status" OWNER TO "iam_owner";

--
-- TOC entry 946 (class 1247 OID 16680)
-- Name: audit_outcome; Type: TYPE; Schema: iam; Owner: iam_owner
--

CREATE TYPE "iam"."audit_outcome" AS ENUM (
    'success',
    'failure',
    'denied'
);


ALTER TYPE "iam"."audit_outcome" OWNER TO "iam_owner";

--
-- TOC entry 931 (class 1247 OID 16636)
-- Name: identity_status; Type: TYPE; Schema: iam; Owner: iam_owner
--

CREATE TYPE "iam"."identity_status" AS ENUM (
    'active',
    'disabled',
    'pending_verification'
);


ALTER TYPE "iam"."identity_status" OWNER TO "iam_owner";

--
-- TOC entry 937 (class 1247 OID 16654)
-- Name: invitation_status; Type: TYPE; Schema: iam; Owner: iam_owner
--

CREATE TYPE "iam"."invitation_status" AS ENUM (
    'pending',
    'accepted',
    'expired',
    'revoked'
);


ALTER TYPE "iam"."invitation_status" OWNER TO "iam_owner";

--
-- TOC entry 934 (class 1247 OID 16644)
-- Name: membership_status; Type: TYPE; Schema: iam; Owner: iam_owner
--

CREATE TYPE "iam"."membership_status" AS ENUM (
    'invited',
    'active',
    'suspended',
    'revoked'
);


ALTER TYPE "iam"."membership_status" OWNER TO "iam_owner";

--
-- TOC entry 940 (class 1247 OID 16664)
-- Name: session_status; Type: TYPE; Schema: iam; Owner: iam_owner
--

CREATE TYPE "iam"."session_status" AS ENUM (
    'active',
    'revoked',
    'expired'
);


ALTER TYPE "iam"."session_status" OWNER TO "iam_owner";

--
-- TOC entry 928 (class 1247 OID 16626)
-- Name: tenant_status; Type: TYPE; Schema: iam; Owner: iam_owner
--

CREATE TYPE "iam"."tenant_status" AS ENUM (
    'active',
    'suspended',
    'pending_deletion',
    'deleted'
);


ALTER TYPE "iam"."tenant_status" OWNER TO "iam_owner";

--
-- TOC entry 302 (class 1255 OID 17268)
-- Name: current_tenant_id(); Type: FUNCTION; Schema: app_private; Owner: iam_owner
--

CREATE FUNCTION "app_private"."current_tenant_id"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'app_private', 'iam', 'public'
    AS $$
DECLARE
 v_tenant uuid; v_identity uuid; v_expires bigint; v_nonce text; v_signature text; v_secret bytea; v_payload text;
BEGIN
 v_tenant := nullif(current_setting('iam.tenant_id',true),'')::uuid;
 v_identity := nullif(current_setting('iam.identity_id',true),'')::uuid;
 v_expires := nullif(current_setting('iam.expires_at',true),'')::bigint;
 v_nonce := nullif(current_setting('iam.nonce',true),'');
 v_signature := nullif(current_setting('iam.signature',true),'');
 IF v_tenant IS NULL OR v_identity IS NULL OR v_expires IS NULL OR v_nonce IS NULL OR v_signature IS NULL THEN RETURN NULL; END IF;
 IF v_expires < extract(epoch FROM clock_timestamp())::bigint OR v_expires > extract(epoch FROM clock_timestamp())::bigint + 300 THEN RETURN NULL; END IF;
 SELECT secret INTO v_secret FROM app_private.context_keys WHERE active;
 IF v_secret IS NULL THEN RETURN NULL; END IF;
 v_payload := v_tenant::text || '|' || v_identity::text || '|' || v_expires::text || '|' || v_nonce;
 IF encode(public.hmac(convert_to(v_payload,'UTF8'),v_secret,'sha256'),'hex') <> lower(v_signature) THEN RETURN NULL; END IF;
 IF NOT EXISTS (SELECT 1 FROM iam.memberships m JOIN iam.tenants t ON t.id=m.tenant_id JOIN iam.identities i ON i.id=m.identity_id
                WHERE m.tenant_id=v_tenant AND m.identity_id=v_identity AND m.status='active' AND t.status='active' AND i.status='active') THEN RETURN NULL; END IF;
 RETURN v_tenant;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END
$$;


ALTER FUNCTION "app_private"."current_tenant_id"() OWNER TO "iam_owner";

--
-- TOC entry 287 (class 1255 OID 17274)
-- Name: reject_event_mutation(); Type: FUNCTION; Schema: audit; Owner: iam_owner
--

CREATE FUNCTION "audit"."reject_event_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog'
    AS $$ BEGIN RAISE EXCEPTION 'audit events are append-only' USING ERRCODE='55000'; END $$;


ALTER FUNCTION "audit"."reject_event_mutation"() OWNER TO "iam_owner";

--
-- TOC entry 305 (class 1255 OID 17358)
-- Name: acquire_migration_lock(); Type: FUNCTION; Schema: iam; Owner: iam_owner
--

CREATE FUNCTION "iam"."acquire_migration_lock"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$ SELECT pg_advisory_xact_lock(721347,18001) $$;


ALTER FUNCTION "iam"."acquire_migration_lock"() OWNER TO "iam_owner";

--
-- TOC entry 300 (class 1255 OID 17270)
-- Name: clear_tenant_context(); Type: FUNCTION; Schema: iam; Owner: iam_owner
--

CREATE FUNCTION "iam"."clear_tenant_context"() RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$ SELECT set_config('iam.tenant_id','',true),set_config('iam.identity_id','',true),set_config('iam.expires_at','',true),set_config('iam.nonce','',true),set_config('iam.signature','',true) $$;


ALTER FUNCTION "iam"."clear_tenant_context"() OWNER TO "iam_owner";

--
-- TOC entry 301 (class 1255 OID 17272)
-- Name: effective_permissions("uuid"); Type: FUNCTION; Schema: iam; Owner: iam_owner
--

CREATE FUNCTION "iam"."effective_permissions"("p_membership_id" "uuid") RETURNS TABLE("permission_key" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'pg_catalog', 'iam', 'app_private'
    AS $$
 SELECT DISTINCT p.permission_key
 FROM iam.memberships m
 JOIN iam.membership_roles mr ON mr.tenant_id=m.tenant_id AND mr.membership_id=m.id
 JOIN iam.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id
 JOIN iam.permissions p ON p.permission_key=rp.permission_key
 WHERE m.id=p_membership_id AND m.tenant_id=app_private.current_tenant_id() AND m.status='active'
 UNION
 SELECT DISTINCT p.permission_key
 FROM iam.memberships m
 JOIN iam.group_memberships gm ON gm.tenant_id=m.tenant_id AND gm.membership_id=m.id
 JOIN iam.group_roles gr ON gr.tenant_id=gm.tenant_id AND gr.group_id=gm.group_id
 JOIN iam.role_permissions rp ON rp.tenant_id=gr.tenant_id AND rp.role_id=gr.role_id
 JOIN iam.permissions p ON p.permission_key=rp.permission_key
 WHERE m.id=p_membership_id AND m.tenant_id=app_private.current_tenant_id() AND m.status='active'
$$;


ALTER FUNCTION "iam"."effective_permissions"("p_membership_id" "uuid") OWNER TO "iam_owner";

--
-- TOC entry 306 (class 1255 OID 17271)
-- Name: provision_membership("uuid", "text", "text", "text", "text"); Type: FUNCTION; Schema: iam; Owner: iam_owner
--

CREATE FUNCTION "iam"."provision_membership"("p_tenant_id" "uuid", "p_issuer" "text", "p_subject" "text", "p_email" "text", "p_display_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'iam', 'app_private'
    AS $$
DECLARE v_identity_id uuid; v_membership_id uuid;
BEGIN
 IF app_private.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN RAISE EXCEPTION 'tenant context mismatch' USING ERRCODE='42501'; END IF;
 INSERT INTO iam.identities(issuer,subject,email,display_name)
 VALUES(p_issuer,p_subject,p_email,p_display_name)
 ON CONFLICT(issuer,subject) DO UPDATE SET email=EXCLUDED.email,display_name=COALESCE(EXCLUDED.display_name,iam.identities.display_name),updated_at=clock_timestamp()
 RETURNING id INTO v_identity_id;
 INSERT INTO iam.memberships(tenant_id,identity_id,status,joined_at)
 VALUES(p_tenant_id,v_identity_id,'active',clock_timestamp())
 ON CONFLICT(tenant_id,identity_id) DO UPDATE SET status='active',updated_at=clock_timestamp()
 RETURNING id INTO v_membership_id;
 RETURN v_membership_id;
END
$$;


ALTER FUNCTION "iam"."provision_membership"("p_tenant_id" "uuid", "p_issuer" "text", "p_subject" "text", "p_email" "text", "p_display_name" "text") OWNER TO "iam_owner";

--
-- TOC entry 304 (class 1255 OID 17359)
-- Name: record_migration("text", "text", "text"); Type: FUNCTION; Schema: iam; Owner: iam_owner
--

CREATE FUNCTION "iam"."record_migration"("p_migration_id" "text", "p_checksum_sha256" "text", "p_source_sha" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'iam'
    AS $_$
    DECLARE
      v_existing char(64);
    BEGIN
      IF p_migration_id IS NULL OR p_migration_id !~ '^[0-9]{4}_[a-z0-9_]+$' THEN
        RAISE EXCEPTION 'invalid migration id';
      END IF;

      IF p_checksum_sha256 IS NULL OR p_checksum_sha256 !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'invalid SHA-256 checksum';
      END IF;

      IF p_source_sha IS NOT NULL
         AND p_source_sha !~ '^([0-9a-f]{40}|[0-9a-f]{64})$' THEN
        RAISE EXCEPTION 'invalid source SHA';
      END IF;

      SELECT checksum_sha256
        INTO v_existing
        FROM iam.schema_migrations
       WHERE migration_id = p_migration_id;

      IF FOUND THEN
        IF v_existing <> p_checksum_sha256 THEN
          RAISE EXCEPTION 'migration checksum mismatch for %', p_migration_id;
        END IF;
        RETURN;
      END IF;

      INSERT INTO iam.schema_migrations (
        migration_id,
        checksum_sha256,
        source_sha,
        execution_role
      )
      VALUES (
        p_migration_id,
        p_checksum_sha256,
        p_source_sha,
        session_user
      );
    END;
    $_$;


ALTER FUNCTION "iam"."record_migration"("p_migration_id" "text", "p_checksum_sha256" "text", "p_source_sha" "text") OWNER TO "iam_owner";

--
-- TOC entry 303 (class 1255 OID 17269)
-- Name: set_tenant_context("uuid", "uuid", bigint, "text", "text"); Type: FUNCTION; Schema: iam; Owner: iam_owner
--

CREATE FUNCTION "iam"."set_tenant_context"("p_tenant_id" "uuid", "p_identity_id" "uuid", "p_expires_at" bigint, "p_nonce" "text", "p_signature" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'app_private', 'iam', 'public'
    AS $$
BEGIN
 PERFORM set_config('iam.tenant_id',p_tenant_id::text,true);
 PERFORM set_config('iam.identity_id',p_identity_id::text,true);
 PERFORM set_config('iam.expires_at',p_expires_at::text,true);
 PERFORM set_config('iam.nonce',p_nonce,true);
 PERFORM set_config('iam.signature',p_signature,true);
 IF app_private.current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
   PERFORM set_config('iam.tenant_id','',true);
   PERFORM set_config('iam.identity_id','',true);
   PERFORM set_config('iam.expires_at','',true);
   PERFORM set_config('iam.nonce','',true);
   PERFORM set_config('iam.signature','',true);
   RAISE EXCEPTION 'invalid or expired tenant context' USING ERRCODE='42501';
 END IF;
END
$$;


ALTER FUNCTION "iam"."set_tenant_context"("p_tenant_id" "uuid", "p_identity_id" "uuid", "p_expires_at" bigint, "p_nonce" "text", "p_signature" "text") OWNER TO "iam_owner";

--
-- TOC entry 299 (class 1255 OID 17273)
-- Name: touch_updated_at(); Type: FUNCTION; Schema: iam; Owner: iam_owner
--

CREATE FUNCTION "iam"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog'
    AS $$ BEGIN NEW.updated_at:=clock_timestamp(); RETURN NEW; END $$;


ALTER FUNCTION "iam"."touch_updated_at"() OWNER TO "iam_owner";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- TOC entry 243 (class 1259 OID 17190)
-- Name: context_keys; Type: TABLE; Schema: app_private; Owner: iam_owner
--

CREATE TABLE "app_private"."context_keys" (
    "key_id" "text" NOT NULL,
    "secret" "bytea" NOT NULL,
    "active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "context_keys_secret_check" CHECK (("octet_length"("secret") >= 32))
);


ALTER TABLE "app_private"."context_keys" OWNER TO "iam_owner";

--
-- TOC entry 245 (class 1259 OID 17205)
-- Name: events; Type: TABLE; Schema: audit; Owner: iam_owner
--

CREATE TABLE "audit"."events" (
    "id" bigint NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "actor_identity_id" "uuid",
    "actor_membership_id" "uuid",
    "session_id" "uuid",
    "action" "text" NOT NULL,
    "outcome" "iam"."audit_outcome" NOT NULL,
    "source" "inet",
    "correlation_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "audit_actor_identity_required" CHECK ((("actor_membership_id" IS NULL) OR ("actor_identity_id" IS NOT NULL))),
    CONSTRAINT "events_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);

ALTER TABLE ONLY "audit"."events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "audit"."events" OWNER TO "iam_owner";

--
-- TOC entry 244 (class 1259 OID 17204)
-- Name: events_id_seq; Type: SEQUENCE; Schema: audit; Owner: iam_owner
--

ALTER TABLE "audit"."events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "audit"."events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 247 (class 1259 OID 17242)
-- Name: outbox; Type: TABLE; Schema: audit; Owner: iam_owner
--

CREATE TABLE "audit"."outbox" (
    "id" bigint NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "aggregate_type" "text" NOT NULL,
    "aggregate_id" "uuid" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "available_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "processed_at" timestamp with time zone,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    CONSTRAINT "outbox_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "outbox_payload_check" CHECK (("jsonb_typeof"("payload") = 'object'::"text"))
);

ALTER TABLE ONLY "audit"."outbox" FORCE ROW LEVEL SECURITY;


ALTER TABLE "audit"."outbox" OWNER TO "iam_owner";

--
-- TOC entry 246 (class 1259 OID 17241)
-- Name: outbox_id_seq; Type: SEQUENCE; Schema: audit; Owner: iam_owner
--

ALTER TABLE "audit"."outbox" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "audit"."outbox_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 237 (class 1259 OID 17049)
-- Name: access_policies; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."access_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "policy_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "effect" "text" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "rules" "jsonb" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "access_policies_effect_check" CHECK (("effect" = ANY (ARRAY['allow'::"text", 'deny'::"text"]))),
    CONSTRAINT "access_policies_rules_check" CHECK (("jsonb_typeof"("rules") = 'object'::"text"))
);

ALTER TABLE ONLY "iam"."access_policies" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."access_policies" OWNER TO "iam_owner";

--
-- TOC entry 236 (class 1259 OID 17015)
-- Name: api_keys; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "membership_id" "uuid",
    "key_prefix" "text" NOT NULL,
    "key_hash" "bytea" NOT NULL,
    "label" "text" NOT NULL,
    "scopes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "iam"."api_key_status" DEFAULT 'active'::"iam"."api_key_status" NOT NULL,
    "expires_at" timestamp with time zone,
    "last_used_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "api_keys_key_hash_check" CHECK (("octet_length"("key_hash") = 32))
);

ALTER TABLE ONLY "iam"."api_keys" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."api_keys" OWNER TO "iam_owner";

--
-- TOC entry 233 (class 1259 OID 16938)
-- Name: group_memberships; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."group_memberships" (
    "tenant_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "membership_id" "uuid" NOT NULL,
    "added_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."group_memberships" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."group_memberships" OWNER TO "iam_owner";

--
-- TOC entry 234 (class 1259 OID 16963)
-- Name: group_roles; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."group_roles" (
    "tenant_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."group_roles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."group_roles" OWNER TO "iam_owner";

--
-- TOC entry 232 (class 1259 OID 16913)
-- Name: groups; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "group_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."groups" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."groups" OWNER TO "iam_owner";

--
-- TOC entry 242 (class 1259 OID 17171)
-- Name: idempotency_keys; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."idempotency_keys" (
    "tenant_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "request_hash" "bytea" NOT NULL,
    "response_status" integer,
    "response_body" "jsonb",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    CONSTRAINT "idempotency_keys_request_hash_check" CHECK (("octet_length"("request_hash") = 32))
);

ALTER TABLE ONLY "iam"."idempotency_keys" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."idempotency_keys" OWNER TO "iam_owner";

--
-- TOC entry 225 (class 1259 OID 16739)
-- Name: identities; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."identities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "issuer" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "email" "text",
    "email_verified" boolean DEFAULT false NOT NULL,
    "display_name" "text",
    "picture_url" "text",
    "status" "iam"."identity_status" DEFAULT 'active'::"iam"."identity_status" NOT NULL,
    "last_authenticated_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "identities_email_check" CHECK ((("email" IS NULL) OR ("length"("email") <= 320))),
    CONSTRAINT "identities_issuer_check" CHECK ((("length"("issuer") >= 1) AND ("length"("issuer") <= 2048))),
    CONSTRAINT "identities_subject_check" CHECK ((("length"("subject") >= 1) AND ("length"("subject") <= 255)))
);

ALTER TABLE ONLY "iam"."identities" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."identities" OWNER TO "iam_owner";

--
-- TOC entry 226 (class 1259 OID 16763)
-- Name: identity_providers; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."identity_providers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider_key" "text" NOT NULL,
    "issuer" "text" NOT NULL,
    "authorization_url" "text",
    "token_url" "text",
    "jwks_url" "text",
    "client_id" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "configuration" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "identity_provider_no_plaintext_secrets" CHECK ((NOT ("configuration" ?| ARRAY['client_secret'::"text", 'clientSecret'::"text", 'private_key'::"text", 'privateKey'::"text", 'secret'::"text"]))),
    CONSTRAINT "identity_providers_configuration_check" CHECK (("jsonb_typeof"("configuration") = 'object'::"text"))
);

ALTER TABLE ONLY "iam"."identity_providers" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."identity_providers" OWNER TO "iam_owner";

--
-- TOC entry 238 (class 1259 OID 17082)
-- Name: invitations; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "token_hash" "bytea" NOT NULL,
    "status" "iam"."invitation_status" DEFAULT 'pending'::"iam"."invitation_status" NOT NULL,
    "invited_by_membership_id" "uuid",
    "accepted_by_identity_id" "uuid",
    "expires_at" timestamp with time zone NOT NULL,
    "accepted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "invitations_token_hash_check" CHECK (("octet_length"("token_hash") = 32))
);

ALTER TABLE ONLY "iam"."invitations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."invitations" OWNER TO "iam_owner";

--
-- TOC entry 231 (class 1259 OID 16888)
-- Name: membership_roles; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."membership_roles" (
    "tenant_id" "uuid" NOT NULL,
    "membership_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "granted_by_membership_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."membership_roles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."membership_roles" OWNER TO "iam_owner";

--
-- TOC entry 227 (class 1259 OID 16793)
-- Name: memberships; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "identity_id" "uuid" NOT NULL,
    "status" "iam"."membership_status" DEFAULT 'invited'::"iam"."membership_status" NOT NULL,
    "joined_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."memberships" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."memberships" OWNER TO "iam_owner";

--
-- TOC entry 224 (class 1259 OID 16710)
-- Name: organizations; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT 'auth0'::"text" NOT NULL,
    "external_organization_id" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "domains" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."organizations" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."organizations" OWNER TO "iam_owner";

--
-- TOC entry 228 (class 1259 OID 16822)
-- Name: permissions; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."permissions" (
    "permission_key" "text" NOT NULL,
    "description" "text" NOT NULL,
    "resource" "text" NOT NULL,
    "action" "text" NOT NULL,
    "is_sensitive" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "permissions_permission_key_check" CHECK (("permission_key" ~ '^[a-z][a-z0-9_.:-]{2,127}$'::"text"))
);


ALTER TABLE "iam"."permissions" OWNER TO "iam_owner";

--
-- TOC entry 230 (class 1259 OID 16866)
-- Name: role_permissions; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."role_permissions" (
    "tenant_id" "uuid" NOT NULL,
    "role_id" "uuid" NOT NULL,
    "permission_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."role_permissions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."role_permissions" OWNER TO "iam_owner";

--
-- TOC entry 229 (class 1259 OID 16838)
-- Name: roles; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "role_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text",
    "is_system" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "roles_role_key_check" CHECK (("role_key" ~ '^[a-z][a-z0-9_-]{1,63}$'::"text"))
);

ALTER TABLE ONLY "iam"."roles" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."roles" OWNER TO "iam_owner";

--
-- TOC entry 249 (class 1259 OID 17344)
-- Name: schema_migrations; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."schema_migrations" (
    "migration_id" "text" NOT NULL,
    "checksum_sha256" character(64) NOT NULL,
    "source_sha" "text",
    "applied_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "execution_role" "name" DEFAULT CURRENT_USER NOT NULL,
    CONSTRAINT "schema_migrations_checksum_sha256_check" CHECK (("checksum_sha256" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "iam"."schema_migrations" OWNER TO "iam_owner";

--
-- TOC entry 241 (class 1259 OID 17145)
-- Name: security_events; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."security_events" (
    "id" bigint NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "identity_id" "uuid",
    "event_type" "text" NOT NULL,
    "outcome" "iam"."audit_outcome" NOT NULL,
    "source" "inet",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "occurred_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "security_events_metadata_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text"))
);

ALTER TABLE ONLY "iam"."security_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."security_events" OWNER TO "iam_owner";

--
-- TOC entry 240 (class 1259 OID 17144)
-- Name: security_events_id_seq; Type: SEQUENCE; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."security_events" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "iam"."security_events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- TOC entry 239 (class 1259 OID 17117)
-- Name: service_accounts; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."service_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "account_key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "status" "iam"."identity_status" DEFAULT 'active'::"iam"."identity_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);

ALTER TABLE ONLY "iam"."service_accounts" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."service_accounts" OWNER TO "iam_owner";

--
-- TOC entry 235 (class 1259 OID 16983)
-- Name: sessions; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "membership_id" "uuid" NOT NULL,
    "provider_session_id" "text",
    "token_fingerprint" "bytea",
    "status" "iam"."session_status" DEFAULT 'active'::"iam"."session_status" NOT NULL,
    "ip_address" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "last_seen_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "sessions_check" CHECK (("expires_at" > "created_at")),
    CONSTRAINT "sessions_token_fingerprint_check" CHECK ((("token_fingerprint" IS NULL) OR ("octet_length"("token_fingerprint") = 32)))
);

ALTER TABLE ONLY "iam"."sessions" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."sessions" OWNER TO "iam_owner";

--
-- TOC entry 223 (class 1259 OID 16687)
-- Name: tenants; Type: TABLE; Schema: iam; Owner: iam_owner
--

CREATE TABLE "iam"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text",
    "display_name" "text" NOT NULL,
    "status" "iam"."tenant_status" DEFAULT 'active'::"iam"."tenant_status" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "tenants_display_name_check" CHECK ((("length"("btrim"("display_name")) >= 1) AND ("length"("btrim"("display_name")) <= 160))),
    CONSTRAINT "tenants_settings_check" CHECK (("jsonb_typeof"("settings") = 'object'::"text")),
    CONSTRAINT "tenants_slug_check" CHECK ((("slug" IS NULL) OR ("slug" ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'::"text")))
);

ALTER TABLE ONLY "iam"."tenants" FORCE ROW LEVEL SECURITY;


ALTER TABLE "iam"."tenants" OWNER TO "iam_owner";

--
-- TOC entry 248 (class 1259 OID 17324)
-- Name: v_effective_membership_permissions; Type: VIEW; Schema: iam; Owner: iam_owner
--

CREATE VIEW "iam"."v_effective_membership_permissions" WITH ("security_invoker"='true') AS
 SELECT "tenant_id",
    "id" AS "membership_id",
    "iam"."effective_permissions"("id") AS "permission_key"
   FROM "iam"."memberships" "m";


ALTER VIEW "iam"."v_effective_membership_permissions" OWNER TO "iam_owner";

--
-- TOC entry 3625 (class 2606 OID 17203)
-- Name: context_keys context_keys_pkey; Type: CONSTRAINT; Schema: app_private; Owner: iam_owner
--

ALTER TABLE ONLY "app_private"."context_keys"
    ADD CONSTRAINT "context_keys_pkey" PRIMARY KEY ("key_id");


--
-- TOC entry 3629 (class 2606 OID 17220)
-- Name: events events_pkey; Type: CONSTRAINT; Schema: audit; Owner: iam_owner
--

ALTER TABLE ONLY "audit"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3632 (class 2606 OID 17262)
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: audit; Owner: iam_owner
--

ALTER TABLE ONLY "audit"."outbox"
    ADD CONSTRAINT "outbox_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3602 (class 2606 OID 17072)
-- Name: access_policies access_policies_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."access_policies"
    ADD CONSTRAINT "access_policies_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3604 (class 2606 OID 17074)
-- Name: access_policies access_policies_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."access_policies"
    ADD CONSTRAINT "access_policies_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3606 (class 2606 OID 17076)
-- Name: access_policies access_policies_tenant_id_policy_key_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."access_policies"
    ADD CONSTRAINT "access_policies_tenant_id_policy_key_key" UNIQUE ("tenant_id", "policy_key");


--
-- TOC entry 3594 (class 2606 OID 17038)
-- Name: api_keys api_keys_key_prefix_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."api_keys"
    ADD CONSTRAINT "api_keys_key_prefix_key" UNIQUE ("key_prefix");


--
-- TOC entry 3596 (class 2606 OID 17034)
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3598 (class 2606 OID 17036)
-- Name: api_keys api_keys_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."api_keys"
    ADD CONSTRAINT "api_keys_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3582 (class 2606 OID 16947)
-- Name: group_memberships group_memberships_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."group_memberships"
    ADD CONSTRAINT "group_memberships_pkey" PRIMARY KEY ("tenant_id", "group_id", "membership_id");


--
-- TOC entry 3584 (class 2606 OID 16972)
-- Name: group_roles group_roles_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."group_roles"
    ADD CONSTRAINT "group_roles_pkey" PRIMARY KEY ("tenant_id", "group_id", "role_id");


--
-- TOC entry 3575 (class 2606 OID 16928)
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3577 (class 2606 OID 16932)
-- Name: groups groups_tenant_id_group_key_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."groups"
    ADD CONSTRAINT "groups_tenant_id_group_key_key" UNIQUE ("tenant_id", "group_key");


--
-- TOC entry 3579 (class 2606 OID 16930)
-- Name: groups groups_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."groups"
    ADD CONSTRAINT "groups_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3623 (class 2606 OID 17184)
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("tenant_id", "idempotency_key");


--
-- TOC entry 3540 (class 2606 OID 16762)
-- Name: identities identities_issuer_subject_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."identities"
    ADD CONSTRAINT "identities_issuer_subject_key" UNIQUE ("issuer", "subject");


--
-- TOC entry 3542 (class 2606 OID 16760)
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."identities"
    ADD CONSTRAINT "identities_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3544 (class 2606 OID 16783)
-- Name: identity_providers identity_providers_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."identity_providers"
    ADD CONSTRAINT "identity_providers_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3546 (class 2606 OID 16787)
-- Name: identity_providers identity_providers_tenant_id_issuer_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."identity_providers"
    ADD CONSTRAINT "identity_providers_tenant_id_issuer_key" UNIQUE ("tenant_id", "issuer");


--
-- TOC entry 3548 (class 2606 OID 16785)
-- Name: identity_providers identity_providers_tenant_id_provider_key_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."identity_providers"
    ADD CONSTRAINT "identity_providers_tenant_id_provider_key_key" UNIQUE ("tenant_id", "provider_key");


--
-- TOC entry 3609 (class 2606 OID 17099)
-- Name: invitations invitations_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3611 (class 2606 OID 17101)
-- Name: invitations invitations_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."invitations"
    ADD CONSTRAINT "invitations_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3572 (class 2606 OID 16897)
-- Name: membership_roles membership_roles_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."membership_roles"
    ADD CONSTRAINT "membership_roles_pkey" PRIMARY KEY ("tenant_id", "membership_id", "role_id");


--
-- TOC entry 3551 (class 2606 OID 16807)
-- Name: memberships memberships_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."memberships"
    ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3553 (class 2606 OID 16809)
-- Name: memberships memberships_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."memberships"
    ADD CONSTRAINT "memberships_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3555 (class 2606 OID 16811)
-- Name: memberships memberships_tenant_id_identity_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."memberships"
    ADD CONSTRAINT "memberships_tenant_id_identity_id_key" UNIQUE ("tenant_id", "identity_id");


--
-- TOC entry 3557 (class 2606 OID 17334)
-- Name: memberships memberships_tenant_id_identity_uq; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."memberships"
    ADD CONSTRAINT "memberships_tenant_id_identity_uq" UNIQUE ("tenant_id", "id", "identity_id");


--
-- TOC entry 3534 (class 2606 OID 16729)
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3536 (class 2606 OID 16733)
-- Name: organizations organizations_provider_external_organization_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."organizations"
    ADD CONSTRAINT "organizations_provider_external_organization_id_key" UNIQUE ("provider", "external_organization_id");


--
-- TOC entry 3538 (class 2606 OID 16731)
-- Name: organizations organizations_tenant_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."organizations"
    ADD CONSTRAINT "organizations_tenant_id_key" UNIQUE ("tenant_id");


--
-- TOC entry 3560 (class 2606 OID 16837)
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."permissions"
    ADD CONSTRAINT "permissions_pkey" PRIMARY KEY ("permission_key");


--
-- TOC entry 3570 (class 2606 OID 16877)
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("tenant_id", "role_id", "permission_key");


--
-- TOC entry 3562 (class 2606 OID 16856)
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."roles"
    ADD CONSTRAINT "roles_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3564 (class 2606 OID 16858)
-- Name: roles roles_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."roles"
    ADD CONSTRAINT "roles_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3566 (class 2606 OID 16860)
-- Name: roles roles_tenant_id_role_key_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."roles"
    ADD CONSTRAINT "roles_tenant_id_role_key_key" UNIQUE ("tenant_id", "role_key");


--
-- TOC entry 3634 (class 2606 OID 17357)
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."schema_migrations"
    ADD CONSTRAINT "schema_migrations_pkey" PRIMARY KEY ("migration_id");


--
-- TOC entry 3619 (class 2606 OID 17160)
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."security_events"
    ADD CONSTRAINT "security_events_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3613 (class 2606 OID 17134)
-- Name: service_accounts service_accounts_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."service_accounts"
    ADD CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3615 (class 2606 OID 17138)
-- Name: service_accounts service_accounts_tenant_id_account_key_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."service_accounts"
    ADD CONSTRAINT "service_accounts_tenant_id_account_key_key" UNIQUE ("tenant_id", "account_key");


--
-- TOC entry 3617 (class 2606 OID 17136)
-- Name: service_accounts service_accounts_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."service_accounts"
    ADD CONSTRAINT "service_accounts_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3589 (class 2606 OID 17002)
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."sessions"
    ADD CONSTRAINT "sessions_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3591 (class 2606 OID 17004)
-- Name: sessions sessions_tenant_id_id_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_id_key" UNIQUE ("tenant_id", "id");


--
-- TOC entry 3530 (class 2606 OID 16707)
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");


--
-- TOC entry 3532 (class 2606 OID 16709)
-- Name: tenants tenants_slug_key; Type: CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");


--
-- TOC entry 3626 (class 1259 OID 17301)
-- Name: audit_events_actor_time_idx; Type: INDEX; Schema: audit; Owner: iam_owner
--

CREATE INDEX "audit_events_actor_time_idx" ON "audit"."events" USING "btree" ("tenant_id", "actor_identity_id", "occurred_at" DESC);


--
-- TOC entry 3627 (class 1259 OID 17300)
-- Name: audit_events_tenant_time_idx; Type: INDEX; Schema: audit; Owner: iam_owner
--

CREATE INDEX "audit_events_tenant_time_idx" ON "audit"."events" USING "btree" ("tenant_id", "occurred_at" DESC);


--
-- TOC entry 3630 (class 1259 OID 17302)
-- Name: outbox_pending_idx; Type: INDEX; Schema: audit; Owner: iam_owner
--

CREATE INDEX "outbox_pending_idx" ON "audit"."outbox" USING "btree" ("available_at", "id") WHERE ("processed_at" IS NULL);


--
-- TOC entry 3600 (class 1259 OID 17298)
-- Name: access_policies_eval_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "access_policies_eval_idx" ON "iam"."access_policies" USING "btree" ("tenant_id", "enabled", "priority");


--
-- TOC entry 3592 (class 1259 OID 17295)
-- Name: api_keys_hash_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "api_keys_hash_idx" ON "iam"."api_keys" USING "btree" ("key_hash");


--
-- TOC entry 3599 (class 1259 OID 17296)
-- Name: api_keys_tenant_status_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "api_keys_tenant_status_idx" ON "iam"."api_keys" USING "btree" ("tenant_id", "status");


--
-- TOC entry 3580 (class 1259 OID 17291)
-- Name: group_memberships_membership_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "group_memberships_membership_idx" ON "iam"."group_memberships" USING "btree" ("tenant_id", "membership_id");


--
-- TOC entry 3585 (class 1259 OID 17292)
-- Name: group_roles_role_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "group_roles_role_idx" ON "iam"."group_roles" USING "btree" ("tenant_id", "role_id");


--
-- TOC entry 3621 (class 1259 OID 17303)
-- Name: idempotency_expiry_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "idempotency_expiry_idx" ON "iam"."idempotency_keys" USING "btree" ("expires_at");


--
-- TOC entry 3607 (class 1259 OID 17297)
-- Name: invitations_pending_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "invitations_pending_idx" ON "iam"."invitations" USING "btree" ("tenant_id", "lower"("email"), "expires_at") WHERE ("status" = 'pending'::"iam"."invitation_status");


--
-- TOC entry 3573 (class 1259 OID 17290)
-- Name: membership_roles_role_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "membership_roles_role_idx" ON "iam"."membership_roles" USING "btree" ("tenant_id", "role_id");


--
-- TOC entry 3549 (class 1259 OID 17286)
-- Name: memberships_identity_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "memberships_identity_idx" ON "iam"."memberships" USING "btree" ("identity_id");


--
-- TOC entry 3558 (class 1259 OID 17287)
-- Name: memberships_tenant_status_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "memberships_tenant_status_idx" ON "iam"."memberships" USING "btree" ("tenant_id", "status");


--
-- TOC entry 3568 (class 1259 OID 17289)
-- Name: role_permissions_permission_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "role_permissions_permission_idx" ON "iam"."role_permissions" USING "btree" ("permission_key");


--
-- TOC entry 3567 (class 1259 OID 17288)
-- Name: roles_tenant_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "roles_tenant_idx" ON "iam"."roles" USING "btree" ("tenant_id");


--
-- TOC entry 3620 (class 1259 OID 17299)
-- Name: security_events_tenant_time_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "security_events_tenant_time_idx" ON "iam"."security_events" USING "btree" ("tenant_id", "occurred_at" DESC);


--
-- TOC entry 3586 (class 1259 OID 17294)
-- Name: sessions_expiry_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "sessions_expiry_idx" ON "iam"."sessions" USING "btree" ("expires_at") WHERE ("status" = 'active'::"iam"."session_status");


--
-- TOC entry 3587 (class 1259 OID 17293)
-- Name: sessions_membership_status_idx; Type: INDEX; Schema: iam; Owner: iam_owner
--

CREATE INDEX "sessions_membership_status_idx" ON "iam"."sessions" USING "btree" ("tenant_id", "membership_id", "status");


--
-- TOC entry 3678 (class 2620 OID 17342)
-- Name: events audit_events_no_truncate; Type: TRIGGER; Schema: audit; Owner: iam_owner
--

CREATE TRIGGER "audit_events_no_truncate" BEFORE TRUNCATE ON "audit"."events" FOR EACH STATEMENT EXECUTE FUNCTION "audit"."reject_event_mutation"();


--
-- TOC entry 3679 (class 2620 OID 17285)
-- Name: events audit_events_no_update; Type: TRIGGER; Schema: audit; Owner: iam_owner
--

CREATE TRIGGER "audit_events_no_update" BEFORE DELETE OR UPDATE ON "audit"."events" FOR EACH ROW EXECUTE FUNCTION "audit"."reject_event_mutation"();


--
-- TOC entry 3676 (class 2620 OID 17283)
-- Name: access_policies access_policies_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "access_policies_touch" BEFORE UPDATE ON "iam"."access_policies" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3674 (class 2620 OID 17281)
-- Name: groups groups_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "groups_touch" BEFORE UPDATE ON "iam"."groups" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3670 (class 2620 OID 17277)
-- Name: identities identities_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "identities_touch" BEFORE UPDATE ON "iam"."identities" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3671 (class 2620 OID 17278)
-- Name: identity_providers identity_providers_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "identity_providers_touch" BEFORE UPDATE ON "iam"."identity_providers" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3672 (class 2620 OID 17279)
-- Name: memberships memberships_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "memberships_touch" BEFORE UPDATE ON "iam"."memberships" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3669 (class 2620 OID 17276)
-- Name: organizations organizations_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "organizations_touch" BEFORE UPDATE ON "iam"."organizations" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3673 (class 2620 OID 17280)
-- Name: roles roles_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "roles_touch" BEFORE UPDATE ON "iam"."roles" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3677 (class 2620 OID 17284)
-- Name: service_accounts service_accounts_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "service_accounts_touch" BEFORE UPDATE ON "iam"."service_accounts" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3675 (class 2620 OID 17282)
-- Name: sessions sessions_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "sessions_touch" BEFORE UPDATE ON "iam"."sessions" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3668 (class 2620 OID 17275)
-- Name: tenants tenants_touch; Type: TRIGGER; Schema: iam; Owner: iam_owner
--

CREATE TRIGGER "tenants_touch" BEFORE UPDATE ON "iam"."tenants" FOR EACH ROW EXECUTE FUNCTION "iam"."touch_updated_at"();


--
-- TOC entry 3663 (class 2606 OID 17335)
-- Name: events audit_actor_membership_identity_fk; Type: FK CONSTRAINT; Schema: audit; Owner: iam_owner
--

ALTER TABLE ONLY "audit"."events"
    ADD CONSTRAINT "audit_actor_membership_identity_fk" FOREIGN KEY ("tenant_id", "actor_membership_id", "actor_identity_id") REFERENCES "iam"."memberships"("tenant_id", "id", "identity_id") ON DELETE RESTRICT;


--
-- TOC entry 3664 (class 2606 OID 17226)
-- Name: events events_actor_identity_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: iam_owner
--

ALTER TABLE ONLY "audit"."events"
    ADD CONSTRAINT "events_actor_identity_id_fkey" FOREIGN KEY ("actor_identity_id") REFERENCES "iam"."identities"("id") ON DELETE RESTRICT;


--
-- TOC entry 3665 (class 2606 OID 17221)
-- Name: events events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: iam_owner
--

ALTER TABLE ONLY "audit"."events"
    ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3666 (class 2606 OID 17236)
-- Name: events events_tenant_id_session_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: iam_owner
--

ALTER TABLE ONLY "audit"."events"
    ADD CONSTRAINT "events_tenant_id_session_id_fkey" FOREIGN KEY ("tenant_id", "session_id") REFERENCES "iam"."sessions"("tenant_id", "id") ON DELETE RESTRICT;


--
-- TOC entry 3667 (class 2606 OID 17263)
-- Name: outbox outbox_tenant_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: iam_owner
--

ALTER TABLE ONLY "audit"."outbox"
    ADD CONSTRAINT "outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3655 (class 2606 OID 17077)
-- Name: access_policies access_policies_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."access_policies"
    ADD CONSTRAINT "access_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3653 (class 2606 OID 17039)
-- Name: api_keys api_keys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."api_keys"
    ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3654 (class 2606 OID 17044)
-- Name: api_keys api_keys_tenant_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."api_keys"
    ADD CONSTRAINT "api_keys_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "iam"."memberships"("tenant_id", "id") ON DELETE RESTRICT;


--
-- TOC entry 3646 (class 2606 OID 16958)
-- Name: group_memberships group_memberships_tenant_id_added_by_membership_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."group_memberships"
    ADD CONSTRAINT "group_memberships_tenant_id_added_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "added_by_membership_id") REFERENCES "iam"."memberships"("tenant_id", "id") ON DELETE RESTRICT;


--
-- TOC entry 3647 (class 2606 OID 16948)
-- Name: group_memberships group_memberships_tenant_id_group_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."group_memberships"
    ADD CONSTRAINT "group_memberships_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "iam"."groups"("tenant_id", "id") ON DELETE CASCADE;


--
-- TOC entry 3648 (class 2606 OID 16953)
-- Name: group_memberships group_memberships_tenant_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."group_memberships"
    ADD CONSTRAINT "group_memberships_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "iam"."memberships"("tenant_id", "id") ON DELETE CASCADE;


--
-- TOC entry 3649 (class 2606 OID 16973)
-- Name: group_roles group_roles_tenant_id_group_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."group_roles"
    ADD CONSTRAINT "group_roles_tenant_id_group_id_fkey" FOREIGN KEY ("tenant_id", "group_id") REFERENCES "iam"."groups"("tenant_id", "id") ON DELETE CASCADE;


--
-- TOC entry 3650 (class 2606 OID 16978)
-- Name: group_roles group_roles_tenant_id_role_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."group_roles"
    ADD CONSTRAINT "group_roles_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "iam"."roles"("tenant_id", "id") ON DELETE CASCADE;


--
-- TOC entry 3645 (class 2606 OID 16933)
-- Name: groups groups_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."groups"
    ADD CONSTRAINT "groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3662 (class 2606 OID 17185)
-- Name: idempotency_keys idempotency_keys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."idempotency_keys"
    ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3636 (class 2606 OID 16788)
-- Name: identity_providers identity_providers_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."identity_providers"
    ADD CONSTRAINT "identity_providers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3656 (class 2606 OID 17107)
-- Name: invitations invitations_accepted_by_identity_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."invitations"
    ADD CONSTRAINT "invitations_accepted_by_identity_id_fkey" FOREIGN KEY ("accepted_by_identity_id") REFERENCES "iam"."identities"("id") ON DELETE RESTRICT;


--
-- TOC entry 3657 (class 2606 OID 17102)
-- Name: invitations invitations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."invitations"
    ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3658 (class 2606 OID 17112)
-- Name: invitations invitations_tenant_id_invited_by_membership_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."invitations"
    ADD CONSTRAINT "invitations_tenant_id_invited_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "invited_by_membership_id") REFERENCES "iam"."memberships"("tenant_id", "id") ON DELETE RESTRICT;


--
-- TOC entry 3642 (class 2606 OID 16908)
-- Name: membership_roles membership_roles_tenant_id_granted_by_membership_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."membership_roles"
    ADD CONSTRAINT "membership_roles_tenant_id_granted_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "granted_by_membership_id") REFERENCES "iam"."memberships"("tenant_id", "id") ON DELETE RESTRICT;


--
-- TOC entry 3643 (class 2606 OID 16898)
-- Name: membership_roles membership_roles_tenant_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."membership_roles"
    ADD CONSTRAINT "membership_roles_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "iam"."memberships"("tenant_id", "id") ON DELETE CASCADE;


--
-- TOC entry 3644 (class 2606 OID 16903)
-- Name: membership_roles membership_roles_tenant_id_role_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."membership_roles"
    ADD CONSTRAINT "membership_roles_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "iam"."roles"("tenant_id", "id") ON DELETE CASCADE;


--
-- TOC entry 3637 (class 2606 OID 16817)
-- Name: memberships memberships_identity_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."memberships"
    ADD CONSTRAINT "memberships_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "iam"."identities"("id") ON DELETE RESTRICT;


--
-- TOC entry 3638 (class 2606 OID 16812)
-- Name: memberships memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."memberships"
    ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3635 (class 2606 OID 16734)
-- Name: organizations organizations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."organizations"
    ADD CONSTRAINT "organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3640 (class 2606 OID 16878)
-- Name: role_permissions role_permissions_permission_key_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."role_permissions"
    ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "iam"."permissions"("permission_key") ON DELETE RESTRICT;


--
-- TOC entry 3641 (class 2606 OID 16883)
-- Name: role_permissions role_permissions_tenant_id_role_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."role_permissions"
    ADD CONSTRAINT "role_permissions_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "iam"."roles"("tenant_id", "id") ON DELETE CASCADE;


--
-- TOC entry 3639 (class 2606 OID 16861)
-- Name: roles roles_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."roles"
    ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3660 (class 2606 OID 17166)
-- Name: security_events security_events_identity_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."security_events"
    ADD CONSTRAINT "security_events_identity_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "iam"."identities"("id") ON DELETE RESTRICT;


--
-- TOC entry 3661 (class 2606 OID 17161)
-- Name: security_events security_events_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."security_events"
    ADD CONSTRAINT "security_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3659 (class 2606 OID 17139)
-- Name: service_accounts service_accounts_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."service_accounts"
    ADD CONSTRAINT "service_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3651 (class 2606 OID 17005)
-- Name: sessions sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "iam"."tenants"("id") ON DELETE RESTRICT;


--
-- TOC entry 3652 (class 2606 OID 17010)
-- Name: sessions sessions_tenant_id_membership_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: iam_owner
--

ALTER TABLE ONLY "iam"."sessions"
    ADD CONSTRAINT "sessions_tenant_id_membership_id_fkey" FOREIGN KEY ("tenant_id", "membership_id") REFERENCES "iam"."memberships"("tenant_id", "id") ON DELETE RESTRICT;


--
-- TOC entry 3846 (class 0 OID 17205)
-- Dependencies: 245
-- Name: events; Type: ROW SECURITY; Schema: audit; Owner: iam_owner
--

ALTER TABLE "audit"."events" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3887 (class 3256 OID 17375)
-- Name: events iam_owner_access; Type: POLICY; Schema: audit; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "audit"."events" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3888 (class 3256 OID 17376)
-- Name: outbox iam_owner_access; Type: POLICY; Schema: audit; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "audit"."outbox" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3847 (class 0 OID 17242)
-- Dependencies: 247
-- Name: outbox; Type: ROW SECURITY; Schema: audit; Owner: iam_owner
--

ALTER TABLE "audit"."outbox" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3872 (class 3256 OID 17343)
-- Name: outbox outbox_app_insert; Type: POLICY; Schema: audit; Owner: iam_owner
--

CREATE POLICY "outbox_app_insert" ON "audit"."outbox" FOR INSERT TO "iam_app_runtime" WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3867 (class 3256 OID 17322)
-- Name: events tenant_scope; Type: POLICY; Schema: audit; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "audit"."events" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3868 (class 3256 OID 17323)
-- Name: outbox tenant_scope; Type: POLICY; Schema: audit; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "audit"."outbox" TO "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3841 (class 0 OID 17049)
-- Dependencies: 237
-- Name: access_policies; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."access_policies" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3840 (class 0 OID 17015)
-- Dependencies: 236
-- Name: api_keys; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."api_keys" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3837 (class 0 OID 16938)
-- Dependencies: 233
-- Name: group_memberships; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."group_memberships" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3838 (class 0 OID 16963)
-- Dependencies: 234
-- Name: group_roles; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."group_roles" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3836 (class 0 OID 16913)
-- Dependencies: 232
-- Name: groups; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."groups" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3882 (class 3256 OID 17370)
-- Name: access_policies iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."access_policies" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3881 (class 3256 OID 17369)
-- Name: api_keys iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."api_keys" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3878 (class 3256 OID 17366)
-- Name: group_memberships iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."group_memberships" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3879 (class 3256 OID 17367)
-- Name: group_roles iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."group_roles" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3877 (class 3256 OID 17365)
-- Name: groups iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."groups" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3886 (class 3256 OID 17374)
-- Name: idempotency_keys iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."idempotency_keys" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3870 (class 3256 OID 17330)
-- Name: identities iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."identities" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3874 (class 3256 OID 17361)
-- Name: identity_providers iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."identity_providers" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3883 (class 3256 OID 17371)
-- Name: invitations iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."invitations" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3876 (class 3256 OID 17364)
-- Name: membership_roles iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."membership_roles" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3871 (class 3256 OID 17331)
-- Name: memberships iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."memberships" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3873 (class 3256 OID 17360)
-- Name: organizations iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."organizations" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3855 (class 3256 OID 17363)
-- Name: role_permissions iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."role_permissions" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3875 (class 3256 OID 17362)
-- Name: roles iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."roles" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3885 (class 3256 OID 17373)
-- Name: security_events iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."security_events" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3884 (class 3256 OID 17372)
-- Name: service_accounts iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."service_accounts" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3880 (class 3256 OID 17368)
-- Name: sessions iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."sessions" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3869 (class 3256 OID 17329)
-- Name: tenants iam_owner_access; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "iam_owner_access" ON "iam"."tenants" TO "iam_owner" USING (true) WITH CHECK (true);


--
-- TOC entry 3845 (class 0 OID 17171)
-- Dependencies: 242
-- Name: idempotency_keys; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."idempotency_keys" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3830 (class 0 OID 16739)
-- Dependencies: 225
-- Name: identities; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."identities" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3831 (class 0 OID 16763)
-- Dependencies: 226
-- Name: identity_providers; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."identity_providers" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3850 (class 3256 OID 17306)
-- Name: identities identity_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "identity_scope" ON "iam"."identities" TO "iam_app_runtime", "iam_worker" USING ((EXISTS ( SELECT 1
   FROM "iam"."memberships" "m"
  WHERE (("m"."identity_id" = "identities"."id") AND ("m"."tenant_id" = "app_private"."current_tenant_id"()))))) WITH CHECK (true);


--
-- TOC entry 3842 (class 0 OID 17082)
-- Dependencies: 238
-- Name: invitations; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."invitations" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3835 (class 0 OID 16888)
-- Dependencies: 231
-- Name: membership_roles; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."membership_roles" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3832 (class 0 OID 16793)
-- Dependencies: 227
-- Name: memberships; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."memberships" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3829 (class 0 OID 16710)
-- Dependencies: 224
-- Name: organizations; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."organizations" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3834 (class 0 OID 16866)
-- Dependencies: 230
-- Name: role_permissions; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."role_permissions" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3833 (class 0 OID 16838)
-- Dependencies: 229
-- Name: roles; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."roles" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3844 (class 0 OID 17145)
-- Dependencies: 241
-- Name: security_events; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."security_events" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3843 (class 0 OID 17117)
-- Dependencies: 239
-- Name: service_accounts; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."service_accounts" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3839 (class 0 OID 16983)
-- Dependencies: 235
-- Name: sessions; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."sessions" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3862 (class 3256 OID 17317)
-- Name: access_policies tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."access_policies" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3861 (class 3256 OID 17316)
-- Name: api_keys tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."api_keys" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3858 (class 3256 OID 17313)
-- Name: group_memberships tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."group_memberships" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3859 (class 3256 OID 17314)
-- Name: group_roles tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."group_roles" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3857 (class 3256 OID 17312)
-- Name: groups tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."groups" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3866 (class 3256 OID 17321)
-- Name: idempotency_keys tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."idempotency_keys" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3851 (class 3256 OID 17307)
-- Name: identity_providers tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."identity_providers" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3863 (class 3256 OID 17318)
-- Name: invitations tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."invitations" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3856 (class 3256 OID 17311)
-- Name: membership_roles tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."membership_roles" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3852 (class 3256 OID 17308)
-- Name: memberships tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."memberships" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3849 (class 3256 OID 17305)
-- Name: organizations tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."organizations" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3854 (class 3256 OID 17310)
-- Name: role_permissions tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."role_permissions" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3853 (class 3256 OID 17309)
-- Name: roles tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."roles" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3865 (class 3256 OID 17320)
-- Name: security_events tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."security_events" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3864 (class 3256 OID 17319)
-- Name: service_accounts tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."service_accounts" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3860 (class 3256 OID 17315)
-- Name: sessions tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."sessions" TO "iam_app_runtime", "iam_worker" USING (("tenant_id" = "app_private"."current_tenant_id"())) WITH CHECK (("tenant_id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3848 (class 3256 OID 17304)
-- Name: tenants tenant_scope; Type: POLICY; Schema: iam; Owner: iam_owner
--

CREATE POLICY "tenant_scope" ON "iam"."tenants" TO "iam_app_runtime", "iam_worker" USING (("id" = "app_private"."current_tenant_id"())) WITH CHECK (("id" = "app_private"."current_tenant_id"()));


--
-- TOC entry 3828 (class 0 OID 16687)
-- Dependencies: 223
-- Name: tenants; Type: ROW SECURITY; Schema: iam; Owner: iam_owner
--

ALTER TABLE "iam"."tenants" ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 3894 (class 0 OID 0)
-- Dependencies: 7
-- Name: SCHEMA "app_private"; Type: ACL; Schema: -; Owner: iam_owner
--

GRANT USAGE ON SCHEMA "app_private" TO "iam_app_runtime";
GRANT USAGE ON SCHEMA "app_private" TO "iam_worker";


--
-- TOC entry 3895 (class 0 OID 0)
-- Dependencies: 8
-- Name: SCHEMA "audit"; Type: ACL; Schema: -; Owner: iam_owner
--

GRANT USAGE ON SCHEMA "audit" TO "iam_app_runtime";
GRANT USAGE ON SCHEMA "audit" TO "iam_worker";


--
-- TOC entry 3896 (class 0 OID 0)
-- Dependencies: 9
-- Name: SCHEMA "iam"; Type: ACL; Schema: -; Owner: iam_owner
--

GRANT USAGE ON SCHEMA "iam" TO "iam_app_runtime";
GRANT USAGE ON SCHEMA "iam" TO "iam_worker";
GRANT USAGE ON SCHEMA "iam" TO "iam_migrator";


--
-- TOC entry 3897 (class 0 OID 0)
-- Dependencies: 302
-- Name: FUNCTION "current_tenant_id"(); Type: ACL; Schema: app_private; Owner: iam_owner
--

REVOKE ALL ON FUNCTION "app_private"."current_tenant_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app_private"."current_tenant_id"() TO "iam_app_runtime";
GRANT ALL ON FUNCTION "app_private"."current_tenant_id"() TO "iam_worker";


--
-- TOC entry 3898 (class 0 OID 0)
-- Dependencies: 305
-- Name: FUNCTION "acquire_migration_lock"(); Type: ACL; Schema: iam; Owner: iam_owner
--

REVOKE ALL ON FUNCTION "iam"."acquire_migration_lock"() FROM PUBLIC;
GRANT ALL ON FUNCTION "iam"."acquire_migration_lock"() TO "iam_migrator";


--
-- TOC entry 3899 (class 0 OID 0)
-- Dependencies: 300
-- Name: FUNCTION "clear_tenant_context"(); Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT ALL ON FUNCTION "iam"."clear_tenant_context"() TO "iam_app_runtime";
GRANT ALL ON FUNCTION "iam"."clear_tenant_context"() TO "iam_worker";


--
-- TOC entry 3900 (class 0 OID 0)
-- Dependencies: 301
-- Name: FUNCTION "effective_permissions"("p_membership_id" "uuid"); Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT ALL ON FUNCTION "iam"."effective_permissions"("p_membership_id" "uuid") TO "iam_app_runtime";
GRANT ALL ON FUNCTION "iam"."effective_permissions"("p_membership_id" "uuid") TO "iam_worker";


--
-- TOC entry 3901 (class 0 OID 0)
-- Dependencies: 306
-- Name: FUNCTION "provision_membership"("p_tenant_id" "uuid", "p_issuer" "text", "p_subject" "text", "p_email" "text", "p_display_name" "text"); Type: ACL; Schema: iam; Owner: iam_owner
--

REVOKE ALL ON FUNCTION "iam"."provision_membership"("p_tenant_id" "uuid", "p_issuer" "text", "p_subject" "text", "p_email" "text", "p_display_name" "text") FROM PUBLIC;


--
-- TOC entry 3902 (class 0 OID 0)
-- Dependencies: 304
-- Name: FUNCTION "record_migration"("p_migration_id" "text", "p_checksum_sha256" "text", "p_source_sha" "text"); Type: ACL; Schema: iam; Owner: iam_owner
--

REVOKE ALL ON FUNCTION "iam"."record_migration"("p_migration_id" "text", "p_checksum_sha256" "text", "p_source_sha" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "iam"."record_migration"("p_migration_id" "text", "p_checksum_sha256" "text", "p_source_sha" "text") TO "iam_migrator";


--
-- TOC entry 3903 (class 0 OID 0)
-- Dependencies: 303
-- Name: FUNCTION "set_tenant_context"("p_tenant_id" "uuid", "p_identity_id" "uuid", "p_expires_at" bigint, "p_nonce" "text", "p_signature" "text"); Type: ACL; Schema: iam; Owner: iam_owner
--

REVOKE ALL ON FUNCTION "iam"."set_tenant_context"("p_tenant_id" "uuid", "p_identity_id" "uuid", "p_expires_at" bigint, "p_nonce" "text", "p_signature" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "iam"."set_tenant_context"("p_tenant_id" "uuid", "p_identity_id" "uuid", "p_expires_at" bigint, "p_nonce" "text", "p_signature" "text") TO "iam_app_runtime";
GRANT ALL ON FUNCTION "iam"."set_tenant_context"("p_tenant_id" "uuid", "p_identity_id" "uuid", "p_expires_at" bigint, "p_nonce" "text", "p_signature" "text") TO "iam_worker";


--
-- TOC entry 3904 (class 0 OID 0)
-- Dependencies: 245
-- Name: TABLE "events"; Type: ACL; Schema: audit; Owner: iam_owner
--

GRANT SELECT,INSERT ON TABLE "audit"."events" TO "iam_app_runtime";


--
-- TOC entry 3905 (class 0 OID 0)
-- Dependencies: 244
-- Name: SEQUENCE "events_id_seq"; Type: ACL; Schema: audit; Owner: iam_owner
--

GRANT SELECT,USAGE ON SEQUENCE "audit"."events_id_seq" TO "iam_app_runtime";
GRANT SELECT,USAGE ON SEQUENCE "audit"."events_id_seq" TO "iam_worker";


--
-- TOC entry 3906 (class 0 OID 0)
-- Dependencies: 247
-- Name: TABLE "outbox"; Type: ACL; Schema: audit; Owner: iam_owner
--

GRANT SELECT,INSERT,UPDATE ON TABLE "audit"."outbox" TO "iam_worker";
GRANT INSERT ON TABLE "audit"."outbox" TO "iam_app_runtime";


--
-- TOC entry 3907 (class 0 OID 0)
-- Dependencies: 246
-- Name: SEQUENCE "outbox_id_seq"; Type: ACL; Schema: audit; Owner: iam_owner
--

GRANT SELECT,USAGE ON SEQUENCE "audit"."outbox_id_seq" TO "iam_app_runtime";
GRANT SELECT,USAGE ON SEQUENCE "audit"."outbox_id_seq" TO "iam_worker";


--
-- TOC entry 3908 (class 0 OID 0)
-- Dependencies: 237
-- Name: TABLE "access_policies"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."access_policies" TO "iam_app_runtime";


--
-- TOC entry 3909 (class 0 OID 0)
-- Dependencies: 236
-- Name: TABLE "api_keys"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,UPDATE ON TABLE "iam"."api_keys" TO "iam_app_runtime";


--
-- TOC entry 3910 (class 0 OID 0)
-- Dependencies: 233
-- Name: TABLE "group_memberships"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."group_memberships" TO "iam_app_runtime";


--
-- TOC entry 3911 (class 0 OID 0)
-- Dependencies: 234
-- Name: TABLE "group_roles"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."group_roles" TO "iam_app_runtime";


--
-- TOC entry 3912 (class 0 OID 0)
-- Dependencies: 232
-- Name: TABLE "groups"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."groups" TO "iam_app_runtime";


--
-- TOC entry 3913 (class 0 OID 0)
-- Dependencies: 242
-- Name: TABLE "idempotency_keys"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."idempotency_keys" TO "iam_app_runtime";


--
-- TOC entry 3914 (class 0 OID 0)
-- Dependencies: 225
-- Name: TABLE "identities"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."identities" TO "iam_app_runtime";


--
-- TOC entry 3915 (class 0 OID 0)
-- Dependencies: 226
-- Name: TABLE "identity_providers"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."identity_providers" TO "iam_app_runtime";


--
-- TOC entry 3916 (class 0 OID 0)
-- Dependencies: 238
-- Name: TABLE "invitations"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."invitations" TO "iam_app_runtime";


--
-- TOC entry 3917 (class 0 OID 0)
-- Dependencies: 231
-- Name: TABLE "membership_roles"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."membership_roles" TO "iam_app_runtime";


--
-- TOC entry 3918 (class 0 OID 0)
-- Dependencies: 227
-- Name: TABLE "memberships"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."memberships" TO "iam_app_runtime";


--
-- TOC entry 3919 (class 0 OID 0)
-- Dependencies: 224
-- Name: TABLE "organizations"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."organizations" TO "iam_app_runtime";


--
-- TOC entry 3920 (class 0 OID 0)
-- Dependencies: 228
-- Name: TABLE "permissions"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."permissions" TO "iam_app_runtime";
GRANT SELECT ON TABLE "iam"."permissions" TO "iam_worker";


--
-- TOC entry 3921 (class 0 OID 0)
-- Dependencies: 230
-- Name: TABLE "role_permissions"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."role_permissions" TO "iam_app_runtime";


--
-- TOC entry 3922 (class 0 OID 0)
-- Dependencies: 229
-- Name: TABLE "roles"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."roles" TO "iam_app_runtime";


--
-- TOC entry 3923 (class 0 OID 0)
-- Dependencies: 249
-- Name: TABLE "schema_migrations"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."schema_migrations" TO "iam_migrator";


--
-- TOC entry 3924 (class 0 OID 0)
-- Dependencies: 241
-- Name: TABLE "security_events"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."security_events" TO "iam_app_runtime";


--
-- TOC entry 3925 (class 0 OID 0)
-- Dependencies: 240
-- Name: SEQUENCE "security_events_id_seq"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,USAGE ON SEQUENCE "iam"."security_events_id_seq" TO "iam_app_runtime";
GRANT SELECT,USAGE ON SEQUENCE "iam"."security_events_id_seq" TO "iam_worker";


--
-- TOC entry 3926 (class 0 OID 0)
-- Dependencies: 239
-- Name: TABLE "service_accounts"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."service_accounts" TO "iam_app_runtime";


--
-- TOC entry 3927 (class 0 OID 0)
-- Dependencies: 235
-- Name: TABLE "sessions"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."sessions" TO "iam_app_runtime";


--
-- TOC entry 3928 (class 0 OID 0)
-- Dependencies: 223
-- Name: TABLE "tenants"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "iam"."tenants" TO "iam_app_runtime";


--
-- TOC entry 3929 (class 0 OID 0)
-- Dependencies: 248
-- Name: TABLE "v_effective_membership_permissions"; Type: ACL; Schema: iam; Owner: iam_owner
--

GRANT SELECT ON TABLE "iam"."v_effective_membership_permissions" TO "iam_app_runtime";


-- Completed on 2026-11-05 03:46:02

--
-- PostgreSQL database dump complete
--

\unrestrict BTtOBzwWrKDmVJdcDohRkbkfHhjmYFDz9yewOtmlGZApmjt9EE8mJFWj6HjlsBx

