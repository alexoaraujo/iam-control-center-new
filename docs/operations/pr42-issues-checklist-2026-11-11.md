# IAM Control Center NEW — PR #42: issues, checklists e gates

> Data de revisão: 2026-11-11. Inventário de 28 issues abertas no GitHub. Estados OPEN / PARTIAL / BLOCKED são diagnósticos do checklist PEOS, **não** estados GitHub e não significam aceite final.

**Branch:** `feat/auth0-neon-identity-sync-20261111` (PR [#42](https://github.com/alexoaraujo/iam-control-center-new/pull/42), Draft).
**Último SHA integralmente confirmado antes desta rodada:** `dce72cf3b22c6f35136c10549de0a469a6061cee`.
**Evidências:** [CI/E2E #43128553742](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43128553742), [PostgreSQL18 #43128553647](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43128553647), [Vercel guard #43128553452](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43128553452), [Docs #43128553559](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43128553559). Todos SUCCESS nesse SHA.

## Inventário atualizado

| Issue | Prioridade | Frente | Gate PEOS | Próximo critério de aceite |
|---|---|---|---|---|
| [#5](https://github.com/alexoaraujo/iam-control-center-new/issues/5) | P0 | Cutover e migração | BLOCKED | G0–G6, ledger, rollback e autorização |
| [#10](https://github.com/alexoaraujo/iam-control-center-new/issues/10) | P0 | Governança e escopo | OPEN | Aceite de arquitetura e DoD |
| [#11](https://github.com/alexoaraujo/iam-control-center-new/issues/11) | P0 | Proteção da main | OPEN | Revisão de ruleset e required checks |
| [#12](https://github.com/alexoaraujo/iam-control-center-new/issues/12) | P0 | Limpeza de branches | OPEN | Conferir ramo de validação e política de retenção |
| [#13](https://github.com/alexoaraujo/iam-control-center-new/issues/13) | P0 | Ambientes e segredos | PARTIAL | Flag Preview isolado auditada; credenciais M2M pendentes |
| [#14](https://github.com/alexoaraujo/iam-control-center-new/issues/14) | P0 | Baseline PG18 | PARTIAL | Drift de ledger identificado; baseline origem por aprovar |
| [#15](https://github.com/alexoaraujo/iam-control-center-new/issues/15) | P0 | Runner/ledger/recovery | BLOCKED | 0003/0004 resolvido; runner checksum e restore pendentes |
| [#16](https://github.com/alexoaraujo/iam-control-center-new/issues/16) | P0 | Runtime RLS | PARTIAL | RLS runtime de sync passou; matriz completa A/B pendente |
| [#17](https://github.com/alexoaraujo/iam-control-center-new/issues/17) | P0 | Auth0 E2E | PARTIAL | Login/sync E2E passou; Management API real e IdP TTL pendentes |
| [#18](https://github.com/alexoaraujo/iam-control-center-new/issues/18) | P0 | Contratos de domínio | OPEN | Conferir iss+sub, modelos e aprovação de API |
| [#19](https://github.com/alexoaraujo/iam-control-center-new/issues/19) | P0 | Identity/member/authz service | PARTIAL | Auth0 sync server-side implementado; demais guards pendentes |
| [#20](https://github.com/alexoaraujo/iam-control-center-new/issues/20) | P0 | APIs protegidas | PARTIAL | POST /api/identity/sync E2E aprovado; demais endpoints pendentes |
| [#21](https://github.com/alexoaraujo/iam-control-center-new/issues/21) | P0 | Tenants/organizations | OPEN | CRUD com autorização e matriz multi-tenant |
| [#22](https://github.com/alexoaraujo/iam-control-center-new/issues/22) | P0 | Identidades e usuários | PARTIAL | Novos usuários E2E; backfill sintético e dry-run preparados |
| [#23](https://github.com/alexoaraujo/iam-control-center-new/issues/23) | P0 | Memberships e convites | PARTIAL | Sync sem grants comprovado; lifecycle pendente |
| [#24](https://github.com/alexoaraujo/iam-control-center-new/issues/24) | P0 | RBAC e grupos | PARTIAL | Sem grants pelo sync; grant/revoke completo pendente |
| [#25](https://github.com/alexoaraujo/iam-control-center-new/issues/25) | P1 | Políticas de acesso | OPEN | Contratos ABAC e deny-by-default |
| [#26](https://github.com/alexoaraujo/iam-control-center-new/issues/26) | P1 | Service accounts / API keys | OPEN | Escopo, rotação e revogação |
| [#27](https://github.com/alexoaraujo/iam-control-center-new/issues/27) | P0 | Audit/outbox/idempotência | OPEN | Garantia transacional e outbox |
| [#28](https://github.com/alexoaraujo/iam-control-center-new/issues/28) | P1 | Dashboard operacional | OPEN | Vincular às APIs reais e estados de erro |
| [#29](https://github.com/alexoaraujo/iam-control-center-new/issues/29) | P1 | Observabilidade/SLO | OPEN | Dashboards e alertas com retenção free |
| [#30](https://github.com/alexoaraujo/iam-control-center-new/issues/30) | P0 | Matriz QA/E2E | PARTIAL | 58 Vitest, PG18 e Auth0 E2E; cobertura restante |
| [#31](https://github.com/alexoaraujo/iam-control-center-new/issues/31) | P0 | Hardening | PARTIAL | Least privilege sync; auditoria global por concluir |
| [#32](https://github.com/alexoaraujo/iam-control-center-new/issues/32) | P0 | UAT/restore | PARTIAL | Branch TTL/rollback fixture; PITR ensaiado pendente |
| [#33](https://github.com/alexoaraujo/iam-control-center-new/issues/33) | P0 | Migração Neon Production | BLOCKED | Origem, proveniência, G0–G6 |
| [#34](https://github.com/alexoaraujo/iam-control-center-new/issues/34) | P0 | Release Vercel Production | BLOCKED | Release SHA após todos os gates |
| [#35](https://github.com/alexoaraujo/iam-control-center-new/issues/35) | P1 | Estabilização | OPEN | SLO, runbooks e incident response após release |
| [#36](https://github.com/alexoaraujo/iam-control-center-new/issues/36) | P0 | Aceite final | BLOCKED | Aceite formal e handover |

## Checklist consolidado PR #42

- [x] Session Auth0 real (login/callback/POST HTTP 200 + replay idempotente/logout) validada em Preview de SHA exato anterior.
- [x] PostgreSQL18 descartável + função estreita para auth sync + RLS e rollback.
- [x] Identificador de migration Auth0 renumerado `0004` (sem colisão com `0003_set_tenant_context_search_path.sql`).
- [x] Neon Development e clone consultados read-only: ledger de migrations vazio, esquema do ledger divergente da migração clean-install; histórico **não fabricado**.
- [x] Implementado dry-run operator-only com M2M `read:users`, paginação de dados mínimos, validação de sujeitos e checksum da fonte, sem nenhuma operação SQL.
- [x] Checklists das 17 issues diretamente afetadas receberam checkpoint específico com evidências. Demais 11 mantêm seu escopo/estado, pois esta PR não comprova seus critérios.
- [x] CI do SHA `a89f0607c29cde793be8889536b87249f8f20a44` confirmado: 4/4 workflows SUCCESS ([CI #43130444866](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43130444866), [PostgreSQL18 #43130444877](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43130444877), [Vercel #43130444865](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43130444865), [Docs #43130445003](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43130445003)); 58 Vitest, seis testes novos de dry-run CLI Node, 1 E2E Auth0 real PASS.
- [ ] Provisionar credenciais M2M autorizadas `read:users` fora do código, executar dry-run real e salvar apenas contagem/checksum sem PII.
- [ ] Comparar snapshot com Neon isolado, aprovar apply em novo branch descartável e registrar rollback/reconciliação.
- [ ] Reconciliar ledger por checksum com a baseline canônica, lock de concorrência e restore.
- [ ] Aprovar Development persistente; Production continua estritamente bloqueada.

## Fronteiras de ambiente

- **Vercel Preview da PR #42**: `AUTH0_NEON_SYNC_ENABLED=true`, `DATABASE_URL` com role restrita para Neon branch temporária `br-floral-lab-b63xaw3z`.
- **Development**: `AUTH0_NEON_SYNC_ENABLED=false`, sem migrações ou backfill aplicados.
- **Production**: nenhuma alteração autorizada. Não ativar flag nem alterar `DATABASE_URL`, segredos ou callbacks.
- A branch Neon temporária tem expiração programada para **2026-11-13T00:00:00Z**. Antes de seu vencimento, desativar Preview ou criar nova branch validada para evitar apontar para conexão expirada.

## Protocolo PEOS

Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar.
Veredictos só mudam para concluído após evidência no SHA exato. A PR continua Draft até revisão independente de Auth0/Neon, controle de alterações e gate de release.
