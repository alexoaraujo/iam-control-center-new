# PEOS G3 — inventário imutável de drift da main (22/11/2026)

**Estado: REVIEW REQUIRED / G3 HOLD.** Este inventário é diagnóstico somente leitura. Não constitui autorização de deploy, restauração, migração, credenciais ou G3 Auth0/RBAC privilegiado.

- Baseline de confiança: merge PR #151 `6af7e9e62cbc7f6febf92e630ecf209b00b99981`, Git tree `5efd5e502d4d251f060545501c6aa94a1f154729`.
- Main observada: `aec29f9b9daaa979e02c25df2d027bd4d040aee7`, Git tree `987db2cfb0eb70e2038e9949be26138a640dd7fc`.
- GitHub compare: `ahead=103`, `behind=0`, `changed_paths=25`.
- Origem: leitura GitHub compare + duas árvores Git recursivas completas, `truncated=false` para ambas.
- Manifest estruturado correspondente: [iam-g3-main-lineage-inventory-20261122.json](iam-g3-main-lineage-inventory-20261122.json). Os valores `base_blob` e `main_blob` são identificadores **Git blob**, não SHA-256 plano.

## Arquivos críticos G3 que mantêm o mesmo blob nas duas árvores

| Caminho | Git blob idêntico |
|---|---|
| `.github/trusted/iam-main-postmerge-preflight.sh` | `a249595a6eade403248d4d12d7260387c757c4a7` |
| `.github/trusted/g3-pr128.spec.cjs` | `78c221e1d49492dc53efd95f2a1e7c235b00978e` |
| `.github/trusted/g3-pr128.playwright.config.cjs` | `2074dd5d52534ea57dc8d6dd220cf147c9bb70b3` |
| `.github/workflows/iam-main-postmerge-auth0-rbac.yml` | `f69a5578a1c3e8e7a5ea86b78177f1da6336b73e` |
| `apps/web/src/lib/authorization.ts` | `e545f7b82ca17d3f4b997364485efab3768e791b` |
| `apps/web/src/lib/readiness.ts` | `fda1fb8c977eba704d2cc50d81b7123893870260` |
| `database/migrations/lineage-policy.json` | `909aa6750c159c4faffccc10ad81335c05102122` |

## Arquivos que requerem revisão de conteúdo e autorização separada

| Status | Categoria | Caminho | Git blob na main |
|---|---|---|---|
| modified | automation_G1 | `.github/scripts/iam-g1-environment-readonly-attestation.py` | `b9550ee00ffa937ccd6ac373bd1850c1df24d656` |
| added | automation_G1 | `.github/scripts/iam-g1-verify-main-checks.py` | `0de7e06f42e4034e103531d7693b21402cb96623` |
| added | test_G1 | `.github/tests/g1-pg18-private-toc.py` | `8a53df6e5a5808bcf52b4a029daf312fa1bbfeb7` |
| added | test_G1 | `.github/tests/test-iam-g1-archive-authentication.py` | `b1e8d2bb46e39341b34ca04b4a645eace1bb4d95` |
| modified | test_G1 | `.github/tests/test-iam-g1-b2-full-readback.py` | `923e5986ae931b88b277099c97990989938f7861` |
| modified | test_G1 | `.github/tests/test-iam-g1-environment-readonly-attestation.py` | `8db7836eefd8c5e3ebf4fe5c4558243ec36deff1` |
| added | test_G1 | `.github/tests/test-iam-g1-main-checks-pagination.py` | `81469ced1a5d6d178187ff499dd1775f307ac05e` |
| added | test_G1 | `.github/tests/test-iam-g1-real-restore.py` | `b0eb94b6efb753837738aef4b10af66a663b9f7e` |
| modified | workflow_G1 | `.github/workflows/iam-g1-b2-full-readback.yml` | `404cfa1771316803826694ed3999f8a03d9645a8` |
| added | workflow_G1 | `.github/workflows/iam-g1-b2-isolated-full-restore.yml` | `54c9a32ce09422cfd781cb249249ce33e5604e0b` |
| modified | workflow_G1 | `.github/workflows/iam-g1-environments-readonly-attestation.yml` | `773e0fc311c875bbd4ac206f86bbdf7b92082893` |
| modified | workflow_G1 | `.github/workflows/iam-g1-full-recovery-contract.yml` | `4724404e561fcccd3c2fde7e4fa5fd22484fbb23` |
| added | workflow_G1 | `.github/workflows/iam-g1-real-restore-offline-contract.yml` | `5887dfa83a03f5a8d4efb9eae49775c43f0fea26` |
| modified | migration_lineage_offline | `database/offline/compare-migration-ledgers.mjs` | `6acf067157f52444c5b4428abb6b3387cfc25622` |
| modified | migration_lineage_offline | `database/offline/compare-migration-ledgers.test.mjs` | `bcb099624d12f679119843b9f4d2cf60165365dd` |
| added | documentation | `docs/operations/iam-g1-b2-authenticated-restore-design-20261121.md` | `dd473202a76e86dbed64463d38c50c136a47bf83` |
| added | documentation | `docs/operations/iam-g1-b2-real-restore-attestation-45060036018.md` | `7332c61b59caefc9e16dd2038a4a14625d3c0ef5` |
| added | documentation | `docs/operations/iam-g1-real-isolated-restore-20261122.md` | `cbb9292b7bc48ac8ec93957875edc92ebae68e5c` |
| modified | callback_preview | `scripts/auth0-preview-contract.test.mjs` | `4830c4d23a1f89b05d10a89e685c6d9376122b85` |
| modified | callback_preview | `scripts/bind-e2e-preview.mjs` | `4a9b957895738a15fc44a4700f9557cc8d5b3227` |
| modified | callback_preview | `scripts/bind-e2e-preview.test.mjs` | `f7c01083b22793324efbcd5337a8daf07514443f` |
| added | G1_executor_or_utility | `scripts/iam-g1-archive-authentication.py` | `bd17bc9366203c0886ae899e136ae6e49bf049d0` |
| modified | G1_executor_or_utility | `scripts/iam-g1-b2-full-readback.py` | `13ac05132a5f6c9fef63eef38d8e2cd13eab8a7d` |
| added | G1_executor_or_utility | `scripts/iam-g1-full-restore.py` | `2169086290d191bdf48fdb3d5d35dc9990ab606c` |
| modified | callback_preview | `scripts/sync-auth0-e2e-preview.test.mjs` | `0a69044594f356a71bd426bf271718e58648ef53` |

