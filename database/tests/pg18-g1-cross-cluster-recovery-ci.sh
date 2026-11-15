#!/usr/bin/env bash
# PEOS G1: isolated synthetic globals/data/ACL/RLS restore between two PG18 Docker clusters.
set -Eeuo pipefail
umask 077
: "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT"
if [[ ! "$GITHUB_RUN_ID" =~ ^[0-9]+$ || ! "$GITHUB_RUN_ATTEMPT" =~ ^[0-9]+$ ]]; then
  echo BLOCKED_G1_INVALID_RUN_ID >&2; exit 2
fi
for binary in docker openssl mktemp grep; do command -v "$binary" >/dev/null || exit 127; done
source="peos-g1-src-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
target="peos-g1-dst-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
db="peos_g1_synthetic"
scratch="$(mktemp -d)"
source_started=0
target_started=0
cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$source_started" == 1 ]]; then docker rm -f "$source" >/dev/null 2>&1 || status=91; fi
  if [[ "$target_started" == 1 ]]; then docker rm -f "$target" >/dev/null 2>&1 || status=92; fi
  if docker container inspect "$source" >/dev/null 2>&1 ||
     docker container inspect "$target" >/dev/null 2>&1; then status=93; fi
  rm -rf "$scratch"
  if [[ "$status" == 0 ]]; then
    echo PASS_G1_PG18_CROSS_CLUSTER_CLEANUP
  else
    echo BLOCKED_G1_PG18_CROSS_CLUSTER_CLEANUP >&2
  fi
  exit "$status"
}
trap cleanup EXIT
# Network-disabled Docker instances; separate PostgreSQL clusters/data volumes.
srcpass="$(openssl rand -hex 32)"
dstpass="$(openssl rand -hex 32)"
docker run -d --name "$source" --network none \
  -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD="$srcpass" postgres:18 >/dev/null
source_started=1
docker run -d --name "$target" --network none \
  -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres -e POSTGRES_PASSWORD="$dstpass" postgres:18 >/dev/null
target_started=1
unset srcpass dstpass
for container in "$source" "$target"; do
  # The official postgres:18 entrypoint briefly starts a temporary server
  # during initdb before shutting it down and starting the final server.
  # pg_isready alone can succeed in that temporary window, then a following
  # CREATE DATABASE races the restart with "database system is starting up".
  # Wait for the entrypoint's final-start marker AND a real SQL/version probe.
  ready=0
  for i in $(seq 1 90); do
    if docker logs "$container" 2>&1 |
         grep -Fq 'PostgreSQL init process complete; ready for start up.' &&
       docker exec "$container" pg_isready -q -U postgres -d postgres; then
      actual_version="$(docker exec "$container" psql -X -U postgres -d postgres -Atqc "SELECT current_setting('server_version_num')" 2>/dev/null || : )"
      if [[ "$actual_version" =~ ^18[0-9]{4}$ ]]; then ready=1; break; fi
    fi
    sleep .5
  done
  if [[ "$ready" != 1 ]]; then echo BLOCKED_G1_DOCKER_PG18_FINAL_STARTUP >&2; exit 3; fi
done
src() { docker exec -i "$source" psql -X -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
dst() { docker exec -i "$target" psql -X -U postgres -d "$db" -v ON_ERROR_STOP=1 "$@"; }
docker exec "$source" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db"
src -q <<'SQL'
CREATE ROLE g1_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE ROLE g1_reader LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
CREATE ROLE g1_runtime NOLOGIN INHERIT NOSUPERUSER NOBYPASSRLS;
CREATE ROLE g1_runtime_login LOGIN INHERIT NOSUPERUSER NOBYPASSRLS;
GRANT g1_runtime TO g1_runtime_login WITH ADMIN FALSE, INHERIT TRUE, SET FALSE;
CREATE SCHEMA g1_iam;
REVOKE ALL ON SCHEMA g1_iam FROM PUBLIC;
GRANT USAGE ON SCHEMA g1_iam TO g1_reader;
CREATE TABLE g1_iam.synthetic_data(id bigint PRIMARY KEY, synthetic_label text NOT NULL);
INSERT INTO g1_iam.synthetic_data VALUES (1,'G1_SYNTHETIC_ORIGINAL'),(2,'G1_SYNTHETIC_BACKUP');
ALTER TABLE g1_iam.synthetic_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE g1_iam.synthetic_data FORCE ROW LEVEL SECURITY;
CREATE POLICY g1_denied ON g1_iam.synthetic_data FOR SELECT TO g1_reader USING (false);
GRANT MAINTAIN ON g1_iam.synthetic_data TO g1_reader;
SQL
baseline="$(src -Atc "SELECT md5(string_agg(id::text||':'||synthetic_label,',' ORDER BY id)) FROM g1_iam.synthetic_data")"
test -n "$baseline"
docker exec "$source" pg_dumpall --globals-only --no-role-passwords -U postgres >"$scratch/globals.sql"
docker exec "$source" pg_dump -U postgres -d "$db" -Fc >"$scratch/data.dump"
test -s "$scratch/globals.sql" && test -s "$scratch/data.dump"
grep -Fq 'g1_runtime_login' "$scratch/globals.sql"
echo PASS_G1_PG18_CROSS_CLUSTER_BACKUP
src -qc "UPDATE g1_iam.synthetic_data SET synthetic_label='G1_SYNTHETIC_CHANGED' WHERE id=1"
changed="$(src -Atc "SELECT md5(string_agg(id::text||':'||synthetic_label,',' ORDER BY id)) FROM g1_iam.synthetic_data")"
if [[ "$baseline" == "$changed" ]]; then echo BLOCKED_G1_COMMIT_NOT_OBSERVED >&2; exit 4; fi
before="$(docker exec "$target" psql -X -U postgres -d postgres -Atc "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'g1_%'")"
if [[ "$before" != 0 ]]; then echo BLOCKED_G1_TARGET_ROLE_COLLISION >&2; exit 5; fi
# Restore only the four synthetic roles/membership from the globals backup.
# Never replay the built-in cluster/bootstrap principal on a different cluster.
grep -E '^(CREATE ROLE ("?)g1_|ALTER ROLE ("?)g1_|GRANT ("?)g1_)' "$scratch/globals.sql" >"$scratch/synthetic_globals.sql"
count="$(grep -Ec '^CREATE ROLE ("?)g1_' "$scratch/synthetic_globals.sql")"
if [[ "$count" != 4 ]] || ! grep -Eq '^GRANT ("?)g1_runtime("?) TO ' "$scratch/synthetic_globals.sql"; then
  echo BLOCKED_G1_GLOBALS_SYNTHETIC_ALLOWLIST >&2; exit 6
