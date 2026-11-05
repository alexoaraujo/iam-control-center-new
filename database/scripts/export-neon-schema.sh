#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Exporta DDL dos schemas IAM e declara a dependência pgcrypto.
# Não exporta linhas de tabelas nem objetos de aplicação do schema public.
# Requer pg_dump/psql 18+ para compatibilidade com PostgreSQL 18 da origem.
: "${PGHOST:?Defina PGHOST para o endpoint Neon aprovado}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=iam_database}"
: "${PGUSER:?Defina PGUSER para uma role autorizada a ler o catálogo}"
: "${PGSSLMODE:=require}"
: "${PGPASSWORD:?Defina PGPASSWORD a partir da credencial protegida}"

for cmd in pg_dump psql sha256sum; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "ERRO: $cmd não encontrado." >&2
    exit 127
  }
done

client_major="$(pg_dump --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
if [[ ! "$client_major" =~ ^[0-9]+$ ]] || (( client_major < 18 )); then
  echo "ERRO: pg_dump 18 ou superior é obrigatório." >&2
  exit 2
fi

out="${1:-iam_database_schema.sql}"
tmp="${out}.tmp"
dump_tmp="${out}.pg_dump.tmp"
if [[ -e "$out" || -e "$tmp" || -e "$dump_tmp" ]]; then
  echo "ERRO: arquivo de saída/temporário já existe; nada será sobrescrito: $out" >&2
  exit 3
fi
trap 'rm -f "$tmp" "$dump_tmp"' EXIT

export PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE PGPASSWORD

# Diagnóstico não sensível: identifica a role efetiva e separa cada etapa
# para localizar falhas de autorização sem ampliar privilégios.
echo "[schema-export] checking connection identity and schema usage"
psql -X --no-password -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT current_user || '|' || session_user || '|app_private_usage=' || has_schema_privilege(current_user, 'app_private', 'USAGE') || '|app_private_create=' || has_schema_privilege(current_user, 'app_private', 'CREATE');"

# --extension isolado não garante dependências transitivas no pg_dump.
# Portanto, validar pgcrypto na origem e emitir seu CREATE EXTENSION
# explicitamente antes do DDL que referencia public.hmac(...).
echo "[schema-export] checking pgcrypto extension metadata"
extension_meta="$(psql -X --no-password -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT e.extversion || '|' || n.nspname
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'pgcrypto';")"
if [[ -z "$extension_meta" || "$extension_meta" != *"|public" ]]; then
  echo "ERRO: pgcrypto não está instalada no schema public da origem; export cancelado." >&2
  exit 4
fi
printf 'Dependência confirmada: pgcrypto %s\n' "${extension_meta%%|*}"

# Fail closed se o catálogo da origem não apresentar o hardening esperado.
echo "[schema-export] checking hardened partial index metadata"
index_meta="$(psql -X --no-password -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT pg_get_indexdef(to_regclass('app_private.context_keys_one_active_idx')::oid)
      WHERE to_regclass('app_private.context_keys_one_active_idx') IS NOT NULL;")"
if [[ "$index_meta" != *"UNIQUE INDEX context_keys_one_active_idx"* || "$index_meta" != *"WHERE (active IS TRUE)"* ]]; then
  echo "ERRO: índice parcial único pós-hardening ausente ou divergente na origem." >&2
  exit 5
fi

echo "[schema-export] checking hardened function configuration"
function_meta="$(psql -X --no-password -v ON_ERROR_STOP=1 -Atq \
  -c "SELECT array_to_string(p.proconfig, ', ')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app_private'
        AND p.proname = 'current_tenant_id'
        AND p.prokind = 'f';")"
if [[ "$function_meta" != *"search_path=pg_catalog, app_private, iam"* ]]; then
  echo "ERRO: search_path pós-hardening de app_private.current_tenant_id() ausente ou divergente." >&2
  exit 6
fi
printf 'Hardening confirmado: índice parcial único e search_path restrito.\n'

pg_dump \
  --no-password \
  --format=plain \
  --schema-only \
  --quote-all-identifiers \
  --verbose \
  --schema=iam \
  --schema=audit \
  --schema=app_private \
  --file="$dump_tmp"

test -s "$dump_tmp"

# pg_dump precisa transportar o índice e a configuração da função; não basta
# confirmar esses objetos no catálogo da origem.
if ! grep -Fq 'context_keys_one_active_idx' "$dump_tmp"; then
  echo "ERRO: pg_dump não incluiu context_keys_one_active_idx; export descartado." >&2
  exit 7
fi
if ! grep -Fq 'current_tenant_id' "$dump_tmp" || ! grep -Fq "search_path TO 'pg_catalog', 'app_private', 'iam'" "$dump_tmp"; then
  echo "ERRO: pg_dump não incluiu o search_path hardened de current_tenant_id(); export descartado." >&2
  exit 8
fi

{
  printf '%s\n' '-- Required extension dependency (not application objects from public).' \
    'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;' ''
  cat "$dump_tmp"
} > "$tmp"

test -s "$tmp"
if ! grep -Fq 'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;' "$tmp" ||
   ! grep -Fq 'context_keys_one_active_idx' "$tmp"; then
  echo "ERRO: validação final do dump falhou; arquivo não será publicado." >&2
  exit 9
fi
mv "$tmp" "$out"
rm -f "$dump_tmp"
trap - EXIT

sha256sum "$out"
printf 'Export DDL concluído: %s\n' "$out"
printf 'Escopo: schemas iam/audit/app_private + dependência pgcrypto em public; sem dados de tabelas.\n'
printf 'Revisar compatibilidade da extensão, roles, ownership, ACLs e ordem de restore antes de aplicar.\n'