## Critérios obrigatórios antes de alterar o executor trusted

1. Verificar independentemente cada um dos 25 diffs, comparando com o blob de origem; não aceitar somente a coincidência do nome do arquivo.
2. Confirmar que autorização, autenticação, contexto assinado, contrato SQL, suite e workflow G3 não sofreram drift e que os testes no novo SHA mantêm o escopo.
3. Criar PR separada para um preflight com baseline atual pinada, conjunto de mudanças revisadas, verificação do commit/tree atuais, GitHub checks exatos e testes negativos para SHA/árvore/arquivo fora do manifesto. Não remover as verificações PR128/PR150/PR151.
4. Antes de liberar o workflow com segredos, renovar ou substituir por aprovação própria a lease de G3 `br-super-sound-b63gtz88` que expira em `2026-11-23T22:00:00Z`, e revalidar OIDC, owner URL do clone, callback e fixture A/B.
5. Exigir nova aprovação operacional por SHA e executar o G3 real somente a partir de `main`: grant→HTTP 200; acesso indevido→HTTP 403; revoke→HTTP 403, rollback e limpeza verificável.


### Segunda validação: modo e tipo do objeto Git

- A comparação dos objetos `git/trees?recursive=1`, além dos blobs, verificou os modos e tipos de cada um dos 25 caminhos alterados. **25/25** correspondem à diferença real entre as árvores, incluindo exclusões, adições e modificações.
- **0 alterações exclusivamente de modo**; nenhum arquivo alterado apresenta troca de tipo (regular/symlink/submodule).
- Os **sete arquivos críticos** mantêm o mesmo `sha`, `mode=100644` e `type=blob` nas duas árvores.
- O manifesto JSON agora registra `base_mode`, `main_mode`, `base_type` e `main_type` para cada caminho e inclui `tree_object_attestation` com os contadores validados.
- A verificação de identificadores e modos de objetos não substitui revisão humana do conteúdo dos diffs nem aprovação do G3; os flags de autorização permanecem `false`.

## Evidências e ressalvas

- PRs #163, #164 e #166 foram integradas com checks `quality`, `security-gate` e Auth0 E2E positivos nos HEADs que exigiam teste. No evento `push` da main, os jobs Auth0 E2E e security-gate são `SKIPPED` por escopo; PG18/CI são `SUCCESS`.
- A restauração isolada G1 (run #45060036018) está documentada. Nenhum restore ou cutover novo é autorizado.
- `iam.schema_migrations` da Development e clone G1 continua vazio, enquanto o legado contém um registro histórico; proveniência canônica bloqueada.
- Não alterar `IAM_RBAC_PR128_APPROVED_SHA` ou `NEON_RBAC_PR128_TEST_OWNER_DATABASE_URL` para contornar o gate.
- Este documento referencia estado observado em 22/11/2026. Qualquer novo commit na main invalida a aplicação deste inventário como baseline atual até nova reconciliação.

Referências: [PR #128](https://github.com/alexoaraujo/iam-control-center-new/pull/128), [PR #151](https://github.com/alexoaraujo/iam-control-center-new/pull/151), [Issue #165](https://github.com/alexoaraujo/iam-control-center-new/issues/165).
