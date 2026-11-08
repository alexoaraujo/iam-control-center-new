# Auditoria integral do repositório — IAM Control Center

**Data:** 2026-11-07 BRT / 2026-11-08 UTC  
**Repositório:** `alexoaraujo83/iam-control-center` (privado)  
**Branch auditada:** `main`  
**SHA:** `64f96d84b33aff57d9c09bbe7ff54396e651552c`  
**Inventário:** 98 arquivos rastreados; árvore Git completa, sem truncamento.  
**Escopo:** metadados GitHub, árvore, workflows, aplicação web, toolchain, SQL/migrations/tests, documentação, CI e PRs abertas; confronto com evidências Neon já coletadas. Revisão estática + evidências operacionais disponíveis; não equivale a pentest nem a auditoria independente dos dashboards Auth0/Vercel.

## 1. Resultado executivo

**GATE GERAL: BLOCKED — NOT PRODUCTION READY.** O CI principal passou no SHA auditado, mas o sistema ainda é um scaffold parcial: E2E Auth0 e Preview foram ignorados; autorização IAM por tenant não está implementada; persistência Neon não executa queries; e a sequência de migrations não reproduz a baseline operacional.

| Gate | Estado | Evidência |
|---|---|---|
| Inventário Git | PASS | Repo privado; main SHA acima; 98 arquivos |
| CI quality | PASS | Run 42430949038 no SHA exato |
| Preview no main | SKIPPED | Check `preview-deployment` |
| Auth0 E2E no main | SKIPPED | Check `auth0-e2e` |
| AuthN/AuthZ IAM | BLOCKED | Rota protegida verifica somente sessão Auth0 |
| Persistência Neon runtime | NOT IMPLEMENTED | Cliente criado sem query/sessão |
| Baseline/migrations | BLOCKED | Migration clean-db reduzida; fonte operacional tem 23 tabelas |
| Evidências/documentação | FAIL (drift) | Manifesto, setup e snapshots históricos desatualizados; correções nesta branch |

## 2. Evidência CI vinculada ao SHA

- `42430949038`: `quality = SUCCESS` no main SHA auditado.
- No mesmo SHA, `preview-deployment = SKIPPED` e `auth0-e2e = SKIPPED`.
- Runs `42431383085` e `42431383083` pertencem à PR #86, SHA `843428b5e1a12757be23fb1faa13c97a05e3b12a`, não ao main.
- PR #85: head `742fd2e399cf62c09b56643e4796a0e5508bb6dc`; quality e database tests passaram nos runs `42431277832` e `42431277817`. O corpo da PR menciona SHA anterior.
- PR #86: head `843428b5e1a12757be23fb1faa13c97a05e3b12a`; quality/database tests passaram. Restore integral e reconciliação permanecem pendentes.

## 3. Achados documentais

1. **README:** pnpm declarado como 10.12.1, enquanto package.json fixa 10.34.9. Corrigido nesta branch.
2. **SCAFFOLD-MANIFEST:** dizia 30 arquivos e continha versões antigas; inventário real contém 98 arquivos. Regenerado nesta branch.
3. **Guia Auth0:** descrevia SDK/cliente/middleware Next 15 como tarefas futuras. Código atual tem SDK v4 e `src/proxy.ts` Next 16; guia atualizado para separar implementação de E2E pendente.
4. **GitHub Actions inventory:** SHA e pnpm antigos e alegação de repositório público. API confirma `private`; endpoint rulesets respondeu HTTP 403, então enforcement não foi revalidado.
5. **Dependency remediation:** versões e runs de outubro foram preservados como históricos; seção atual vinculada ao main SHA foi adicionada.

## 4. Aplicação e arquitetura

- **Sessão não é autorização:** `apps/web/src/app/protected/page.tsx` chama `auth0.getSession()`; não resolve tenant ativo, membership ou permission. Não liberar recursos multi-tenant com base apenas na sessão.
- **Neon não está conectado operacionalmente:** `apps/web/src/lib/db.ts` instancia `neon(connectionString)`; não executa query nem estabelece sessão autenticada.
- **Health é diagnóstico de configuração:** `/api/health` informa scaffold e booleanos de presença; não valida Auth0, PostgreSQL, migrations ou autorização.
- **Configuração Auth0:** `auth0.ts` usa non-null assertions TypeScript em variáveis de ambiente; isso não valida presença em runtime. Testar inicialização ausente/malformada.
- **Auth0 E2E:** workflow existe, mas foi SKIPPED no SHA auditado; login/callback/logout não estão comprovados neste SHA.

## 5. Banco, lineage e testes

