# PEOS — Automação de approvals GitHub: reduzir intervenção manual sem bypass

**Data:** 2026-11-17. **Repo:** `alexoaraujo/iam-control-center-new`.  
**Escopo deste patch:** somente o workflow `.github/workflows/quality.yml`, contrato de testes e CI isolada. Nenhuma alteração de Settings/Environments via API, Vercel, Auth0, Neon, secrets, Production ou `main`.

## Separação de aprovações

| Job | Usa ambiente protegido? | Acesso sensível | Modo após este patch |
| --- | --- | --- | --- |
| `quality` | Não | Nenhum secret real (build com variáveis inertes) | Automático |
| `preview-deployment` | **Não**, removido neste patch | GitHub checks/statuses/deployments **read-only**, sem `secrets.*` | **Automático**; verifica SHA exato, `Vercel Preview Comments`, URL e READY via checks |
| `sync-auth0-preview` | `Preview` | `secrets.VERCEL_API_TOKEN` | Mantém proteção do Environment + checagem explícita branch/alias/SHA |
| `auth0-e2e` | `Preview` | Credenciais reais Auth0, GitHub OIDC `id-token: write` | Mantém proteção do Environment, validações OIDC, callback e E2E real |
| `security-gate` integrado | Não | Verifica resultado dos jobs anteriores | Mantém fail-closed |
| `iam-canonical-isolated-restore.yml` | `IAM-Canonical-Isolated-Restore` para operações autenticadas | URLs com credenciais e DDL opcional | **Intocado**; aprovação independente continua aplicável |
| G1 Neon/B2 e ambientes de revogação | Vários ambientes específicos | Backups, restauração, revogação e credenciais | **Intocados** |

O componente `preview-deployment` não possui etapas de deploy e executa apenas leituras da API GitHub via `GH_TOKEN` de escopo read. Não precisa de Environment `Preview` para obter OIDC, pois esse job não solicita OIDC. O job `auth0-e2e` **continua** com `environment: Preview`, exigido pelo subject de OIDC esperado pelo Vercel; não substituir por ambiente fictício.

## Auditoria e validação

- Contrato automatizado `scripts/preview-readonly-approval.test.mjs`: exige que a descoberta do deployment não solicite Environment, não referencie secrets e não tenha permissões write; exige que `sync-auth0-preview`, `auth0-e2e`, OIDC e o `security-gate` permaneçam presentes.
- Workflow `.github/workflows/preview-readonly-contract.yml`: executa exclusivamente `node --test` sem Secrets, sem Environment, com `permissions: contents:read`, Action checkout fixada por SHA. Não substitui os checks `quality` e `security-gate`.
- O `quality` da baseline `main` pode seguir FAIL até a correção da vulnerabilidade `GHSA-fc5q-39xc-vjpf` nas PRs #119/#121. **Não** usar `continue-on-error`, exclusão do audit, exceção ou merge por bypass.

## A operação administrativa que NÃO pode ser executada por este conector

A configuração **Required reviewers** é propriedade administrativa de cada GitHub **Environment** e **não** da regra `protect-main`, nem dos arquivos de workflow. O conector GitHub atual **não possui ações de leitura/escrita administrativa** de Settings → Environments. Esta PR não altera o número de reviewers configurados em `Preview`.

Para eliminar **todas** as solicitações de revisão de Environment, o administrador pode acessar:

1. `https://github.com/alexoaraujo/iam-control-center-new/settings/environments`
2. Selecionar `Preview` (e cada outro Environment que deseje automatizar).
3. Em **Deployment protection rules**, desmarcar **Required reviewers** e remover qualquer **Wait timer** ou custom protection rule que exija aprovação humana; salvar.
4. Manter **Deployment branches and tags** restritos, nomes de secrets no Environment, `protect-main` e os checks `quality`/`security-gate`.
5. Validar em nova execução no SHA exato que a CI não fica em `waiting`; isso não é o mesmo que `security-gate=PASS`.

**Risco importante:** remover Required reviewers do `Preview` libera automaticamente *também* jobs que recebem `AUTH0_E2E_USERNAME/PASSWORD` e `VERCEL_API_TOKEN` quando as demais condições do workflow passarem; remover proteção dos ambientes G1/restore amplia o risco sobre backup/DDL. A mudança exige uma decisão administrativa consciente, separada da presente correção de baixo risco. Não alterar a ruleset `protect-main`, nem as condições de teste de OIDC/RBAC, para eliminar prompts.

## Estado do patch

`PREVIEW_DISCOVERY_MANUAL_APPROVAL=REMOVED_IN_BRANCH`; `PREVIEW_SECRET_JOBS_ENVIRONMENT=UNCHANGED`; `ENVIRONMENT_REQUIRED_REVIEWERS_SETTINGS=NOT_MODIFIED`; `PRODUCTION=UNCHANGED`; `MERGE_MAIN=NOT_EXECUTED`. Os jobs protegidos ainda podem exigir aprovação até que a administração altere a política do ambiente; o usuário nunca deve receber uma afirmação de que essa configuração foi alterada sem readback do GitHub.
