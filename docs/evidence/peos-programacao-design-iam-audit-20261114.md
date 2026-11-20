# PEOS — IAM Control Center NEW · Auditoria incremental (14/11/2026)

**Escopo:** alexoaraujo/iam-control-center-new. **Base de código:** PR #41 `5d3b1f919d338bf41bc8be07d24cf7471102fc02`. **Branch de correção isolada:** `fix/rbac-http-body-bytes-20261114`. Nenhuma autorização de merge, release ou DDL está implícita nesta evidência.

## Índice aplicado

Fonte: [Índice PEOS Programação e Design](https://github.com/alexoaraujo/peos-knowledge-hub/blob/main/colecoes/programacao-design/INDEX.md).

- **BPD-109/110/111/112:** distinguir código na main, funcionalidades parciais e demonstrações visuais de integração operacional.
- **BPD-114/115/116/117/118/127:** corrigir bloqueios existentes, menor alteração segura, testes por SHA, sem recriar módulos.
- **BPD-035/040/069/071/077/079/080/083:** auditoria read-only Neon, API RBAC, privilégios e causa raiz.
- **BPD-088/090/091/092/099/104:** regressão, CI, Auth0 E2E, readiness; não inferir PASS de SKIPPED.

## Diagnósticos e evidências (sem suposições de Production)

1. **API / P0 — limite do corpo:** `apps/web/src/app/api/authorization/check/route.ts` usava `request.text()` antes de limitar o payload por `payload.length` (caracteres, não bytes). Um corpo de rede sem `Content-Length` podia ser acumulado integralmente. Correção: leitura de stream com limite de **4096 bytes**, UTF-8 estrito e cancelamento antecipado; manter 401 sem sessão e 403 deny-by-default. Testes: oversized sem header confiável, codificação inválida, length negativo e JSON válido dividido em chunks. **Estado: implementação proposta; PASS depende do CI no SHA do commit.**
2. **Frontend / parcial:** painel de `apps/web/src/app/page.tsx` usa componentes reais, sessão e snapshot GitHub, mas os cards de identidades, tenants e auditoria ainda são vazios, explicitamente identificados como não conectados. Não tratar como funcionalidade operacional.
3. **API / parcial:** a PR #41 fornece `POST /api/authorization/check` e testes de autorização; a `main` ainda não contém essa rota. Testes do SHA da #41 não autorizam promoção de Production.
4. **Banco / bloqueado:** inspeção **read-only** em Neon `tiny-rice-70320263`, database `iam_database`, branches `br-ancient-term-b6mmx5ol` (Development) e `br-sweet-union-b6j80a7j` (Restore): 21 tabelas IAM, 18 com RLS; `permissions` e `schema_migrations` não usam RLS e requerem avaliação específica dos GRANTs. Há drift real: runtime `INHERIT=true` em Development versus `INHERIT=false` no Restore; logins migrator/worker ausentes em Development, presentes no Restore. As consultas usaram o dono do banco e **não** comprovam isolamento A/B com role runtime. Sem alterações de DDL.
5. **CI/release / bloqueado:** PR Draft #71 SHA `032b8b16a5c87e2726d3f7e0983263b73c72ab9f`: `quality=SUCCESS`, `preview-deployment=SUCCESS`, `sync-auth0-preview=FAILURE` esperada (callback só vinculado à #41), `auth0-e2e=SKIPPED`. O ruleset `protect-main` requer `quality`, mas não o gate Auth0 final; não liberar merge sem reforçar esse controle.
6. **Build e dependências:** `pnpm@10.34.9`, Node 24 exigido. Build, lint, typecheck, testes e scripts Node passaram no CI da PR #71 no SHA acima, mas não cobrem este novo patch até execução de novo CI.
7. **Segredos/ambientes:** sem alteração de secrets, Neon Production, alias Auth0, Vercel Production ou regras GitHub neste patch.

## Dependências — critérios de avanço

1. Validar correção de body size no CI (lint → typecheck → testes → build) e review independente no SHA **exato**.
2. Integrar correção ao código autorizado de RBAC e executar Auth0 E2E real, RLS A/B, grant/revoke HTTP 200→403, cleanup e no-leak.
3. Reconciliar controles Auth0/Vercel da PR #71 sem alterar callback compartilhado em branch não autorizada.
4. Tornar gates de segurança obrigatórios no ruleset de `main` (não considerar `quality` suficiente para E2E).
5. Rever grants, role graph, ledger e restore no Neon isolado com rollback antes de qualquer DDL ou cutover.
6. Só depois habilitar leitura operacional do frontend, acessibilidade e novas funcionalidades, com fontes reais e RLS.

**PEOS:** Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar. Um check SKIPPED ou uma simulação **não** representa PASS.
