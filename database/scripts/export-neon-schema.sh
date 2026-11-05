#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Exporta somente DDL dos schemas IAM. Não exporta linhas de tabelas.
# Requer pg_dump 18+ para compatibilidade com o PostgreSQL 18 da origem.
: "${PGHOST:?Defina PGHOST para o endpoint Neon aprovado}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=iam_database}"
: "${PGUSER:?Defina PGUSER para uma role autorizada a ler o catálogo}"
: "${PGSSLMODE:=require}"
: "${PGPASSFILE:?Defina PGPASSFILE para um passfile protegido (chmod 600)}"

command -v pg_dump >/dev/null 2>&1 || {
  echo "ERRO: pg_dump não encontrado." >&2
  exit 127
}
command -v sha256sum >/dev/null 2>&1 || {
  echo "ERRO: sha256sum não encontrado." >&2
  exit 127
}

client_major="$(pg_dump --version | sed -E 's/.* ([0-9]+)\..*/\1/')"
if [[ ! "$client_major" =~ ^[0-9]+$ ]] || (( client_major < 18 )); then
  echo "ERRO: pg_dump 18 ou superior é obrigatório." >&2
  exit 2
fi

out="${1:-iam_database_schema.sql}"
tmp="${out}.tmp"
if [[ -e "$out" || -e "$tmp" ]]; then
  echo "ERRO: arquivo de saída já existe; não será sobrescrito: $out" >&2
  exit 3
fi
trap 'rm -f "$tmp"' EXIT

export PGHOST PGPORT PGDATABASE PGUSER PGSSLMODE PGPASSFILE

pg_dump \
  --no-password \
  --format=plain \
  --schema-only \
  --quote-all-identifiers \
  --verbose \
  --schema=iam \
  --schema=audit \
  --schema=app_private \
  --file="$tmp"

test -s "$tmp"
mv "$tmp" "$out"
trap - EXIT

sha256sum "$out"
printf 'Export DDL concluído: %s\n' "$out"
printf 'Revisar dependências externas, roles, ownership, ACLs e extensões antes de restaurar.\n'
