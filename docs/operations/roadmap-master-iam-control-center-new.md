# IAM Control Center NEW — Roadmap Master v1.0

**Situação de referência:** 2026-11-10 · **Status:** Plano proposto para revisão, não autorização de cutover · **Horizonte indicativo:** 20–30 semanas · **Modo:** PEOS / Gates.

> O prazo é indicativo e as semanas S1–S30 são relativas à aprovação do plano; não configuram datas de produção aprovadas.

## Contexto de ambientes verificado

- GitHub: `alexoaraujo/iam-control-center-new`, branch `main`, SHA `53323f334dbc7e490f965f701de0718b8f79d832`. No inventário inicial, proteção main estava desabilitada.
- Vercel: `aoa4/iam-control-center-new`, Node 24, deploy Production READY no SHA de `main`. READY não é prova de Auth0 E2E nem cutover de banco.
- Neon destino: `tiny-rice-70320263` (`iam-database-delivery`), Postgres 18 São Paulo; `development` com 23 tabelas, 41 policies, 20 FORCE RLS; novo `production` ainda sem schema IAM.
- Fonte canônica legada: Neon `twilight-fire-88497009`, organização diferente. Vercel Production ainda depende da origem antiga até corte aprovado.
- Issue de segurança/migração já aberta: [#5](https://github.com/alexoaraujo/iam-control-center-new/issues/5).
- RLS: login real `iam_app_runtime_login` non-BYPASSRLS verificado; teste no-context tem visibilidade zero em development; E2E de Auth0 do último push main foi SKIPPED.

## Regras inegociáveis

1. Nunca promover Production, alterar `DATABASE_URL` de Production, copiar dados reais, aplicar DDL/GRANT persistente ou mesclar mudança de segurança sem gates e aprovação formal.
2. Todo PASS exige `commit SHA`, run ID, ambiente, evidência sanitizada e critério de aceite; skipped, missing e stale não são PASS.
3. Tenant e role nunca são autoridade do navegador. Identidade externa é `(issuer, subject)` e permissões exigem membership ativa, avaliação server-side e RLS.
4. Cumprir `SECURITY.md`: menor privilégio, sem secrets/PII em Git ou artifacts; não confiar na role owner para testes runtime.
5. Manter custo obrigatório zero (free/open-source), documentar limitações e aprovar qualquer custo antes de introduzir dependência paga.
6. Executar o protocolo PEOS: **Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar**.

## Execução ordenada por frentes

### W1 — Governança e infraestrutura (S1–S6)

| ID | Prioridade | Janela | Dono funcional | Entrega | Dependência | Critério de aceite |
|---|---|---|---|---|---|---|
| IAM-001 | P0 | S1 | Arquitetura / Produto | Aprovar escopo, ADRs, backlog, owners e Definition of Done | G0 | Documento assinado e critérios de escopo versionados |
| IAM-002 | P0 | S1–S2 | DevOps | Proteger main, restringir merge, exigir reviews e checks por SHA | IAM-001 | Regras ativas comprovadas no GitHub; simulação de merge não conforme rejeitada |
| IAM-003 | P0 | S1–S3 | DevOps | Revisar 53 branches, dependências Preview e efetuar limpeza segura | IAM-002 | Inventário, evidência das exclusões e nenhuma branch ativa/commit exclusivo apagado |
| IAM-004 | P0 | S1–S3 | DevOps / Security | Reconciliar GitHub, Vercel, Auth0 e Neon por ambiente; privilégios e segredos | IAM-002 | Matriz Development/Preview/Production verificada sem exibir secretos |
| IAM-005 | P0 | S2–S4 | DBA | Produzir baseline PostgreSQL canônica integral, manifest e hashes | IAM-004 | Snapshot read-only, restore descartável e equivalência de objetos verificada |
| IAM-006 | P0 | S3–S6 | DBA / Security | Definir ledger, provenance, locks, migration runner e recovery | IAM-005 | Bootstrap e upgrades reproduzíveis; checksum mismatch e lock tests reprovam corretamente |

**G1:** main protegida, ambientes segregados, baseline versionada e CI obrigatório.

### W2 — Segurança, identidade e APIs (S4–S10)

| ID | Prioridade | Janela | Dono funcional | Entrega | Dependência | Critério de aceite |
|---|---|---|---|---|---|---|
| IAM-007 | P0 | S4–S6 | DBA / Security | Validar role runtime, RLS, tenant-context, grants e testes cross-tenant | IAM-005, IAM-006 | A/B, no-context, insert/update indevidos e bypass negativos sob LOGIN real |
| IAM-008 | P0 | S4–S7 | Identity / QA | Homologar Auth0, login/logout, callback, sessão, timeout e E2E por SHA | IAM-004 | E2E real em Preview exato; skipped não é PASS; sem claims de autorização implícitas |
| IAM-009 | P0 | S5–S7 | Tech Lead / Product | Aprovar domínio IAM, matriz RBAC e contratos OpenAPI | IAM-001, IAM-007 | ADRs e catálogo de permissões aprovados com estados e regras de autorização |
| IAM-010 | P0 | S6–S9 | Backend | Implementar identity/membership/tenant context e autorização server-side | IAM-007, IAM-008, IAM-009 | Sem confiar em tenant/role do cliente; 401/403/404 e revogação testados |
| IAM-011 | P0 | S7–S10 | Backend | APIs protegidas, DTOs, validação, paginação, transações e idempotência | IAM-010 | Contratos API, errors e testes integração sem vazamento entre tenants |

**G2:** autenticação E2E real, APIs autorizadas, RLS A/B e denies sob login runtime real.

### W3 — Módulos IAM e painel (S8–S19)

| ID | Prioridade | Janela | Dono funcional | Entrega | Dependência | Critério de aceite |
|---|---|---|---|---|---|---|
| IAM-012 | P0 | S8–S11 | Backend / Frontend | Gestão de tenants e organizações | IAM-010 | CRUD autorizado, suspensão, estados e auditoria por tenant |
| IAM-013 | P0 | S9–S12 | Backend / Frontend | Identidades e usuários vinculados por (iss, sub) | IAM-010 | Email nunca como chave; sem associação automática ao primeiro login |
| IAM-014 | P0 | S10–S13 | Backend / Frontend | Memberships, convites, ativação e revogação | IAM-012, IAM-013 | Revogação e suspensão bloqueiam acesso imediatamente |
| IAM-015 | P0 | S11–S15 | Backend / Security | Roles, permission catalog, grupos e atribuições | IAM-009, IAM-014 | Deny-by-default, menor privilégio e logs de mudanças privilegiadas |
| IAM-016 | P1 | S12–S16 | Backend / Security | Políticas de acesso e escopo por recurso | IAM-015 | Precedência, ausência de privilégios e boundaries testadas |
| IAM-017 | P1 | S13–S17 | Backend / Security | Service accounts, API keys, rotação e revogação | IAM-015 | Tokens nunca expostos em logs ou armazenados em texto recuperável |
| IAM-018 | P0 | S14–S18 | Backend / DBA | Auditoria, security events, outbox, idempotência e consistência | IAM-010, IAM-015 | Trilha sem segredos, mesmo tenant, atomicidade e retries seguros |
| IAM-019 | P1 | S15–S19 | Frontend / UX | Dashboard administrativo acessível com filtros, formulários e indicadores | IAM-012 a IAM-018 | Fluxos reais P0/P1 navegáveis, E2E e critérios de acessibilidade aprovados |

**G3:** módulos P0/P1 testados com contratos API, UI e auditoria.

### W4 — Homologação e lançamento (S18–S30)

| ID | Prioridade | Janela | Dono funcional | Entrega | Dependência | Critério de aceite |
|---|---|---|---|---|---|---|
| IAM-020 | P1 | S18–S21 | SRE | Logs, métricas, alertas, traces, health e readiness | IAM-011 | Incidentes detectáveis, sem segredos, retenção e limites free documentados |
| IAM-021 | P0 | S19–S23 | QA / Security | Unit/integration/contract/E2E, RLS, carga e acessibilidade | IAM-019 | Critérios de cobertura e risco aprovados; zero testes críticos skipped |
| IAM-022 | P0 | S20–S23 | Security | Hardening: dependências, headers, secrets, rate limit, sessões, threat model | IAM-021 | Sem críticos/altos não resolvidos sem aceite formal temporário |
| IAM-023 | P0 | S22–S25 | QA / DBA / SRE | Homologação Staging/UAT, backup/restore e ensaio de rollback | IAM-020, IAM-021, IAM-022 | UAT aprovado, restore testado, RTO/RPO definidos e rastreáveis |
| IAM-024 | P0 | S24–S26 | DBA / Security | Cutover de dados e schema Neon legado → novo Production (issue #5) | IAM-005, IAM-006, IAM-007, IAM-023 | Ledger comprovado, dados/objeto equivalentes, aprovação de produção e rollback |
| IAM-025 | P0 | S25–S27 | DevOps / Identity | Release Vercel controlado + Auth0 E2E + smoke e promoção de SHA | IAM-008, IAM-023, IAM-024 | DATABASE_URL de produção alterada somente após gates; pós-deploy comprovado |
| IAM-026 | P1 | S27–S29 | SRE / QA | Estabilização, monitoramento, incident response e correções | IAM-025 | SLOs definidos e período de observação sem incidentes críticos |
| IAM-027 | P0 | S29–S30 | Tech Lead / Product | Documentação final, runbooks, treinamento e aceite de encerramento | IAM-026 | Evidências e handover assinados; owners, procedimentos e pendências P2 definidos |

**G4:** homologação, cutover aprovado, recuperação ensaiada, estabilização e aceite final.

## Sequência crítica / proibições de avanço

**Trilha crítica:** `IAM-002 → IAM-004 → IAM-005 → IAM-006 → IAM-007 → IAM-010 → IAM-015 → IAM-018 → IAM-021 → IAM-023 → IAM-024 → IAM-025 → IAM-026 → IAM-027`.

- `IAM-024` é bloqueado enquanto a issue #5 não cumprir G0–G6 (baseline, ledger, isolamento real, reconciliação, Auth0 E2E, backup/rollback e aprovação de cutover).
- Branches divergentes com commits exclusivos são preservadas até auditoria; o histórico da Vercel Preview e aliases de callback deve ser reconciliado antes de limpar refs.
- No Neon Free, proteção nativa da branch Production pode não estar disponível; compensar com controle de credenciais e gate externo testado; nunca declarar proteção inexistente como PASS.
- Auth0 E2E de PR ou SHA antigo não serve como evidência para novo release.

## Organização do backlog

- Uma issue por entrega `IAM-001` a `IAM-027`, vinculada a sua frente pela etiqueta de título `W1`/`W2`/`W3`/`W4` e `P0`/`P1`. A issue #5 segue como blocker de `IAM-024`.
- Campos mínimos: descrição, contexto, entregáveis, dependências, testes positivos e negativos, evidências, risco, rollback (quando aplicável), Definition of Done e responsável funcional.
- Atribuição nominal e marcos de calendário requerem aceite do Product Owner; os papéis na tabela são responsabilidades recomendadas, não pessoas já alocadas.

## Evidência de cada tarefa (formato mínimo)

```yaml
task_id: IAM-000
environment: development|preview|staging|production
repository: alexoaraujo/iam-control-center-new
source_commit_sha: <commit>
pr_url: <url>
workflow_run_urls: []
checks: [{name: lint|typecheck|test|build|sql|e2e|rls, status: PASS|FAIL|SKIPPED|BLOCKED}]
database_branch: <non-secret branch id or null>
security_review: <review URL or null>
rollback_runbook: <path or null>
gate: G1|G2|G3|G4
decision: PASS|FAIL|BLOCKED
```

## Riscos prioritários

| Risco | Impacto | Mitigação |
|---|---|---|
| `main` desprotegida | Merge sem checks | Proteção e validação de branch rules antes de mudanças críticas |
| Ledger e schema canônico divergentes | Corrupção de migração | Baseline manifest, pg_dump read-only, runner com hashes e restauração descartável |
| Alteração prematura de Vercel Production `DATABASE_URL` | Indisponibilidade / vazamento de dados | G0–G6 issue #5, rollout por estágios, rollback testado |
| Auth0 callback Preview desatualizado | Login E2E inconsistente | URL, SHA, allowlist e E2E do mesmo Preview |
| Limites de uso gratuitos | CI/Preview indisponíveis | Evitar builds duplicados, TTL de branches, orçamento zero obrigatório e exceções documentadas |
| Cross-tenant ou privileges mal configurados | Falha de segurança crítica | LOGIN real non-BYPASSRLS, signed context, RLS + autorização server-side |

## Condição de encerramento

Revisão de segurança sem findings críticos/altos não tratados; P0/P1 testados; CI, Auth0 E2E e RLS reais PASS; Neon Production reconciliado com a fonte; release Vercel promovido com SHA fixo; backup/restore e rollback comprovados; observabilidade e runbooks ativos; aceite formal com evidências.

## Issues criadas e rastreabilidade (Ciclo 01 / 10-11-2026)

**Estado:** 27 issues abertas; nenhum critério de aceite marcado como concluído por este registro. A matriz reflete organização do trabalho, não implementação concluída.

| ID | Frente | Prioridade | Issue | Status inicial |
|---|---|---|---|---|
| IAM-001 | W1: Governança e escopo | P0 | [#10](https://github.com/alexoaraujo/iam-control-center-new/issues/10) | Open / planejado |
| IAM-002 | W1: Proteção main e gates | P0 | [#11](https://github.com/alexoaraujo/iam-control-center-new/issues/11) | Open / planejado |
| IAM-003 | W1: Limpeza branches | P0 | [#12](https://github.com/alexoaraujo/iam-control-center-new/issues/12) | Open / planejado |
| IAM-004 | W1: Matriz ambientes | P0 | [#13](https://github.com/alexoaraujo/iam-control-center-new/issues/13) | Open / planejado |
| IAM-005 | W1: Baseline Postgres | P0 | [#14](https://github.com/alexoaraujo/iam-control-center-new/issues/14) | Open / planejado |
| IAM-006 | W1: Ledger / migrations | P0 | [#15](https://github.com/alexoaraujo/iam-control-center-new/issues/15) | Open / planejado |
| IAM-007 | W2: RLS e runtime | P0 | [#16](https://github.com/alexoaraujo/iam-control-center-new/issues/16) | Open / planejado |
| IAM-008 | W2: Auth0 E2E | P0 | [#17](https://github.com/alexoaraujo/iam-control-center-new/issues/17) | Open / planejado |
| IAM-009 | W2: Contratos domínio | P0 | [#18](https://github.com/alexoaraujo/iam-control-center-new/issues/18) | Open / planejado |
| IAM-010 | W2: Autorização server-side | P0 | [#19](https://github.com/alexoaraujo/iam-control-center-new/issues/19) | Open / planejado |
| IAM-011 | W2: APIs protegidas | P0 | [#20](https://github.com/alexoaraujo/iam-control-center-new/issues/20) | Open / planejado |
| IAM-012 | W3: Tenants | P0 | [#21](https://github.com/alexoaraujo/iam-control-center-new/issues/21) | Open / planejado |
| IAM-013 | W3: Identidades | P0 | [#22](https://github.com/alexoaraujo/iam-control-center-new/issues/22) | Open / planejado |
| IAM-014 | W3: Memberships | P0 | [#23](https://github.com/alexoaraujo/iam-control-center-new/issues/23) | Open / planejado |
| IAM-015 | W3: RBAC | P0 | [#24](https://github.com/alexoaraujo/iam-control-center-new/issues/24) | Open / planejado |
| IAM-016 | W3: Políticas de recurso | P1 | [#25](https://github.com/alexoaraujo/iam-control-center-new/issues/25) | Open / planejado |
| IAM-017 | W3: Service accounts / API keys | P1 | [#26](https://github.com/alexoaraujo/iam-control-center-new/issues/26) | Open / planejado |
| IAM-018 | W3: Auditoria / outbox | P0 | [#27](https://github.com/alexoaraujo/iam-control-center-new/issues/27) | Open / planejado |
| IAM-019 | W3: Dashboard | P1 | [#28](https://github.com/alexoaraujo/iam-control-center-new/issues/28) | Open / planejado |
| IAM-020 | W4: Observabilidade | P1 | [#29](https://github.com/alexoaraujo/iam-control-center-new/issues/29) | Open / planejado |
| IAM-021 | W4: QA e E2E | P0 | [#30](https://github.com/alexoaraujo/iam-control-center-new/issues/30) | Open / planejado |
| IAM-022 | W4: Hardening | P0 | [#31](https://github.com/alexoaraujo/iam-control-center-new/issues/31) | Open / planejado |
| IAM-023 | W4: Staging / backup | P0 | [#32](https://github.com/alexoaraujo/iam-control-center-new/issues/32) | Open / planejado |
| IAM-024 | W4: Migração Neon | P0 | [#33](https://github.com/alexoaraujo/iam-control-center-new/issues/33) | Open / planejado |
| IAM-025 | W4: Release Vercel | P0 | [#34](https://github.com/alexoaraujo/iam-control-center-new/issues/34) | Open / planejado |
| IAM-026 | W4: Estabilização | P1 | [#35](https://github.com/alexoaraujo/iam-control-center-new/issues/35) | Open / planejado |
| IAM-027 | W4: Encerramento | P0 | [#36](https://github.com/alexoaraujo/iam-control-center-new/issues/36) | Open / planejado |

**Bloqueador transversal de Production:** [issue #5](https://github.com/alexoaraujo/iam-control-center-new/issues/5) permanece aberta. PR de documentação: [#9](https://github.com/alexoaraujo/iam-control-center-new/pull/9).
