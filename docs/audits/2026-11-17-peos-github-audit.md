# PEOS — Auditoria GitHub, correção e melhoria (2026-11-17)

**Escopo:** auditoria verificável do repositório `alexoaraujo/iam-control-center-new` no GitHub, com revisão estática dos 24 workflows e caminhos de CI relevantes. Não equivale a uma auditoria completa de Auth0, Vercel, Neon ou Backblaze e não autoriza operações externas.
**Baseline congelada para este relatório:** branch `main`, commit `17a4e86fddecc02c4326049fdf3d95fea6f4e522` (consultado por GitHub API em 2026-11-17). A PR resultante altera exclusivamente o gate documental, um teste Node e este relatório.
**Método PEOS:** Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar. Toda conclusão PASS exige artefato, SHA e hora UTC verificáveis; SKIPPED, falha e evidência ausente nunca significam PASS.

## 1. Inventário autenticado

- Repositório público, branch padrão `main`, repositório não arquivado, usuário conectado com permissão `admin`.
- Rulesets: `protect-main` (#26988310) **active**, `protect-main-hardened` (#27234161) **disabled**, `protect-release-branches` (#27234184) **active**, `protect-version-tags` (#27234225) **active**.
- `protect-main` é estrito e exige PR, uma aprovação, resolução de discussões e checks `quality` + `security-gate`, sem bypass actors. Não exige CODEOWNERS nem aprovação por terceiro após o último push; a configuração de CODEOWNERS está em [PR #46](https://github.com/alexoaraujo/iam-control-center-new/pull/46), ainda não integrada.
- [PR #41](https://github.com/alexoaraujo/iam-control-center-new/pull/41) foi MERGED; qualquer aprovação histórica pré-merge precisa ser revalidada no novo HEAD.
- PRs ainda abertas com contratos interdependentes: [#113](https://github.com/alexoaraujo/iam-control-center-new/pull/113), [#114](https://github.com/alexoaraujo/iam-control-center-new/pull/114), [#115](https://github.com/alexoaraujo/iam-control-center-new/pull/115), [#44](https://github.com/alexoaraujo/iam-control-center-new/pull/44), [#98](https://github.com/alexoaraujo/iam-control-center-new/pull/98), [#101](https://github.com/alexoaraujo/iam-control-center-new/pull/101).
- Varredura estática de 24 arquivos YAML em `.github/workflows/`: nenhuma ação `uses:` sem pin de 40 caracteres hexadecimais foi observada, nem gatilho `pull_request_target`. Este teste não verifica todas as dependências ou as permissões efetivas dos serviços externos.

## 2. Achados e severidade

### P0 — Dependência com vulnerabilidade HIGH, CI bloqueada

- Em [run #44071778272, job quality #134257521968](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44071778272/job/134257521968), às `2026-11-17T18:10:56Z`, `pnpm audit` falhou com `picomatch` / [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) (CVE-2026-112366), duas ocorrências HIGH.
- A falha precedeu lint, typecheck, unit test e build no job; todos ficaram SKIPPED. `security-gate` do CI acusou `QUALITY_NOT_SUCCESS` no job #134257886976. O gate PG18 de workflow separado não corrige essa falha.
- [Issue #116](https://github.com/alexoaraujo/iam-control-center-new/issues/116) mantém `BLOCKED_UPSTREAM_NO_PATCHED_RELEASE`. Não introduzir waiver, `continue-on-error`, downgrade do nível de auditoria nem declarar pacote corrigido sem comprovação.
- Próximo passo: acompanhar release/advisory upstream; avaliar mitigação comprovada ou alternativa com lockfile reproduzível, executar `pnpm audit` sem exceção e todos os checks no SHA final.

### P1 — Gate documental permitia autoclassificação indevida

- Na baseline, `.github/workflows/docs-preview-gate.yml` classificava a alteração do *próprio workflow* como `docs_only=true`, embora a mudança de verificador de CI seja sensível à segurança.
- `scripts/vercel-ignore-build.mjs` já trata todos os workflows como Preview relevante; portanto havia divergência entre classificadores, capaz de produzir evidência documental inadequada para alteração de política.
- **Correção desta PR:** retirar `.github/workflows/docs-preview-gate.yml` da allowlist documental, adicioná-lo aos exemplos negativos do script inline e acrescentar regressão em `scripts/vercel-ignore-build.test.mjs` para exigir Preview/E2E quando o gate for alterado.
- Manter o workflow no gatilho `pull_request.paths` para executá-lo e classificá-lo como não documental. Não tocar no `pnpm audit`, nos required checks, no Auth0 nem no vínculo de callbacks.

### P1 — Nome de required check compartilhado entre workflows

- Tanto `.github/workflows/quality.yml` quanto `.github/workflows/iam-required-security-gate.yml` publicam um job denominado `security-gate`. No SHA da [PR #115](https://github.com/alexoaraujo/iam-control-center-new/pull/115) há um check `security-gate` FAIL (`QUALITY_NOT_SUCCESS`) e outro check homônimo SUCCESS (PG18).
- O name collision dificulta triagem e pode gerar ambiguidade em required checks. **Melhoria proposta para PR separada:** criar nomes inequívocos e migrar a ruleset em mudança coordenada, sem janela sem proteção, testando os contextos obrigatórios antes e depois.

### P1 — Aprovação operacional não comprovada para novo lease Auth0

- A [PR #115 e seu contrato](https://github.com/alexoaraujo/iam-control-center-new/pull/115) documentam `UNVERIFIED` para allowlist efetiva Auth0, custódia de Environment, OIDC do provedor e aceite do operador de rollback, com `PARTIAL_GITHUB_ONLY` para exclusividade do lease.
- Reviews com estado APPROVED e valores literais `true` não substituem o readback independente, a aceitação nominal e a janela UTC. Permanecem `operational_lease_gate=BLOCKED_PENDING_EVIDENCE`, sem autorização para callback transfer ou merge.
- [PR #113 SHA `51c857a...`](https://github.com/alexoaraujo/iam-control-center-new/pull/113) tem CI/Preview/Auth0/PG18 SUCCESS no [run #44050969850](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44050969850), mas esse sucesso técnico não libera operações fora da janela e do SHA.

### P2 — Governança de revisões e release

- Ruleset ativa requer 1 review e resolução de threads, mas não `require_code_owner_review` nem `require_last_push_approval`. A [PR #46](https://github.com/alexoaraujo/iam-control-center-new/pull/46) de CODEOWNERS permanece aberta. Não alterar administrativamente a ruleset sem revisar viabilidade no plano GitHub, CODEOWNERS e reviewer independente.
- Atualizar runbook, matriz de owners, branch restrictions, ambientes protegidos e evidências de rollback em PRs próprias; não inferir status de Auth0/Neon/Vercel apenas do GitHub.

## 3. Matriz de evidências e critérios de saída

| Gate | Evidência | Estado em 2026-11-17 | Próximo critério de PASS |
| --- | --- | --- | --- |
| Branch governance | [ruleset protect-main](https://github.com/alexoaraujo/iam-control-center-new/rules/26988310) | ACTIVE; endurecimento pendente | revisão CODEOWNERS e último push aprovados |
| Quality / SCA | [run 44071778272](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44071778272) | FAIL | `pnpm audit`, lint, typecheck, testes, build SUCCESS no SHA exato |
| PostgreSQL 18 | [required security gate workflow](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-required-security-gate.yml) | Contrato sintético verificável, não produção | PG18/RLS + rollback no novo SHA |
| Auth0 E2E PR #113 | [run 44050969850](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44050969850) | PASS histórico no SHA `51c857a...` | vínculo + lease autorizado e vigente para nova operação |
| Cinco controles PR #115 | [contrato PR #115](https://github.com/alexoaraujo/iam-control-center-new/pull/115) | BLOCKED/PARTIAL | 5 readbacks independentes e janela UTC, rollback nomeado |
| Restore/backup G1 | [PR #101](https://github.com/alexoaraujo/iam-control-center-new/pull/101) | Readback independente pendente | hash + restore isolado + rollback e custódia verificados |
| Correção gate documental | esta PR | CODE CHANGE CREATED, CI NOT YET ATTESTED | diff, testes de regressão e required checks SUCCESS |

## 4. Plano de teste e rollback desta PR

1. Inspecionar diff: apenas `.github/workflows/docs-preview-gate.yml`, `scripts/vercel-ignore-build.test.mjs`, e este relatório; nenhum secret, produção, DDL, alias, API Auth0 ou Neon.
2. Verificar que a allowlist do workflow contém apenas `README.md`, `SECURITY.md`, `SCAFFOLD-MANIFEST.json`, `docs/*` e `.github/PULL_REQUEST_TEMPLATE.md`. Seu próprio arquivo deve constar da denylist negativa.
3. Executar `node --test scripts/vercel-ignore-build.test.mjs` (e `node --test scripts/*.test.mjs`), CI `quality`, `security-gate`, PG18 e testes de Preview/E2E aplicáveis no SHA criado. Não registrar PASS antes dos runs.
4. Reconhecer bloqueio de `quality` por `picomatch` até remediação; sem bypass, sem merge antecipado. Mudanças de workflow podem exigir preflight Auth0/Preview branch-specific e aprovação própria para qualquer lease.
5. Revisão independente de mudança de workflow e plano de rollback. Rollback deste patch: reverter **apenas** os commits da branch/PR após aprovação; sem mutação na `main` até merge autorizado.

**Decisão PEOS:** `AUDIT_GITHUB=PARTIAL_VERIFIED`, `DOCS_SCOPE_HARDENING=PROPOSED_IN_PR`, `QUALITY=BLOCKED`, `AUTH0_LEASE=BLOCKED`, `G1_RESTORE=BLOCKED`, `MERGE_MAIN=NOT_AUTHORIZED`, `PRODUCTION=UNCHANGED`.
