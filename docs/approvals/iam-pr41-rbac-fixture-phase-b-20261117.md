# IAM-015 — Aprovação operacional independente: Fase B de RBAC/Auth0 E2E sintético

**Estado:** PENDING — nenhum acesso de escrita, rotação, secret ou mudança de configuração fica autorizado pela mera criação/revisão genérica deste arquivo.

## 1. Dependência: Fase A aprovada e executada (evidência verificável)

- [PR #107](https://github.com/alexoaraujo/iam-control-center-new/pull/107), SHA `ca39e0fbad4de864d24eac7a5029edfaeba9e470`: o revisor independente `alexoaraujo83` publicou revisão `APPROVED` em `2026-11-17T01:50:35Z` com o marcador e os cinco campos de escopo exigidos.
- [Evidência read-only #107](https://github.com/alexoaraujo/iam-control-center-new/pull/107#issuecomment-6935468449): Neon autenticado por conector, transações `SET TRANSACTION READ ONLY`, PostgreSQL **18.7**, `neon.branch_id` correto, **23 tabelas / 41 policies / 20 FORCE RLS**.
- Fixture reservada (6 objetos) **0/6**, `app_private.context_keys.active=1`, ledger `iam.schema_migrations=0`, `iam.tenant.read=1`.
- Teste A/B: `neondb_owner` vê agregados existentes **2 tenants / 2 identities / 2 memberships**; `iam_app_runtime_login` sem contexto vê **0/0/0**.
- `iam_app_runtime_login`: `NOSUPERUSER`, `NOBYPASSRLS`, sem acesso SELECT à chave privada. **Importante:** `neondb_owner` tem `BYPASSRLS=true`, logo seu uso deve permanecer EXCLUSIVO ao job E2E efêmero na branch descartável, nunca ao runtime.
- Compute mínimo `ep-broad-bonus-b6c5jc2y` (0.25/0.25 CU, sem pooler), Direct host `ep-broad-bonus-b6c5jc2y.c-2.sa-east-1.aws.neon.tech`. Foi suspenso após preflight e confirmado `current_state=idle`.
- **Limite da evidência:** a conexão via conector Neon não atesta o password atual do GitHub `Preview` nem o TLS de um cliente externo. São exigidos testes distintos na Fase B.

## 2. Identidade exata da autorização proposta

| Item | Valor |
| --- | --- |
| Repositório | `alexoaraujo/iam-control-center-new` |
| PR de execução | [#41](https://github.com/alexoaraujo/iam-control-center-new/pull/41), feature `feat/iam-api-rbac-lineage-20261110` |
| SHA inicial PR #41 | `f786f210af97bb8938b3349519bc16b56cdaa7a5` |
| Neon project / database | `tiny-rice-70320263` / `iam_database` |
| Child / parent | `br-quiet-night-b6cfeq4j` / `br-muddy-bar-b63ksdy7` |
| Lease | `2026-11-20T01:30:00Z`, validade obrigatória a cada ação |
| Direct endpoint | `ep-broad-bonus-b6c5jc2y` |
| Direct hostname | `ep-broad-bonus-b6c5jc2y.c-2.sa-east-1.aws.neon.tech` |
| Owner temporário E2E | `neondb_owner` **apenas child e GitHub Environment Preview** |
| Runtime Preview | `iam_app_runtime_login`, sem `BYPASSRLS` |
| Preflight de autorização | RLS e IDs 0/6 da Fase A PASS; sem gravações |

## 3. Escopo que pode ser autorizado somente com a revisão explícita

**Fase B, em sequência e fail-closed:**

1. **Revalidar Fase A:** mesmo ID de child/parent/projeto/DB, TTL suficiente para CI e cleanup; endpoint Direct; 0/6 IDs, chave ativa, ledger, RLS e identidade separada. Não usar credenciais históricas.
2. **Sincronizar apenas ambiente Preview da branch #41**, por controles privados e sem mostrar segredo: GitHub protected Environment `Preview` secret `NEON_RBAC_TEST_OWNER_DATABASE_URL` com URL **Direct** para `neondb_owner` da child e TLS verificado; Vercel Preview **branch-scoped** `DATABASE_URL` como `iam_app_runtime_login`, `AUTHZ_CONTEXT_SIGNING_KEY_HEX` correspondente à chave ativa da child, `DATABASE_RUNTIME_ROLE=iam_app_runtime_login`. Não incluir owner no runtime ou em Production. Verificar autenticação e host sem imprimir password.
3. **Revisar alteração isolada de código e workflow:** substituir de maneira consistente e testada a branch antiga `br-royal-dream-b6di0p2w`, o host antigo e o TTL em `.github/e2e/auth0-rbac.spec.cjs`, `.github/workflows/quality.yml`, `scripts/neon-rbac-fixture-binding.test.mjs` e guardar TTL da [PR #106](https://github.com/alexoaraujo/iam-control-center-new/pull/106). Aplicar somente na feature #41 após revisão de código e readback por SHA; preservar allowlist de projeto/role/host/DB e o hard gate de callback Auth0.
4. **E2E sintético de mínimo privilégio:** `neondb_owner` somente como conta inicial da transação; `SET LOCAL ROLE iam_owner` antes de INSERT/DELETE para que o DML efetivo use `NOBYPASSRLS`. Criar exclusivamente os seis IDs fixos sintéticos aprovados; `POST /api/authorization/check` na mesma sessão Auth0 após grant **200/allowed=true** e após revoke **403/allowed=false**; cleanup em `finally` e recontagem independente **0/6**. Nenhum dado real de usuários deve ser criado, exportado ou logado.
5. **Se falhar:** interromper acesso de escrita e promoção, manter registro sanitizado, executar cleanup dos seis IDs sintéticos somente na child conforme runbook aprovado, testar contagens/ledger/chave e registrar bloqueio. Não executar reset, truncate ou delete amplo.
6. **Se passar:** comprovar `quality`, PG18/RLS, binding Vercel/alias Auth0 no SHA integrado, Auth0 E2E 3/3, 200→403 e cleanup. Solicitar revisão independente do **novo SHA final** da PR #41. Expirar/revogar credenciais temporárias e suspender compute após validação sem comprometer evidências.

**Proibido em qualquer hipótese por esta aprovação:** Production, Development, backup/restore integral G1, cutover, alteração de roles/owners globais/ACL persistentes, `BYPASSRLS` em runtime, DDL ou migrations, rotação do segredo da branch parent, alteração de callbacks/Auth0 tenant global, publicação de secrets em Git/PR/log, merge sem gate, ou operação além do TTL. **Não usar a identity `neondb_owner` no Vercel runtime.**

A aprovação **não** libera rotacionar o password de `neondb_owner` na child; se estiver inválido, interromper e solicitar autorização específica de rotação da child, sem alterar parent/Production.

## 4. Aceite independente obrigatório antes da Fase B

- [ ] Confirmar novamente a revisão/escopo da Fase A [PR #107](https://github.com/alexoaraujo/iam-control-center-new/pull/107) e a identidade Neon.
- [ ] Confirmar `neondb_owner.rolbypassrls=true`, com uso exclusivo de preflight/job E2E e role efetiva `iam_owner` (`NOBYPASSRLS`) em mutações.
- [ ] Confirmar que o segredo GitHub `Preview` e os dois valores sensíveis Vercel Preview são custodiados em provider privado e limitados à branch alvo; nenhuma inclusão em arquivos versionados.
- [ ] Confirmar tratamento de expiração (mínimo 15 min em preflight, reserva suficiente para CI), rollback compensatório e `cleanup=0`.
- [ ] Confirmar plano Free, endpoint suspenso antes da nova operação, capacidade de suspensão depois e ausência de influência em outras branches.
- [ ] Confirmar que o SHA inicial `f786f210af97bb8938b3349519bc16b56cdaa7a5` ainda é a origem, sem merge em `main`.
- [ ] Revisar as permissões reais disponíveis para sincronização. Se o conector não escreve GitHub Environment secrets ou Vercel Sensitive, parar nesse ponto e pedir ação humana via console; **não** oferecer segredo em chat.

## 5. Decisão operacional APENAS nesta PR de aprovação

O revisor `alexoaraujo83` ou outro revisor independente autorizado deve emitir **nova revisão formal GitHub `APPROVED`**, sobre o **HEAD exato desta PR**, com **todos** os campos abaixo no corpo da revisão (não em Issue ou comentário informal):

```text
IAM_PR41_RBAC_FIXTURE_PHASE_B_APPROVED
project=tiny-rice-70320263
branch=br-quiet-night-b6cfeq4j
source_sha=f786f210af97bb8938b3349519bc16b56cdaa7a5
endpoint=ep-broad-bonus-b6c5jc2y
scope=preview_branch_secrets_code_binding_synthetic_rbac_grant_revoke_cleanup
expires_at=2026-11-20T01:30:00Z
```

A revisão `APPROVED` sem esses campos não libera a Fase B. `REQUEST_CHANGES` se houver condição não comprovada. Qualquer mudança relevante de SHA, identidade ou escopo exige **nova revisão**. Esta decisão não equivale a merge da PR de implementação.

## 6. Estado inicial dos gates

`PHASE_A_SQL_READONLY_PREFLIGHT=PASS`
`PHASE_A_EXTERNAL_SECRET_TLS_ATTESTATION=NOT_YET_TESTED`
`PHASE_B_OPERATIONS=PENDING_INDEPENDENT_REVIEW`
`PHASE_B_SYNTHETIC_WRITES=BLOCKED`
`PR41_RBAC_HTTP_200_403=BLOCKED`
`PR41_MERGE=BLOCKED`
`G1_FULL_BACKUP_OWNER_APPROVED=BLOCKED`
