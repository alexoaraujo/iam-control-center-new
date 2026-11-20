# PEOS — Revisão da cadeia de PRs IAM Control Center NEW (20/11/2026)

**Repositório:** `alexoaraujo/iam-control-center-new`. **Natureza:** inventário e revisão técnica do backlog; este relatório **não** concede autorização operacional, aprovação de código, `security-gate=SUCCESS` nem release. Estado consultado nas APIs autenticadas do GitHub em 20/11/2026. **HEAD da main durante a consulta:** `0ee3e512bb761ce4d81202eb77a48a1ef9c77109`. Os estados e SHAs são transitórios e devem ser novamente validados no instante de cada alteração.

## Critério de integração

1. Update de PR **por merge commit**, preservando SHAs prévios; rebase apenas com inventário negativo comprovado de vínculos SHA/auditoria. A política está proposta na [PR #143](https://github.com/alexoaraujo/iam-control-center-new/pull/143), não aprovada ou integrada.
2. Respeitar a topologia das PRs empilhadas e atualizar primeiro a branch base. Não usar squash ou rebase no lugar de reconciliação de dependências; não usar force-push.
3. Exigir checks completos no HEAD exato após cada update; `SKIPPED`, `BLOCKED`, `FAILURE`, `PENDING` e checks de SHA anterior não são `PASS`.
4. Revisão de código não substitui lease/Auth0 E2E, autorização de alterações de credenciais, restore ou release. Não enfraquecer `protect-main`, nem promover Production como parte da reorganização.
5. Toda resolução de conflito requer revisão do conteúdo original, teste PG18/RLS e rollback, quando aplicáveis. Não escolher automaticamente um dos lados de arquivos de segurança e banco.

## Inventário: PRs abertas consultadas

Os grupos abaixo incluem **30 PRs abertas** retornadas pela busca de 20/11/2026, com situação de draft/mergeability conferida individualmente. Referências de CI: execuções registradas na própria PR, verificadas por SHA. A palavra `clean` representa apenas mergeability informada, **não** aptidão operacional de merge.

| Grupo | PRs | Diagnóstico |
| --- | --- | --- |
| Conflitos na main, com atualização/merge bloqueados | [#45](https://github.com/alexoaraujo/iam-control-center-new/pull/45), [#47](https://github.com/alexoaraujo/iam-control-center-new/pull/47), [#70](https://github.com/alexoaraujo/iam-control-center-new/pull/70), [#76](https://github.com/alexoaraujo/iam-control-center-new/pull/76), [#77](https://github.com/alexoaraujo/iam-control-center-new/pull/77), [#86](https://github.com/alexoaraujo/iam-control-center-new/pull/86) | `mergeable=false`; requer reconciliação de workflows, PG18/RLS/ACL/restore e testes completos no SHA novo. As cinco primeiras estão em Draft, #86 aberta para review, mas com conflito. |
| Cadeia Biome/Bun/Preview/G1 | [#119](https://github.com/alexoaraujo/iam-control-center-new/pull/119) → [#121](https://github.com/alexoaraujo/iam-control-center-new/pull/121) → [#125](https://github.com/alexoaraujo/iam-control-center-new/pull/125) → [#128](https://github.com/alexoaraujo/iam-control-center-new/pull/128) → [#130](https://github.com/alexoaraujo/iam-control-center-new/pull/130) | Todas Draft; a base de #125 é a branch de #121, a base de #128 é #125, e a de #130 é #128. CI integrada falha e operações Preview/Auth0 exigem lease por SHA. |
| Integração da segurança G1 | [#129](https://github.com/alexoaraujo/iam-control-center-new/pull/129) | Draft contra main; CI integrada falha. Rever duplicidade do contexto `security-gate` e proveniência PG18 antes de qualquer atualização. |
| Cadeia de drift canônico G2 | [#44](https://github.com/alexoaraujo/iam-control-center-new/pull/44) → [#126](https://github.com/alexoaraujo/iam-control-center-new/pull/126) → [#131](https://github.com/alexoaraujo/iam-control-center-new/pull/131) | #126 e #131 Draft e empilhadas, #44 aberta; CI integrada falha. Verificar esquema canônico, ACLs, memberships, migrações e PostgreSQL 18. |
| Segurança, Auth0, Environments, custódia e contratos | [#46](https://github.com/alexoaraujo/iam-control-center-new/pull/46), [#67](https://github.com/alexoaraujo/iam-control-center-new/pull/67), [#75](https://github.com/alexoaraujo/iam-control-center-new/pull/75), [#87](https://github.com/alexoaraujo/iam-control-center-new/pull/87), [#98](https://github.com/alexoaraujo/iam-control-center-new/pull/98), [#113](https://github.com/alexoaraujo/iam-control-center-new/pull/113), [#117](https://github.com/alexoaraujo/iam-control-center-new/pull/117) | Controles sensíveis e/ou histórico desatualizado; CI integrada falha no snapshot, exceto nos casos documentais isolados. #117 Draft. Não creditar automações de rotação/restore como executadas apenas por revisão do código. |
| Documentação, auditoria e solicitações de lease | [#78](https://github.com/alexoaraujo/iam-control-center-new/pull/78), [#95](https://github.com/alexoaraujo/iam-control-center-new/pull/95), [#112](https://github.com/alexoaraujo/iam-control-center-new/pull/112), [#114](https://github.com/alexoaraujo/iam-control-center-new/pull/114), [#115](https://github.com/alexoaraujo/iam-control-center-new/pull/115), [#122](https://github.com/alexoaraujo/iam-control-center-new/pull/122), [#123](https://github.com/alexoaraujo/iam-control-center-new/pull/123) | #78/#95/#112/#114/#122/#123 tinham CI SUCCESS no HEAD consultado; #115 CI FAILURE. As solicitações são documentos históricos: **não** renovam automaticamente lease vencido, autorização independente ou SHA. #123 era Draft durante o inventário. |
| Política de atualização de PR | [#143](https://github.com/alexoaraujo/iam-control-center-new/pull/143) | `mergeable=true`; PG18, documentação e qualidade PASS, porém CI `security-gate=FAIL`; não integrar ainda. |

**Total inventariado:** 30 PRs abertas, **15 Draft** e **6 com `mergeable=false`**; #132 foi consultada separadamente e estava **closed** em 20/11/2026, logo não integra a lista de abertas. Critérios de mergeability e checks podem mudar após novas execuções e atualizações da main.

## Diagnóstico reproduzível do gate da PR #143

- PR HEAD `9daa2472c6214cbb0e6a7b602c38419b3a9288e5`, base `main@0ee3e512bb761ce4d81202eb77a48a1ef9c77109`.
- [CI run 44668555003](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44668555003): `quality=SUCCESS`, `preview-deployment=SUCCESS`, `docs-preview-evidence=SUCCESS`, `sync-auth0-preview=SUCCESS` **como job**, `auth0-e2e=SKIPPED`, `security-gate=FAILURE`.
- [Security job 136064118531](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44668555003/job/136064118531): `security-gate BLOCKED: AUTH0_E2E_NOT_SUCCESS`.
- [Sync job 136064016861](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44668555003/job/136064016861): `Auth0 E2E NOT RUN: BRANCH_NOT_BOUND_TO_CALLBACK`; retorna `auth0_ready=false`, não deve ser interpretado como E2E aprovado.
- [PG18 run 44668554921](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44668554921) e [Docs run 44668554941](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44668554941) PASS **não substituem** o `security-gate` integrado.
- Solução segura: alinhar callback de Preview/branch/deployment e variáveis branch-scoped, verificar allowlist da aplicação Auth0 e lease exclusivo/rollback, executar Auth0 E2E real no SHA exato e então reexecutar a CI. Não alterar o gate para aceitar `SKIPPED`.

## Ordem de avanço recomendada

1. Concluir #143 com callback/Auth0 E2E e `security-gate` reais. O workflow de update por merge commit só estará disponível no branch padrão depois da aprovação e integração.
2. Classificar e resolver individualmente conflitos #45/#47/#70/#76/#77/#86, sem atualização cega e preservando scripts/contratos PG18.
3. Reconciliar bases empilhadas e testes por ordem: #119 → #121 → #125 → #128 → #130; em paralelo #44 → #126 → #131. Não apontar PRs filhas diretamente para main antes de integrar seus pais.
4. Reavaliar solicitações de autorização documental #112/#114/#115/#122 com novos SHAs e readback real, distinguindo review de código, lease operacional e release.
5. Executar `Ready for Review` somente quando a mudança for revisável; aprovar/mesclar apenas com `protect-main`, checks requeridos no HEAD atual e condições operacionais aplicáveis satisfeitas.

**Auditoria PEOS:** executar → verificar → corrigir → testar → revisar → validar → avançar; registrar bloqueios como bloqueios, sem autoaprovação ou bypass.
