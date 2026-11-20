# PEOS — Prova de conceito Bun Test sem Vitest/picomatch

**Data:** 2026-11-17 UTC. **Repositório:** `alexoaraujo/iam-control-center-new`.  
**PR técnica isolada:** [#121](https://github.com/alexoaraujo/iam-control-center-new/pull/121), **Draft**, base **branch da PR #119** (`experiment/biome-lint-no-picomatch-20261117`). **Não é PR diretamente para main.**

## 1. Problema e hipótese

A [Issue #116](https://github.com/alexoaraujo/iam-control-center-new/issues/116) documenta o advisory `GHSA-fc5q-39xc-vjpf` de `picomatch`, sem release corrigida confirmada na data. [PR #119](https://github.com/alexoaraujo/iam-control-center-new/pull/119) migrou o lint do `eslint-config-next` para Biome 2.6.8 e passou nos testes, mas o `pnpm audit` permaneceu bloqueado com `apps__web > vitest > picomatch@4.0.7`.

A [Issue #120](https://github.com/alexoaraujo/iam-control-center-new/issues/120) define a exigência de substituir o runner **sem reduzir os 96 testes em 19 arquivos**, incluindo Auth0, autorização multi-tenant, HMAC/RBAC, erro de banco, Next.js TSX e mocks.

## 2. Alterações propostas nesta PR

- `apps/web/package.json`: remover `vitest@5.0.5`, usar `bun test --isolate --globals=vitest --preload ./test-preload.ts` apenas como **runner de teste**, manter Biome/TypeScript/Next.
- `apps/web/tsconfig.json`: adicionar tipos `node` e `bun-types`. `apps/web/vitest-bun-compat.d.ts`: mapear o módulo **virtual de testes** `vitest` para `bun:test` e declarar estritamente as cinco funções de mocks que o preload disponibiliza. **Nenhum `skipLibCheck=false` alterado, `ts-ignore` ou `any` novo nos testes.**
- `apps/web/test-preload.ts`: compatibilidade **exclusiva do ambiente `bun test`** para `vi.hoisted`, `vi.stubEnv`, `vi.unstubAllEnvs`, `vi.stubGlobal`, `vi.unstubAllGlobals`; `mock.module("server-only")` só durante execução dos testes; `beforeEach` restaura limpeza de histórico de chamadas dos mocks. **Nunca importar no runtime do aplicativo.** A compatibilidade será objeto de revisão independente de isolamento e cobertura.
- Três ajustes de testes, mantendo asserções de proteção: `auth0-existing-users.test.ts` usa `Response` real e mock tipado com `fetch.preconnect` para Next 16; `authorization.test.ts` tipa o builder de transação; `db.test.ts` valida identidade do mesmo cliente via `Object.is`.
- `pnpm-lock.yaml`: regenerado **no runner GitHub Actions com pnpm 10.34.9** usando `pnpm install --lockfile-only --ignore-scripts`; obtido dos logs autenticados e commitado sem editar integridade manualmente. **`picomatch`, `vitest` e `eslint-config-next` não aparecem no lockfile da branch.** Contrato de regressão em `biome.config.test.mjs`.
- `.github/workflows/quality.yml` e `.github/workflows/vercel-deployment-guard.yml`: instalar Bun **1.4.4 explicitamente**, antes de `pnpm test`, **sem remover**, alterar, dispensar ou diminuir `pnpm audit`, `quality`, `security-gate`, lint, typecheck, unit tests, build, Preview/E2E/PG18.
- `.github/workflows/bun-runner-compat-poc.yml`: prova específica, permissões somente `contents:read`, pnpm10, Node24, `bun@1.4.4` por npm global apenas no runner; não é um required check e não concede release.

## 3. Evidências GitHub Actions autenticadas

| Escopo | SHA / run | Resultado |
| --- | --- | --- |
| Lockfile real sem picomatch | commit `db579f582dbbb9a59f7657a0dfd7f94b7911d764`; [job #134320347102](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44162665610/job/134320347102) | Gerado com pnpm 10.34.9; frozen install nos runs seguintes PASS |
| Testes nativos, contratos PEOS, lint, tipos, build e SCA | [run #44165304240](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44165304240) | POC **SUCCESS**: 96/96 testes Bun em 19 arquivos, Node contracts PASS, Biome PASS, TS PASS, build Next PASS, `pnpm audit` PASS (No known vulnerabilities found) |
| Required `quality` com Bun pinned | [run #44165550709](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44165550709) | Job `quality=SUCCESS`: auditoria, lint, typecheck, instalação Bun, testes, build |
| Guard de deploy do Vercel | [run #44165863595](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44165863595) | `deployment-config=SUCCESS`: typecheck, Bun, testes e build |
| Regressão lockfile sem Vitest/picomatch | `apps/web/biome.config.test.mjs` | Adicionada após o run anterior; **exige execução e readback no HEAD final** |
| Auth0 E2E real, callback/Preview e lease | Não há conclusão atribuível à POC | **Não inferir PASS** de checks SKIPPED/pendentes; sem autorização operacional |

**Importante:** as evidências das execuções acima são do SHA que cada run realmente testou, não aprovação retroativa para commits subsequentes. Revalidar SHA final de #121 antes de qualquer revisão/merge.

## 4. Riscos e limitações

1. O preload usa adaptação de semântica de mocks em **tests only**; requer revisão independente para garantir que não silencie falhas reais, especialmente chamadas condicionais e isolamento multi-tenant.
2. `pnpm audit` cobre a **árvore do lockfile do workspace**. O executável Bun 1.4.4 instalado **globalmente pelo runner** não faz parte desse lockfile; sua origem/versionamento e integridade requerem avaliação de cadeia de suprimentos separada. Sem afirmar que `pnpm audit` cobre a instalação global.
3. A [PR #119](https://github.com/alexoaraujo/iam-control-center-new/pull/119) ainda tem lacunas de equivalência entre as **86 regras ESLint da baseline** e o Biome. A POC do Bun não corrige essas lacunas.
4. Um `security-gate` PostgreSQL18 local com mesmo nome do `security-gate` do CI não substitui o gate integrado do SHA; a [Issue #118](https://github.com/alexoaraujo/iam-control-center-new/issues/118) acompanha a ambiguidade.
5. O gate E2E real Auth0 `grant→HTTP 200 / revoke→HTTP 403` requer Preview e identidade verdadeira, fixture Neon isolada, rollback e autorização independente; os testes de unidade não substituem esse gate.

## 5. Critérios para avanço

- [x] Substituição de Vitest em **branch isolada Draft**, sem merge/Production.
- [x] Lockfile regenerado pnpm10 e sem cadeia `picomatch`.
- [x] `pnpm audit` executado sem bypass e PASS na POC.
- [x] 96/96 regressões funcionais, Node PEOS, lint, TypeScript, Next build PASS na POC.
- [x] Required `quality` e `deployment-config` técnicos PASS em runs documentados.
- [ ] Confirmar **checks finais por SHA**, incluindo o novo contrato anti-regressão do lockfile.
- [ ] Revisor técnico independente validar shims/preload e paridade das regras; decisão formal verificável.
- [ ] Comprovar Preview/Auth0 E2E real, gates PostgreSQL18/RLS e lease/rollback, quando aplicáveis ao SHA integrado, sem alterar a trust boundary.
- [ ] Só então avaliar PR #121 (stacked) → PR #119 → `main` sob `protect-main`, por ordem e SHA aprovados.

**PEOS:** `BUN_COMPAT_POC=TECHNICALLY_PASSED`; `SCA_WORKSPACE_LOCK=PASS`; `INDEPENDENT_REVIEW=PENDING`; `AUTH0_LIVE_E2E=NOT_ATTESTED`; `MERGE_MAIN=BLOCKED`; `PRODUCTION=UNCHANGED`.
