# IAM-015 / PEOS — Decisão operacional independente para fixture RBAC da PR #41

> **Status:** SOLICITAÇÃO DE APROVAÇÃO — NÃO APROVADA. Este documento e a abertura da PR NÃO autorizam operações. A única via para a decisão é uma revisão **APPROVED** na PR dedicada, com o marcador e o escopo abaixo, por um revisor independente. Não solicitar autorização em comentários de Issues.

## 1. Identificação imutável da solicitação

| Campo | Valor |
| --- | --- |
| Repositório | `alexoaraujo/iam-control-center-new` |
| PR de implementação | [#41](https://github.com/alexoaraujo/iam-control-center-new/pull/41) |
| SHA de código em análise | `f786f210af97bb8938b3349519bc16b56cdaa7a5` |
| Incidente de origem | [CI #43994268776](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43994268776): Auth0 2/3 PASS; RBAC HTTP FAIL no primeiro login SQL de `neondb_owner` |
| Projeto Neon | `iam-database-delivery` / `tiny-rice-70320263` |
| Branch candidata | `validation/pr-41-rbac-e2e-20261117` |
| Branch ID | `br-quiet-night-b6cfeq4j` |
| Parent | `validation/iam-cutover-audit-20261110` / `br-muddy-bar-b63ksdy7` |
| Database | `iam_database` |
| TTL automático | **2026-11-20T01:30:00Z** |
| Estado na preparação | READY, **zero computes**, sem SQL ou credenciais geradas |
| Identidade administrativa pretendida | `neondb_owner`, exclusivamente na branch descartável |
| Runtime pretendido | `iam_app_runtime_login`, comprovar `NOBYPASSRLS` e `NOSUPERUSER` |
| Branch de aplicação | `feat/iam-api-rbac-lineage-20261110` |
| Ambiente GitHub | `Preview` (protegido; credenciais write-only para o workflow) |
| Ambiente Vercel | Preview restrito à branch da PR #41; **sem mudança em Production** |

A fixture antiga `br-royal-dream-b6di0p2w` expirou e NÃO poderá ser reutilizada. O erro `password authentication failed` também exige verificar o credencial independente do TTL. A PR [#106](https://github.com/alexoaraujo/iam-control-center-new/pull/106) contém uma guarda de expiração em Draft; **não está integrada**.

## 2. O que o revisor está sendo convidado a autorizar — Fase A

Somente após aprovação explícita conforme a Seção 4, e enquanto a branch continuar READY e dentro do TTL:

1. Ativar um compute mínimo **apenas** na branch `br-quiet-night-b6cfeq4j` dentro dos limites Free, com autosuspend padrão; registrar ID/host sem revelar senha.
2. Obter a URL **Direct (não pooled)**, TLS verificado, para `iam_database`, role `neondb_owner`, por canal privado e com finalidade **somente de diagnóstico/consulta**.
3. Executar exclusivamente preflight PostgreSQL read-only: `BEGIN READ ONLY`/SELECT de identidade de branch, `current_database`, `current_user`, metadata de roles, catálogo de schema, policies e `FORCE RLS`, contagens para **os seis IDs sintéticos reservados**, `app_private.context_keys` ativa e ledger; registrar apenas indicadores sanitizados sem registros pessoais, hashes de chaves ou credenciais.
4. Verificar a capacidade do login runtime dedicado `iam_app_runtime_login`, sem `BYPASSRLS`/superuser, as regras deny-by-default e capacidade de cleanup/rollback **por desenho**, sem executar DDL/DML.
5. Registrar os resultados, host Direct, SHA, expiração remanescente e validação independente **na PR de implementação correspondente**, nunca segredos em texto.

**Não são autorizados nesta fase:** `CREATE/ALTER/GRANT/REVOKE/DELETE/INSERT/UPDATE`, testes positivos de grant/revoke, rotação de senhas, alteração de ACL/RLS/owners, conexão em Production/Development, atualização de secrets do GitHub/Vercel, disparo E2E com escrita, backup integral, restore, cutover e merge na `main`. Não instalar `neondb_owner` no runtime da aplicação.

## 3. Pré-requisitos obrigatórios da Fase A

- [ ] Confirmar por API Neon que a branch candidata existe, é descartável, está READY, aponta ao parent exato e NÃO é Production.
- [ ] Conferir TTL, orçamento/limite do plano Free e capacidade de desligar/descartar compute sem efeito em outras branches.
- [ ] Reconciliar origem e ausência de dados sensíveis não previstos; comprovar escopo da role administrativa somente no clone.
- [ ] Confirmar isolamento de credenciais e custódia privada; não copiar passwords para issues, PRs, commits ou logs.
- [ ] Validar separação entre identidade owner do preflight e runtime `iam_app_runtime_login` com RLS obrigatório.
- [ ] Confirmar que o SHA `f786f210af97bb8938b3349519bc16b56cdaa7a5` ainda é a referência da PR #41; se mudou, requer nova revisão do escopo.
- [ ] Confirmar que o responsável pela aprovação NÃO é o próprio executor nem o autor desta solicitação.

Qualquer condição não comprovada significa **NÃO APROVAR**, com comentário explicativo **na própria PR**.

## 4. Decisão independente, exclusivamente nesta Pull Request

O revisor independente deve avaliar o diff deste documento e publicar sua decisão **na revisão desta PR**, não em uma Issue.

**Para aprovação da Fase A:** selecionar **Approve** e incluir, no corpo da revisão, exatamente:

```text
IAM_PR41_RBAC_FIXTURE_PREFLIGHT_APPROVED
project=tiny-rice-70320263
branch=br-quiet-night-b6cfeq4j
source_sha=f786f210af97bb8938b3349519bc16b56cdaa7a5
scope=compute_minimo_e_preflight_read_only
expires_at=2026-11-20T01:30:00Z
```

A revisão deve estar no **HEAD desta PR documental**, com todas as condições da Seção 3 verificadas. Um `APPROVED` sem o marcador e sem confirmação do escopo **não basta para autorização operacional**. A aprovação expira automaticamente com o TTL do clone ou alteração relevante da identidade/escopo/SHA.

**Para rejeição:** selecionar **Request changes** e identificar a condição de segurança não atendida. Não usar reviews anteriores de outras PRs como substituto.

## 5. Gates após a Fase A (fora do escopo desta aprovação)

- [ ] Preflight autenticado **read-only** PASS e evidências independentes de branch/host/database/role, 0 resíduos, ledger, HMAC ativa e RLS.
- [ ] Criar **nova solicitação de aprovação operacional** para sincronização de `NEON_RBAC_TEST_OWNER_DATABASE_URL` exclusivamente no GitHub Environment `Preview`, atualização do pin de branch/host/TTL em código/workflow, conexão runtime `NOBYPASSRLS` e teste de **escrita sintética** RBAC. Todas as credenciais apenas pelos controles privados, nunca em PR.
- [ ] Novo SHA da PR #41 com `quality`, PostgreSQL 18, `security-gate`, Auth0 E2E real 3/3, HTTP 200 após grant → HTTP 403 após revoke na mesma sessão e `cleanup=0` comprovados.
- [ ] Nova aprovação independente do SHA final antes de avaliar merge da PR #41 na `main`. A revisão documental NÃO substitui o required review do código nem o E2E.
- [ ] Descartar compute/credenciais/branch após a prova ou no vencimento; registrar rollback e ausência de resíduos.

## 6. Estados PEOS

`FIXTURE_OPERATIONAL_APPROVAL=PENDING`
`PHASE_A_COMPUTE_AND_READONLY_PREFLIGHT=BLOCKED`
`PR41_RBAC_HTTP=BLOCKED`
`PR41_MERGE=BLOCKED`
`G1_FULL_BACKUP_OWNER_APPROVED=BLOCKED`

**Esta solicitação não autoriza operações na base Production, no Auth0, no Vercel Production nem o backup integral G1.**