### DB-01 — Migration main não é baseline operacional
`database/migrations/0001_initial_iam_schema.sql` é REVIEW PROPOSAL para database limpa; cria 10 tabelas e não reproduz 23 tabelas, view, funções, policies, triggers, enums, ACLs e índices da fonte Neon. Não executar sobre a fonte existente nem tratá-la como baseline canônica.

### DB-02 — Migration histórica incremental fora do main
A fonte Neon registrou `0001_context_key_hardening`, associada ao SHA `b80c98c51746e1d49039015eb649b9bdd735ef7f`. O arquivo histórico não está no main atual e pressupõe schema operacional preexistente. Não substitui baseline inicial. O checksum do arquivo recuperado ainda precisa de comparação byte-a-byte com o ledger; não declarar match ainda.

### DB-03 — Trigger de sessions inconsistente no restore
No restore pós-hardening, `sessions_touch` chama `iam.touch_updated_at()`, mas `iam.sessions` não tem coluna `updated_at` (tem `last_seen_at`). UPDATE falha. Uma alternativa foi testada somente em rollback; não é correção aprovada. Definir semântica antes de alterar trigger, pois revogação não deve necessariamente atualizar `last_seen_at`.

### DB-04 — Lock concorrente não provado
Testes A/B usaram o mesmo backend PID; não demonstram contenção concorrente entre sessões independentes. Repetir com dois processos/conexões, PIDs distintos e timestamps sobrepostos.

### DB-05 — Runtime e worker parcialmente verificados
No restore isolado passaram testes fail-closed HMAC, rotação de chave e vários writes cross-tenant. Same-tenant CRUD passou para vários objetos; UPDATE de sessions falhou pelo trigger. `iam_worker_login` não autenticou por falta de credencial; leitura isolada do worker permanece NOT VERIFIED. DELETE sem grant não foi exercitado.

### DB-06 — Policy identities
A policy `identity_scope` usa membership no USING e `WITH CHECK true`; runtime/worker não têm grants de escrita atualmente. Antes de conceder DML, definir CHECK explícito para evitar vínculo indevido de identity.

## 6. Workflows

- `quality.yml` usa permissões mínimas, actions fixadas por SHA e install frozen, audit, lint, typecheck, tests e build.
- Preview depende do filtro de impacto e status/check do Vercel no SHA exato.
- Auth0 E2E depende de `AUTH0_E2E_ENABLED=true`; foi SKIPPED no main auditado.
- `database-tests.yml` usa PostgreSQL 18 descartável. Push é limitado a branches específicas; PR dispara por paths. Não é gate universal de push em main.
- POCs/harnesses validam fixtures descartáveis, não integração Neon real.
- Workflow de role verification é allowlisted e usa rollback para metadados; não prova autenticação efetiva como runtime nem isolamento de dados.

## 7. PRs abertas relevantes

| PR | Head observado | Estado | Conclusão |
|---|---|---|---|
| #85 | `742fd2e399cf62c09b56643e4796a0e5508bb6dc` | Draft/open | CI PASS nesse head; fixture reduzida não prova restore integral; descrição tem SHA antigo |
| #86 | `843428b5e1a12757be23fb1faa13c97a05e3b12a` | Draft/open | CI e DB tests PASS nesse head; restore/reconciliação objeto-a-objeto PENDING |
| #56 | `7b1107c9ac9d1c249d3f0aed5ba3c6dcb48c30fd` | Draft/open | Lifecycle separado; não é gate de runtime IAM |

Nenhuma PR foi mesclada ou fechada.

## 8. Plano ordenado de correção

1. Validar checksum byte-a-byte da migration histórica e recuperar lineage da baseline inicial.
2. Criar sequência de migrations sem colisão de IDs e sem reexecutar hardening aplicado.
3. Restaurar DDL pós-hardening em database descartável vazia e comparar objetos, dependências, owners, ACLs, RLS, policies, triggers, funções e extensões.
4. Corrigir sessions trigger em fixture isolada com semântica aprovada.
5. Provar migration lock com dois processos PostgreSQL independentes.
6. Implementar contratos identity/tenant/membership/permissions e autorização server-side; conectar runtime com login efetivo em Development isolado.
7. Executar Auth0 E2E e testes RLS same/cross-tenant com logins runtime/worker efetivos.
8. Atualizar corpos das PRs e revalidar checks no head exato antes de Ready.

## 9. Limites desta aplicação

Esta branch atualiza documentação e manifesto. Não altera runtime, SQL aplicado, roles, grants, policies, secrets, Auth0, Vercel ou Neon. Nenhuma migration foi executada; nenhuma PR foi mesclada; nenhum deploy Production foi iniciado.

**Decisão:** manter **BLOCKED / NOT PRODUCTION READY** até concluir os gates 1–7 com evidências no SHA candidato e revisão independente.
