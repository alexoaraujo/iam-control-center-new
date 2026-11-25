# PEOS — Neon Production schema drift (read-only evidence)

**Data da leitura:** 2026-11-23 (UTC) · **Repositório:** `alexoaraujo/iam-control-center-new` · **main SHA:** `97a8af863c25f0f4f8e945968e2340aacbbed247` · **Neon:** `iam-database-delivery` / `tiny-rice-70320263` · **Escopo:** auditoria de catálogos e planejamento; nenhuma migração, grant, restauração, release ou custódia executados.

## Identidade dos ambientes verificada

| Ambiente | Branch ID | Estado | Proteção | Observação |
| --- | --- | --- | --- | --- |
| Production | `br-muddy-snow-b63cepcv` | ready, default | `false` | Banco `iam_database`, owner `neondb_owner` |
| Development | `br-ancient-term-b6mmx5ol` | ready | `false` | Banco `iam_database`, owner `neondb_owner` |
| G3 candidato | `br-calm-forest-b6a1jpzs` | ready, expires 2026-11-27T22:00:00Z | `false` | Schema compare indica objetos IAM; consulta SQL pela API bloqueada por `endpoint not found` (compute não provisionado) |

## Resultado de consultas SELECT aos catálogos PostgreSQL de `iam_database`

| Métrica | Production | Development |
| --- | ---: | ---: |
| Schemas `iam`, `audit`, `app_private` | **0** | **3** |
| Tabelas de aplicação/audit (`relkind in (r,p)`) | **0** | **23** |
| Views da aplicação | **0** | **1** |
| Tabelas com `relrowsecurity=true` | **0** | **20** |
| Tabelas com `relforcerowsecurity=true` | **0** | **20** |
| Políticas `pg_policies` | **0** | **41** |
| `iam.schema_migrations` | **inexistente** | **existe, 0 linhas** |

O `compare_database_schema` da API Neon apresenta diferença extensa entre Production e Development (74.572 caracteres no diff), caracterizada pela ausência do schema IAM em Production. A branch G3 de validação também difere de Production, mas não serve como aprovação automática de DDL.

**Roles PostgreSQL:** Production possui `neondb_owner` e `iam_app_runtime_login`; Development tem adicionalmente `iam_owner`, `iam_migrator`, `iam_app_runtime`, `iam_worker` e `iam_schema_export_reader`. `iam_app_runtime_login` em ambas não possui `BYPASSRLS`. `neondb_owner` possui `BYPASSRLS`: não pode ser usado como runtime da aplicação.

## Governança e limites da evidência

- `database/migrations/lineage-policy.json` mantém `execution_authorized=false`, `canonical_baseline.status=BLOCKED` e as migrations 0001–0004 como `REVIEW_ONLY` com precondições **diferentes**; não concatenar ou executá-las por numeração sem reconciliação.
- `database/migrations/README.md` confirma ausência de migration runner geral. O ledger de Development (`migration_id, checksum_sha256, source_sha, applied_at, execution_role`) não tem a mesma estrutura do ledger clean-install 0001 (`version, name, checksum, applied_at, applied_by`). Proibido backfill sintético sem proveniência autenticada.
- Catálogos Neon atestam as branches consultadas, **não** identificam por si só a conexão PostgreSQL efetivamente utilizada pelo deployment servido em `iam-control-center-new.vercel.app`. Essa vinculação requer readback seguro de identidade do banco pelo runtime de Production (sem expor connection string, credenciais ou dados de usuário).
- Branch Production `protected=false` é um risco de governança a corrigir em gate administrativo independente; **não** alterar proteção agora sem análise do efeito sobre os workflows autorizados.
- PRs #129 e #117 revisadas/aprovadas no SHA, ainda não mescladas à `main`: não transferir os pareceres às leases G1/G3 nem à Production.

## Gate PEOS proposto — sequência obrigatória

1. **Atestar o destino efetivo:** provar o binding da aplicação Production ao Neon `br-muddy-snow-b63cepcv` (ou registrar divergência como bloqueio) por fingerprint de branch e identidade de role, sem divulgar URL ou segredo.
2. **Baseline canônica:** obter dump `--schema-only` autenticado, manifest de objetos, owners, ACL, roles, ledger e proveniência; revisão independente dos desvios e checksums.
3. **Executor isolado:** implementar migration runner seguro no repositório, transacional, idempotente e serializado por advisory lock; reconciliar diferenças de ledger e dependências 0001–0004, com plano de roll-forward e rollback.
4. **Prova em clone descartável:** branch nova com TTL, compute controlado, test suite PostgreSQL 18, RLS tenant A/B, role runtime sem `BYPASSRLS`, grant→200 / revoke→403 no E2E correspondente, cleanup comprovado; não reutilizar aprovações antigas.
5. **Custódia e release:** backup/restauração testados, autorização específica do SHA atual, reviewers exigidos, privilégio mínimo, atestação de SHA/branch/host e janela de manutenção; somente então propor mudança Production separadamente.
6. **Pós-change:** comparar manifest/ledger/owners/policies do banco com a baseline aprovada, confirmar rollback e rerodar gates na `main` no novo SHA. 

### Decisão

`PRODUCTION_SCHEMA_PARITY=FAIL` · `MIGRATION_RUNNER=NOT_IMPLEMENTED` · `CANONICAL_LINEAGE=BLOCKED` · `PROD_EFFECTIVE_DB_BINDING=NOT_ATTESTED` · `G3_PRIVILEGED_LEASE=HOLD` · `PRODUCTION_DEPLOYMENT=HOLD`.

**Esta PR é documental, sem SQL executável novo e sem autorização de Production.** Fonte da observação: Neon API (branches, databases, SQL SELECT, compare_database_schema), GitHub `main@97a8af863c25f0f4f8e945968e2340aacbbed247` e arquivos acima.
