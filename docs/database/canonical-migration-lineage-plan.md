# Plano canônico de lineage e ordenação de migrations PostgreSQL

**Status:** DESIGN / BLOCKED PARA IMPLEMENTAÇÃO. Este documento não é migration e não autoriza DDL, GRANT, seed, alteração de ACL ou execução em Neon persistente/Production.

## 1. Decisão arquitetural

Adotar uma única cadeia lógica de evolução do schema, com identificadores globalmente únicos e imutáveis, mantendo separados:

1. **Baseline operacional versionada:** snapshot schema-only, reproduzível e revisado, derivado da fonte Neon aprovada. Serve para provisionar uma database vazia no estado estrutural de referência; não substitui o histórico de migrations.
2. **Ledger de proveniência:** registra a baseline adotada e as migrations efetivamente aplicadas, com identificador, SHA-256 do arquivo, source commit SHA, executor e timestamp.
3. **Migrations incrementais:** alterações posteriores, ordenadas por dependência e aplicadas transacionalmente sob advisory lock.
4. **Contratos de teste:** bootstrap limpo, upgrade a partir da baseline, upgrade a partir de versões suportadas, RLS/privilégios, concorrência, idempotência, checksum mismatch e rollback em banco descartável.

Não tratar o arquivo atual `database/migrations/0001_initial_iam_schema.sql` como baseline operacional: ele se identifica como REVIEW PROPOSAL e cria apenas um subconjunto do schema observado. Não promovê-lo nem executá-lo até que seja substituído por artefato integral validado.

## 2. Tratamento dos identificadores históricos

- Preservar literalmente o registro já observado na origem: `0001_context_key_hardening`, checksum `2447395628fa0f1230abd95eb522e5b45d1baea1208c9c21b20346a10718fbab`, source SHA `b80c98c51746e1d49039015eb649b9bdd735ef7f`.
- Não renomear, reescrever, reaplicar, apagar ou recalcular o checksum de migration já aplicada.
- O nome `0001_initial_iam_schema.sql` é uma proposta no repositório e não prova aplicação na origem. Seu prefixo numérico não estabelece predecessor.
- A migration `0001_context_key_hardening.sql` da PR #85 pressupõe schema preexistente; não pode ser considerada bootstrap.
- IDs legados com prefixo `0001` permanecem históricos. A nova cadeia usa IDs ordenáveis e globalmente únicos, preferencialmente UTC timestamp + sequência + slug, por exemplo `20261108T000001Z__...`. Exemplos são convenção, não IDs aprovados para execução.
- O runner deve detectar IDs duplicados, checksum divergente, predecessor ausente e drift do ledger e falhar antes de DDL.

## 3. Layout-alvo

```text
database/
  baselines/
    iam_database_schema.sql
    iam_database_schema.manifest.json
  migrations/
    20261108T000001Z__<capability>.sql
    20261108T000002Z__<capability>.sql
  bootstrap/
    0000_iam_roles.sql
  tests/
    bootstrap-clean/
    baseline-restore/
    migration-upgrade/
    migration-lock/
    migration-ledger/
    runtime-rls/
  proposals/
```

O dump deve ser schema-only, sem dados de negócio, incluir dependências de extensão explicitamente e registrar SHA-256, origem, versão do PostgreSQL/pg_dump, data de export e contagens/manifesto de objetos. O manifest deve cobrir definições, não apenas contagens: schemas, relations/columns, constraints, indexes, sequences, enums, functions (signature/body/security/config/owner/ACL), views, triggers, policies, grants/default privileges e extension metadata.

## 4. Grafo de dependências

A sequência funcional não deve ser definida só pelo nome das tabelas. Construir DAG a partir de dependências de catálogo e contratos de autorização. A ordem lógica mínima é:

1. **Prerequisites e roles:** extensões suportadas, schemas, ownership e principals; bootstrap de roles é separado e executado por principal administrativo dedicado.
2. **Core identity/tenant:** tenants, identities, organizations e estados/constraints.
3. **Membership e lifecycle:** memberships, invitations, identity providers, service accounts e relações de identidade/tenant.
4. **Authorization model:** roles, permissions, role_permissions, membership_roles, groups/group_roles/group_memberships, access_policies e resolução efetiva.
5. **Tenant context e cryptographic validation:** context_keys, assinatura, expiração, nonce, fail-closed e funções SECURITY DEFINER.
6. **RLS e integridade cross-tenant:** policies, FORCE RLS, WITH CHECK, índices e FKs; provar com roles reais e tenants A/B.
7. **Runtime/worker least privilege:** grants mínimos, default privileges, PUBLIC EXECUTE, ownership e separação runtime/migrator/worker.
8. **Audit/outbox/security events:** append-only, triggers, sequences, grants e consistência transacional.
9. **Sessions/API keys/idempotency:** constraints, lifecycle e políticas de acesso.
10. **Migration ledger/runner hardening:** advisory transaction lock, checksum, source SHA, idempotência, serialização e falha fechada.