fi
docker exec -i "$target" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  <"$scratch/synthetic_globals.sql" >"$scratch/global.log" 2>"$scratch/global.err" || {
    grep -E 'ERROR:|FATAL:' "$scratch/global.err" | head -n 2 | sed -E 's/(PASSWORD|password)[^ ]*/[REDACTED]/g' >&2 || true
    echo BLOCKED_G1_GLOBAL_RESTORE >&2; exit 6;
  }
docker exec "$target" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -c "CREATE DATABASE $db"
docker exec -i "$target" pg_restore -U postgres -d "$db" --exit-on-error --single-transaction \
  <"$scratch/data.dump" >"$scratch/restore.log" 2>"$scratch/restore.err" || {
    echo BLOCKED_G1_ARCHIVE_RESTORE >&2; exit 7;
  }
# Three separate catalog classes: data, global role topology and object grants/RLS/owner.
restored="$(dst -Atc "SELECT md5(string_agg(id::text||':'||synthetic_label,',' ORDER BY id)) FROM g1_iam.synthetic_data")"
contract="$(dst -Atc "SELECT concat_ws('|',
(SELECT count(*) FROM pg_roles WHERE rolname IN ('g1_owner','g1_reader','g1_runtime','g1_runtime_login')),
(SELECT rolcanlogin::text||':'||rolinherit::text||':'||rolbypassrls::text FROM pg_roles WHERE rolname='g1_reader'),
(SELECT rolcanlogin::text||':'||rolinherit::text||':'||rolbypassrls::text FROM pg_roles WHERE rolname='g1_runtime_login'),
(SELECT admin_option::text||':'||inherit_option::text||':'||set_option::text FROM pg_auth_members m JOIN pg_roles u ON u.oid=m.member JOIN pg_roles v ON v.oid=m.roleid WHERE u.rolname='g1_runtime_login' AND v.rolname='g1_runtime'),
(SELECT count(*) FROM pg_policies WHERE schemaname='g1_iam' AND policyname='g1_denied'),
(SELECT relforcerowsecurity FROM pg_class WHERE oid='g1_iam.synthetic_data'::regclass),
has_schema_privilege('g1_reader','g1_iam','USAGE'),
has_table_privilege('g1_reader','g1_iam.synthetic_data','MAINTAIN'),
has_table_privilege('g1_reader','g1_iam.synthetic_data','SELECT'),
(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='g1_iam.synthetic_data'::regclass))")"
if [[ "$restored" != "$baseline" || "$restored" == "$changed" ||
      "$contract" != '4|true:false:false|true:true:false|false:true:false|1|t|t|t|f|postgres' ]]; then
  echo "G1_SYNTHETIC_DATA_EQUAL=$([[ "$restored" == "$baseline" ]] && echo true || echo false)" >&2
  echo "G1_SYNTHETIC_ROLE_ACL_RLS_CONTRACT=$contract" >&2
  echo BLOCKED_G1_CROSS_CLUSTER_RESTORE_MISMATCH >&2; exit 8
fi
echo PASS_G1_PG18_CROSS_CLUSTER_RESTORE_GLOBALS_DATA_RLS_ACL_OWNER
echo REVIEW_REQUIRED_SYNTHETIC_ONLY_NEON_RECOVERY_NOT_ATTESTED
