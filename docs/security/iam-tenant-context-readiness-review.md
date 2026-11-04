# IAM tenant-context — revisão de prontidão para produção

**Status:** auditoria documental concluída; implementação de produção **BLOCKED**.  
**Data:** 2026-11-04  
**Escopo:** revisão estática do POC IAM-CTX-POC-01 e dos contratos de aplicação/IAM.  
**Não autorizado por este documento:** merge, migration, alteração de roles/grants, instalação de extensão, conexão/alteração de Neon, mudança Auth0/Vercel ou deploy.

## 1. Baseline e evidências

O POC foi revisado no SHA `1e5ff91d698a01bee244093a2b054d1394c888ba`, branch `poc/iam-tenant-context-01`, PR [#83](https://github.com/alexoaraujo83/iam-control-center/pull/83).

| Gate automatizado | Execução | Resultado |
|---|---:|---|
| IAM tenant-context POC | [41764518517](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41764518517) | PASS |
| CI | [41764518436](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41764518436) | PASS |
| IAM tenant-context POC | [41764526598](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41764526598) | PASS |
| CI | [41764526579](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41764526579) | PASS |
| Database schema tests | [41764526575](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41764526575) | PASS |

O harness executa em serviço PostgreSQL 18 descartável e registra `IAM-CTX-POC-01 SQL assertions completed`. Isso valida somente as assertions desse harness no SHA indicado. Não é evidência de Neon, pooling real, autenticação OIDC, aplicação ou produção.

PR #83 permanece aberta, Draft e mergeable. Nenhum merge foi executado.

## 2. Escopo efetivamente implementado

O arquivo `database/poc/tenant-context/01_hmac_context.sql` cria schemas/roles experimentais, chave determinística, emissor e verificador HMAC, policy RLS e cenários de teste. A role runtime não recebe acesso à tabela de chaves nem EXECUTE no emissor; recebe EXECUTE apenas no verificador.

As assertions cobrem:
- leitura isolada de tenant A e tenant B;
- adulteração do payload sem assinatura correspondente;
- contexto expirado, malformado e ausente;
- bloqueio de INSERT/UPDATE/DELETE cross-tenant;
- bloqueio de leitura de chave, chamada do emissor, substituição do verificador e desativação de RLS pela role runtime;
- contexto transaction-local não permanece após COMMIT, quando a linha de base da sessão foi limpa.

**Não implementado:** integração com Auth0, emissão por broker confiável, membership/permission check real, rotação/revogação de chaves, prevenção de replay, pooling real, concorrência, telemetria, migrations ou configuração Neon.

## 3. Achados e classificação

| ID | Achado | Risco/impacto | Estado |
|---|---|---|---|
| R-01 | A comparação da assinatura usa operador SQL `bytea <> bytea`; não há prova de comparação constant-time. | Possível canal lateral de tempo em cenário de oráculo. | BLOCKED |
| R-02 | O payload contém `v`, `kid`, `tenant_id` e `exp`, mas não vincula identidade, membership, audiência/operação ou request. | A autorização depende integralmente de emissor externo confiável e de validação server-side não implementada. | BLOCKED |
| R-03 | `issue_context` aceita tenant UUID como argumento; o harness não valida membership. | O emissor de produção precisa validar identidade OIDC, tenant ativo, membership ativa e permissão antes de emitir. | BLOCKED |
| R-04 | Contexto pode ser reutilizado até expirar; não existe mecanismo anti-replay ou vínculo com transação/operação. | Revogação e replay dentro da janela de validade não estão resolvidos. | BLOCKED |
| R-05 | Teste de contexto local cobre COMMIT em uma sessão, não pooler, múltiplas conexões, rollback, savepoints ou concorrência. | Sem evidência de isolamento sob pooling/transações concorrentes. | BLOCKED |
| R-06 | Verificador captura `WHEN OTHERS` e retorna NULL. | Fail-closed, mas pode ocultar falhas operacionais; observabilidade sanitizada deve distinguir contexto inválido de erro interno sem vazar segredo. | REVIEW |
| R-07 | `pgcrypto` é instalada no harness; compatibilidade e permissões na branch Neon real não foram testadas. | Não presumir suporte/ownership/grants efetivos no ambiente-alvo. | BLOCKED |
| R-08 | A aplicação tem apenas cliente Auth0 e factory Neon; não há fluxo de contexto nem consulta DB no health check. | POC não está integrado à aplicação. | NOT CONFIGURED |
| R-09 | Migration 0001 é proposta fail-closed, sem policies ou grants runtime. | Não há autorização funcional/RLS de aplicação pronta para uso. | BLOCKED |
| R-10 | Avisos `no privileges could be revoked` aparecem ao revogar ACL de funções pgcrypto no harness. | Não causaram falha; ACL efetiva deve ser inventariada no alvo antes de qualquer desenho de grants. | REVIEW |

### Evidência do código de aplicação

- `apps/web/src/lib/auth0.ts`: instancia `Auth0Client`; não implementa validação de membership nem emissão de contexto.
- `apps/web/src/lib/db.ts`: cria cliente Neon usando `DATABASE_URL`; não executa query nem abre sessão por si só.
- `apps/web/src/app/api/health/route.ts`: retorna `status: "scaffold"`; não realiza `SELECT 1`.
- `database/migrations/README.md`: declara que não existe migration runner e que runtime Neon real permanece bloqueado.
- `docs/architecture/tenant-context-rfc.md`: mantém HMAC como candidato, não como decisão aprovada.

## 4. Requisitos para uma solução candidata

Nenhuma tecnologia de contexto é aprovada nesta auditoria. Antes de escolher HMAC, JWT assimétrico, role por tenant ou broker, produzir ADR comparativa e threat model que cubram:

1. Autenticação OIDC no servidor: validar assinatura, issuer, audience, expiração e estado da sessão.
2. Identidade: usar exatamente `(issuer, subject)`; nunca email como chave de autorização.
3. Tenant: confirmar tenant ativo, membership ativa e permissão da operação no momento de emissão.
4. Contexto: versão, tenant, identity/membership, audience, scope/ação, issued-at, expiração curta, key ID e request/operation ID.
5. Criptografia: comparação constant-time comprovada, canonicalização inequívoca, rotação, revogação e armazenamento segregado de chaves.
6. Replay/revogação: definir janela máxima, comportamento após suspensão de membership/tenant e vínculo do contexto à transação.
7. Banco: owner dedicado NOLOGIN, `SECURITY DEFINER` revisada, `search_path` mínimo, objetos qualificados, EXECUTE revogado de PUBLIC e grants mínimos.
8. Runtime: não pode ler/alterar chaves, alterar verificador, assumir owner/migrator, usar BYPASSRLS nem emitir contexto por SQL arbitrário.
9. Pooling: demonstrar contexto transaction-local em transações reais, conexões reutilizadas, rollback, falhas e concorrência.
10. Operação: métricas e logs sanitizados, latência/custo de verificação, indisponibilidade do emissor e recuperação de chave.

## 5. Matriz de gates

| Gate | Critério objetivo | Situação |
|---|---|---|
| G0 — POC PostgreSQL | Harness reproduzível e CI no SHA exato | PASS |
| G1 — Threat model | Atacante, fronteiras de confiança, comprometimento do app/SQL, replay e revogação documentados | BLOCKED |
| G2 — ADR | Comparar HMAC, assinatura assimétrica, role por tenant e broker; justificar escolha | BLOCKED |
| G3 — Criptografia | Constant-time, canonicalização, rotação, revogação e testes negativos | BLOCKED |
| G4 — Autorização | OIDC + membership ativa + permissão verificados antes da emissão | NOT CONFIGURED |
| G5 — Aplicação | Integração server-side Auth0 → autorização → contexto → DB, com testes | NOT CONFIGURED |
| G6 — PostgreSQL runtime | Testes com login efetivo `iam_app_runtime`, sem owner/superuser substituto | BLOCKED |
| G7 — Neon Development isolado | Compatibilidade, extensão, grants, RLS, TLS e conexão real demonstrados | BLOCKED |
| G8 — Pooling | Reuso/rollback/concorrência verificados no endpoint efetivamente habilitado | BLOCKED |
| G9 — Preview | Mesmo pacote de evidências em branch Preview isolada e dados sintéticos | BLOCKED |
| G10 — Production | Aprovação humana separada, recovery plan e evidência completa | NOT AUTHORIZED |

## 6. Sequência recomendada

1. Manter PR #83 Draft e isolada como evidência experimental.
2. Aprovar threat model e ADR antes de transformar o POC em código de aplicação ou migration.
3. Implementar a autorização de membership como serviço server-side independente do mecanismo criptográfico.
4. Prototipar o mecanismo selecionado em PostgreSQL descartável, incluindo os testes ausentes.
5. Somente após revisão, validar compatibilidade em branch Neon Development isolada, com role runtime efetiva.
6. Repetir em Preview; Production permanece fora de escopo até aprovação explícita independente.

## 7. Restrições operacionais

- Não executar este arquivo como SQL; é documentação de auditoria.
- Não aplicar a migration 0001 ou criar migration 0002 nesta etapa.
- Não instalar extensões, criar roles, alterar grants/policies ou modificar secrets.
- Não conectar o harness GitHub Actions ao Neon.
- Não alterar Auth0, Vercel ou Production.
- Preservar PR #83 Draft até decisão arquitetural e gates independentes.

**Conclusão:** PASS somente para o POC PostgreSQL descartável. A solução de tenant-context para produção permanece BLOCKED e não deve ser integrada à aplicação ou promovida a Neon enquanto G1–G9 não tiverem evidência aprovada.
