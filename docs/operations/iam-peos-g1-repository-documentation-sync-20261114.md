# IAM Control Center NEW — PEOS G1, sincronização de repositório e documentação

**Checkpoint:** 2026-11-14. **Estado:** proposta em branch de documentação; não representa merge, release, backup, restore ou cutover aprovado.

## 1. Fonte da verdade e evidência no SHA

| Recurso | Checkpoint confirmado | Gate de progresso |
| --- | --- | --- |
| GitHub main | `665b41008d16e88d6cd6f9857951a294ddb112f2` | Protegida; preservar |
| PR [#41](https://github.com/alexoaraujo/iam-control-center-new/pull/41) | HEAD `7a37aa523eb262fd17bb9653622ef83bcb48ec59`; revisão independente APPROVED; `quality`, `security-gate`, `sync-auth0-preview`, `preview-deployment` e `auth0-e2e` SUCCESS | OPEN; merge **BLOCKED** enquanto não houver gate operacional |
| PR [#76](https://github.com/alexoaraujo/iam-control-center-new/pull/76) | HEAD `f0c2dbc378d0f6d72c1d16cdf0c9449410959b34`; teste PG18 sintético revisado | OPEN; não comprova backup Neon |
| PR [#77](https://github.com/alexoaraujo/iam-control-center-new/pull/77) | HEAD `e8241407eb064f994485bf1f16581d3e846a57d7`; APPROVED no SHA; CI, PG18 e docs SUCCESS; threads resolvidas | OPEN; `security-gate` **AUSENTE** neste SHA; Vercel `failure/rate limit` |
| `protect-main` | Ruleset GitHub `26988310`, ativo: 1 aprovação, threads resolvidas, `quality` e `security-gate`, checks estritos | Não enfraquecer |
| Vercel AOA | `iam-control-center-new` / `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80` | Production preservada; revisão de implantação exigida |
| Neon | `tiny-rice-70320263` / `iam-database-delivery` / PostgreSQL 18 | G1 recuperação REAL **BLOCKED** |

**Sempre reconfirmar estes SHAs e estados via conectores** antes de utilizá-los. A documentação é checkpoint datado, não autorização.

## 2. Vercel: proteção, limitações e provas

- O run [`43636054563`](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43636054563), job `132572988437`, confirmou por API autenticada somente GET: `exact_shell_command=true`, `no_production_approved_sha=true`, `alias_unchanged=true`, `baseline_deployment_unchanged=true`, `auto_assign_disabled=true` e Production branch tracking `main`. No momento da prova, a release não estava autorizada.
- O teste negativo real de deployment [`dpl_BRtXdLVrDTXeWj8AZsxzBRVLVsta`](https://vercel.com/aoa4/iam-control-center-new/BRtXdLVrDTXeWj8AZsxzBRVLVsta) terminou `CANCELED` por Ignored Build Step: **prova somente para branch não-main e SHA não autorizado**, sem associação de domínio. Não extrapolar para branch `main`, promoção manual ou todas as APIs.
- Domínio Production preservado no deployment `dpl_4sd7DPf8nnr5WuzieAkn2CZcbSq1` (`main@665b4100...`) no readback. Não implantar, promover, alterar alias/branch tracking, habilitar SHA aprovado ou liberar `main` nesta fase.
- PR #77: status GitHub `Vercel=failure` com `Deployment rate limited — retry in 24 hours.`; no readback não existia deployment do SHA exato. **Não comprar plano nem considerar Preview de SHA antigo válido**.

## 3. Neon: recuperação canônica e controle de dados

- SOURCE: `development` / `br-ancient-term-b6mmx5ol` / `iam_database` — 23 tabelas, 41 policies, 20 tabelas com RLS habilitado e FORCE, ledger `iam.schema_migrations` com 0 linhas, reader MAINTAIN 0/23.
- CLONE descartável: `br-shy-night-b638k9e7` — fixtures sintéticas de MAINTAIN/USAGE concedidas, revogadas após COMMIT e removidas com prova independente. Expiração planejada 2026-11-15T23:00:00Z.
- RESTORE isolado: `br-sweet-union-b6j80a7j` / banco **somente `iam_canonical_validation`** — 0 schemas/tabelas IAM; `pgcrypto` disponível, **não instalada**. Expiração planejada 2026-11-20T09:12:00Z. Nunca restaurar em `iam_database` herdado da branch.
- Snapshot list: `[]`. Child branch/PITR não é backup independente; não declarar recuperabilidade sem arquivo e restore real.
- Preflight da PR #77 retorna `source_role_contract=BLOCKED` e `schema_export_privileges=BLOCKED`, incluindo divergências de logins/memberships e MAINTAIN/USAGE. `full_data_backup_recovery=NOT_EVALUATED_NO_ARCHIVE_OR_RESTORE`.
- **Proibido:** exportar dados pessoais com role inapropriada, conceder `BYPASSRLS`, `GRANT/ALTER ROLE` na origem, alterar Production, executar restore/DDL fora do banco explicitamente autorizado ou declarar G1 PASS sem evidências de backup criptografado com dados, roles/ACLs/ledger, restore e rollback independente.

## 4. Ordem PEOS — executar somente até gate permitido

1. **Inventariar:** ler `main`, PRs abertas, SHA, diffs, reviews, checks por SHA, status Vercel, rulesets, issues #11/#14/#15/#32/#34 e catálogos Neon sem dados pessoais.
2. **Reconciliar:** construir matriz `requisito → arquivo → PR/issue → owner → dependência → evidência/URL → status PASS/BLOCKED/PENDENTE`; diferenciar validações em PostgreSQL sintético de Neon real.
3. **Avaliar cadeia PR:** #41 traz `security-gate` e alterações de runtime/Preview, mas é amplo (51 arquivos/87 commits no checkpoint). Validar impacto independente e condições de Production ANTES de merge. #76/#77 dependem do gate operacional e do check `security-gate` exigido em `main`.
4. **Provar deploy seguro:** comparar a política de Production vigente com o runbook; exigir teste negativo de SHA divergente em `main` sem atribuição de domínio, segurança contra promoção manual e aceite independente, se tecnicamente testável sem produção. A impossibilidade de testar é **BLOCKED**, não autorização tácita.
5. **Preparar recuperação:** inventário role graph, extensões e dependências; formalizar identidade de backup com RLS, `pg_dump -Fc` incluindo dados, globals sanitizados, criptografia antes de upload, checksum, custódia; obter aprovação operacional distinta da revisão de PR. Restore/rollback somente em banco isolado revisado.
6. **Sincronizar GitHub:** preferir comentários/checkpoints idempotentes nas issues existentes, sem duplicá-las ou apagar históricos. Atualizar checklists e descrições de PR com links de runs, SHAs e pendências. Não considerar `SKIPPED` como `PASS`.
7. **Sincronizar docs:** atualizar runbooks de Auth0 Preview, Vercel Production, Neon recovery, RLS/RBAC, ledger e matriz de gates em PR exclusiva; verificar markdown/links, revisar diffs, registrar revisão independente e checks. Não escrever diretamente na `main`.
8. **Revisar e validar:** `Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar`; se um gate falhar, corrigir apenas em branch segura e reexecutar checks no SHA final, nunca mascarar falha ou desabilitar proteção.
9. **Emitir relatório:** mudanças aplicadas, links, checks exatos, novo SHA, gates liberados/bloqueados, evidências do Neon, riscos/rollback e próxima ação **permitida**. Não anunciar conclusão onde resta BLOCKED.

## 5. Critérios de parada e escopo de alterações

- **Permitido sem release:** GET/listagem, SQL somente SELECT e sem PII, verificação de logs não sensíveis, testes sintéticos em PostgreSQL descartável, docs em branch/PR, issues/checklists e comentários com evidências.
- **Requer aprovação separada:** merge de PR que altere `main`/Git-connected Vercel Production, mudança de branch tracking/domínio, promoção/rollback Vercel, credenciais ou privilégios globais, export de dados pessoais, DDL/restore na origem ou target, alteração de secrets, migração e cutover.
- **Jamais inferir:** CI verde = release, revisão de código = autorização operacional, schema diff vazio = roles iguais, clone/snapshot = backup restaurável, deploy `READY` de SHA antigo = Preview do SHA testado.

## 6. Issues e relatórios a manter sincronizados

- [#11](https://github.com/alexoaraujo/iam-control-center-new/issues/11): ruleset, check obrigatório, controle de release e proteção da `main`.
- [#14](https://github.com/alexoaraujo/iam-control-center-new/issues/14): baseline canônica, paridade e evidências reais de roles/ACLs.
- [#15](https://github.com/alexoaraujo/iam-control-center-new/issues/15): runner, ledger, recuperação integral e gates G1.
- [#32](https://github.com/alexoaraujo/iam-control-center-new/issues/32): ensaio de recuperação Staging/UAT e rollback.
- [#34](https://github.com/alexoaraujo/iam-control-center-new/issues/34): Vercel Production, SHA aprovado, Auth0 E2E e teste negativo real.

**Saída obrigatória:** `PASS`, `BLOCKED`, `PENDING`, `NOT_EVALUATED` com prova específica; nada de `SUCCESS` sem execução. Preserve Production e `main` até autorização de release e recuperação.