Esta ordem é uma decomposição de capacidades; a ordem final de arquivos depende do DAG real. Não criar arquivos SQL de migração com base apenas nesta lista.

## 5. Estratégia de instalação e upgrade

### Database vazia
1. Criar database isolada.
2. Executar bootstrap de roles com principal separado, nunca com runtime.
3. Restaurar a baseline integral revisada, com ownership/ACL explícitos e sem linhas de negócio.
4. Aplicar o marcador de adoção da baseline com versão/hash próprios; não inventar que migrations históricas foram executadas individualmente.
5. Validar contratos completos e comparar o manifesto restaurado ao manifesto aprovado.
6. Aplicar somente migrations posteriores à baseline.

### Database já existente (fonte Neon)
1. Obter snapshot read-only autenticado e ledger por canal aprovado.
2. Comparar objeto a objeto e provar a origem do ledger.
3. Confirmar o checksum histórico sem reescrever registros.
4. Fazer preflight de divergência; se schema/ledger não corresponderem, abortar.
5. Executar somente novas migrations corretivas após revisão, aprovação e ambiente isolado.
6. Não executar baseline sobre database existente.

### Compatibilidade
- Bootstrap limpo e upgrade devem convergir para o mesmo manifesto de schema.
- Cada migration incremental deve ter precondition, alteração transacional, postcondition e estratégia de rollback documentada.
- Mudanças não transacionais devem ser explicitamente identificadas e ter procedimento de recuperação próprio.

## 6. Gates para desbloquear implementação

| Gate | Evidência exigida | Estado atual |
|---|---|---|
| Fonte e identidade | Neon project/branch/database e identidade read-only confirmadas | PASS histórico de inventário |
| Baseline integral | Dump autenticado recente, checksum e manifest completos | PENDING |
| Equivalência | Comparação objeto-a-objeto origem × dump × restore | PENDING |
| Proveniência ledger | Leitura autorizada do ledger, checksum/source SHA e vínculo com baseline | PENDING |
| DAG | Dependências de catálogo e contratos revisados | PENDING |
| Bootstrap | Restore limpo, ownership, ACL, extensões, zero dados e manifest idêntico | PASS parcial em CI; equivalência PENDING |
| Upgrade | Baseline + migrations incrementais no PostgreSQL 18 descartável | PENDING |
| Security | RLS cross-tenant, role matrix, PUBLIC EXECUTE, search_path e SECURITY DEFINER | PASS parcial; revisão integral PENDING |
| Lock/ledger | Concorrência entre dois processos, idempotência, mismatch e rollback | PASS CI histórico em SHA anterior; revalidar SHA atual |
| Review | Revisão independente sem findings abertos | PENDING |
| Ambientes | Preview/Development gates e autorização específica antes de qualquer persistência | PENDING |

## 7. Ações vedadas até os gates

- Não renumerar ou alterar migrations aplicadas.
- Não executar a migration incremental sobre database vazia.
- Não converter dump de schema em migration sem normalizar ownership, ACL, dependências, extensões e comportamento de restore.
- Não conceder SELECT no ledger ao export reader sem revisão de privilégio mínimo e aprovação explícita.
- Não criar compute/branch Neon persistente, executar DDL/GRANT/seed, alterar Auth0/Vercel Production ou fazer merge das PRs #85/#86 enquanto os blockers estiverem abertos.
- Não classificar Preview/Auth0 E2E como PASS quando os jobs estiverem SKIPPED.

## 8. Próxima implementação autorizável

A primeira entrega de código deve ser somente um **baseline reconciliation package**: export autenticado read-only, manifest determinístico, comparação objeto-a-objeto e restore em PostgreSQL 18 descartável. Após revisão desse pacote, congelar a baseline e só então gerar a primeira migration incremental com ID novo. A proposta de bootstrap antigo deve permanecer fora do caminho executável até ser substituída e testada.

**Critério de conclusão da estratégia:** baseline reproduzível e equivalente à fonte; ledger histórico preservado; DAG revisado; bootstrap e upgrade convergentes; todos os contratos de segurança e execução passando no SHA exato; revisão independente concluída.
