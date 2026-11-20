# PEOS — Inventário efetivo das regras ESLint → Biome

**Data:** 2026-11-17 UTC. **Repositório:** `alexoaraujo/iam-control-center-new`.
**Baseline autenticada:** `main` SHA `17a4e86fddecc02c4326049fdf3d95fea6f4e522`, configuração original `apps/web/eslint.config.mjs` com `eslint-config-next/core-web-vitals` e `/typescript`.
**Fonte executada:** [GitHub Actions #44159264355 — baseline-eslint-inventory](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44159264355), job `134308357699` SUCCESS. Foi executado `pnpm install --frozen-lockfile --ignore-scripts` no checkout do SHA base e `eslint --print-config src/app/page.tsx` no app.

**Escopo:** lista efetiva para **um arquivo TSX representativo** (`src/app/page.tsx`) na baseline; outros tipos de arquivo ou caminhos podem receber configurações adicionais. Cada linha abaixo foi extraída diretamente do JSON resolvido pelo ESLint, não inferida da lista de plugins.

## 1. Total e grupos habilitados

| Grupo | Regras ativas |
| --- | ---: |
| Next.js | 22 |
| React Hooks | 16 |
| Acessibilidade | 6 |
| TypeScript (lint) | 20 |
| React | 17 |
| Imports | 1 |
| ESLint (núcleo) | 4 |
| **Total** | **86** |

Severidade: `2 = error`; `1 = warning`. Nenhuma dessas regras está desativada para o TSX inspecionado.

## 2. Lista nominal completa (86 regras)

### Next.js (22)

| Regra da baseline | Severidade |
| --- | --- |
| `@next/next/google-font-display` | WARN |
| `@next/next/google-font-preconnect` | WARN |
| `@next/next/inline-script-id` | ERROR |
| `@next/next/next-script-for-ga` | WARN |
| `@next/next/no-assign-module-variable` | ERROR |
| `@next/next/no-async-client-component` | WARN |
| `@next/next/no-before-interactive-script-outside-document` | WARN |
| `@next/next/no-css-tags` | WARN |
| `@next/next/no-document-import-in-page` | ERROR |
| `@next/next/no-duplicate-head` | ERROR |
| `@next/next/no-head-element` | WARN |
| `@next/next/no-head-import-in-document` | ERROR |
| `@next/next/no-html-link-for-pages` | ERROR |
| `@next/next/no-img-element` | WARN |
| `@next/next/no-location-assign-relative-destination` | WARN |
| `@next/next/no-page-custom-font` | WARN |
| `@next/next/no-script-component-in-head` | ERROR |
| `@next/next/no-styled-jsx-in-document` | WARN |
| `@next/next/no-sync-scripts` | ERROR |
| `@next/next/no-title-in-document-head` | WARN |
| `@next/next/no-typos` | WARN |
| `@next/next/no-unwanted-polyfillio` | WARN |

### React Hooks (16)

| Regra da baseline | Severidade |
| --- | --- |
| `react-hooks/config` | ERROR |
| `react-hooks/error-boundaries` | ERROR |
| `react-hooks/exhaustive-deps` | WARN |
| `react-hooks/gating` | ERROR |
| `react-hooks/globals` | ERROR |
| `react-hooks/immutability` | ERROR |
| `react-hooks/incompatible-library` | WARN |
| `react-hooks/preserve-manual-memoization` | ERROR |
| `react-hooks/purity` | ERROR |
| `react-hooks/refs` | ERROR |
| `react-hooks/rules-of-hooks` | ERROR |
| `react-hooks/set-state-in-effect` | ERROR |
| `react-hooks/set-state-in-render` | ERROR |
| `react-hooks/static-components` | ERROR |
| `react-hooks/unsupported-syntax` | WARN |
| `react-hooks/use-memo` | ERROR |

### Acessibilidade (6)

| Regra da baseline | Severidade |
| --- | --- |
| `jsx-a11y/alt-text` | WARN |
| `jsx-a11y/aria-props` | WARN |
| `jsx-a11y/aria-proptypes` | WARN |
| `jsx-a11y/aria-unsupported-elements` | WARN |
| `jsx-a11y/role-has-required-aria-props` | WARN |
| `jsx-a11y/role-supports-aria-props` | WARN |

### TypeScript (lint) (20)

| Regra da baseline | Severidade |
| --- | --- |
| `@typescript-eslint/ban-ts-comment` | ERROR |
| `@typescript-eslint/no-array-constructor` | ERROR |
| `@typescript-eslint/no-duplicate-enum-values` | ERROR |
| `@typescript-eslint/no-empty-object-type` | ERROR |
| `@typescript-eslint/no-explicit-any` | ERROR |
| `@typescript-eslint/no-extra-non-null-assertion` | ERROR |
| `@typescript-eslint/no-misused-new` | ERROR |
| `@typescript-eslint/no-namespace` | ERROR |
| `@typescript-eslint/no-non-null-asserted-optional-chain` | ERROR |
| `@typescript-eslint/no-require-imports` | ERROR |
| `@typescript-eslint/no-this-alias` | ERROR |
| `@typescript-eslint/no-unnecessary-type-constraint` | ERROR |
| `@typescript-eslint/no-unsafe-declaration-merging` | ERROR |
| `@typescript-eslint/no-unsafe-function-type` | ERROR |
| `@typescript-eslint/no-unused-expressions` | WARN |
| `@typescript-eslint/no-unused-vars` | WARN |
| `@typescript-eslint/no-wrapper-object-types` | ERROR |
| `@typescript-eslint/prefer-as-const` | ERROR |
| `@typescript-eslint/prefer-namespace-keyword` | ERROR |
| `@typescript-eslint/triple-slash-reference` | ERROR |

### React (17)

| Regra da baseline | Severidade |
| --- | --- |
| `react/display-name` | ERROR |
| `react/jsx-key` | ERROR |
| `react/jsx-no-comment-textnodes` | ERROR |
| `react/jsx-no-duplicate-props` | ERROR |
| `react/jsx-no-undef` | ERROR |
| `react/jsx-uses-react` | ERROR |
| `react/jsx-uses-vars` | ERROR |
| `react/no-children-prop` | ERROR |
| `react/no-danger-with-children` | ERROR |
| `react/no-deprecated` | ERROR |
| `react/no-direct-mutation-state` | ERROR |
| `react/no-find-dom-node` | ERROR |
| `react/no-is-mounted` | ERROR |
| `react/no-render-return-value` | ERROR |
| `react/no-string-refs` | ERROR |
| `react/no-unescaped-entities` | ERROR |
| `react/require-render-return` | ERROR |

### Imports (1)

| Regra da baseline | Severidade |
| --- | --- |
| `import/no-anonymous-default-export` | WARN |

### ESLint (núcleo) (4)

| Regra da baseline | Severidade |
| --- | --- |
| `no-var` | ERROR |
| `prefer-const` | ERROR |
| `prefer-rest-params` | ERROR |
| `prefer-spread` | ERROR |

## 3. Evidências de preservação e lacunas

| Contrato herdado | Evidência Biome | Situação |
| --- | --- | --- |
| `react-hooks/rules-of-hooks` (ERROR) | `correctness/useHookAtTopLevel` configurada ERROR; teste negativo com Hook condicional | PASS no teste [#44159264355](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44159264355); revalidar após novo SHA |
| `react-hooks/exhaustive-deps` (WARN) | `correctness/useExhaustiveDependencies` configurada ERROR; teste negativo de dependência ausente | PASS no teste anterior; severidade endurecida, revalidar |
| `@next/next/no-img-element` (WARN) | `performance/noImgElement` configurada ERROR; teste negativo de `<img>` | PASS no teste anterior; severidade endurecida, revalidar |
| Interação acessível em JSX | `a11y/noStaticElementInteractions` configurada ERROR; teste negativo de `<div onClick>` | PASS no teste anterior; regra extra **não equivale** às 6 `jsx-a11y/*` originais |
| 14 demais regras `react-hooks/*` | Domínios recomendados Biome, sem equivalência individual comprovada | **GAP — NOT VERIFIED** |
| Demais regras de Next.js, `react/*` e `jsx-a11y/*` | Domínios Next/React Biome recomendados | **GAP — NOT VERIFIED** |
| 20 regras `@typescript-eslint/*` | Biome recomendado + `tsc --noEmit` PASS histórico | **GAP — TypeScript não substitui validações de estilo e segurança sem mapeamento explícito** |
| `import/no-anonymous-default-export` | Sem prova negativa específica | **GAP — NOT VERIFIED** |
| Gates PEOS (`quality`, `security-gate`, PG18/RLS, Auth0 E2E) | Nenhuma regra altera esses gates; checks mantidos | **PRESERVADO NO DIFF, mas gates ainda BLOCKED** |

A documentação do Next.js confirma que `eslint-config-next` incorpora regras de React, React Hooks, acessibilidade e TypeScript; `core-web-vitals` promove determinadas regras de performance. Referências: [Next.js ESLint](https://nextjs.org/docs/app/api-reference/config/eslint), [Biome domains](https://biomejs.dev/linter/domains/) e [Biome rule-source mapping](https://biomejs.dev/linter/rules-sources/).

## 4. Dependências e limite de segurança

- O lockfile da [PR #119](https://github.com/alexoaraujo/iam-control-center-new/pull/119) foi regenerado com pnpm 10.34.9, frozen install PASS e `eslint-config-next` removido.
- [Run #44157006241](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44157006241) confirmou lint Biome, typecheck, Vitest, 122 testes Node e build Next.js PASS, **mas `pnpm audit` permaneceu FAIL**, com `vitest > picomatch@4.0.7` (HIGH).
- Nenhum bypass, redução de audit, waiver, aprovação operacional, merge ou promoção Production está autorizado. A substituição de Vitest, caso desejada, exige prova equivalente para mocks, TSX, Auth0 e RBAC. [Issue #120](https://github.com/alexoaraujo/iam-control-center-new/issues/120).

**Decisão:** `ESLINT_EFFECTIVE_RULE_INVENTORY=86_VERIFIED`; `BIOME_NEGATIVE_RULES=PARTIAL_COVERAGE`; `RULE_PARITY=NOT_PROVEN`; `SCA=FAIL_HIGH_1`; `MERGE_MAIN=BLOCKED`; `PRODUCTION=UNCHANGED`.
