# E2E Auth0 — PR #55

## Escopo

Os testes Playwright validam, no Preview da branch `fix/next16-proxy-r2`:

1. Acesso anônimo à rota `/protected`.
2. Redirecionamento para Universal Login do Auth0.
3. Login pela conexão `Username-Password-Authentication`.
4. Retorno pelo callback OIDC e criação da sessão.
5. Persistência da sessão em uma requisição subsequente.
6. Logout e rejeição de novo acesso protegido sem sessão.

O teste não cobre autorização IAM, RBAC, isolamento de tenant ou RLS.

## Configuração Vercel

Variável não secreta, já criada exclusivamente para a branch da PR #55:

| Chave | Ambiente | Branch | Valor |
|---|---|---|---|
| `APP_BASE_URL` | Preview | `fix/next16-proxy-r2` | `https://iam-control-center-preview.vercel.app` |

A próxima implantação da branch deve consumir essa variável. Nenhuma variável Production foi alterada.

## Configuração Auth0 a verificar

No Regular Web Application do tenant `iam-control-center.us.auth0.com`, verificar sem presumir que já estejam salvas:

- Allowed Callback URLs: `https://iam-control-center-preview.vercel.app/auth/callback`
- Allowed Logout URLs: `https://iam-control-center-preview.vercel.app`
- Allowed Web Origins: `https://iam-control-center-preview.vercel.app`

Usar origens exatas, sem wildcards. A conexão esperada é `Username-Password-Authentication`; não usar Google OAuth.

A validação do tenant não foi realizada por esta automação e permanece pendente.

## GitHub Actions — ativação controlada

O job `auth0-e2e` só executa em eventos `pull_request` quando a variável de repositório `AUTH0_E2E_ENABLED` estiver definida como `true`.

Antes de ativá-lo, configurar manualmente, como GitHub Actions repository secrets:

- `AUTH0_E2E_USERNAME`: usuário dedicado exclusivamente aos testes.
- `AUTH0_E2E_PASSWORD`: senha desse usuário de teste.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: token de bypass da proteção SSO do Preview.

O bypass é enviado somente às requisições destinadas ao hostname do Preview; não é enviado ao Auth0. O workflow não imprime credenciais e desativa screenshots, vídeos e traces.

A automação não cria, lê, substitui ou rotaciona esses secrets. Enquanto a variável `AUTH0_E2E_ENABLED` não estiver habilitada, o job fica `skipped`; isso significa **BLOCKED / NOT RUN**, nunca PASS.

## Dependência de teste

O workflow instala `@playwright/test@1.64.1` em diretório temporário do runner, executa auditoria npm com nível `high` e instala apenas Chromium. A dependência não entra no runtime da aplicação.

## Critério de aprovação

Somente declarar E2E PASS quando o job efetivamente executar e comprovar login, callback, sessão persistente e logout no Preview, associado ao SHA testado.

Não aplicar migrations, não escrever em Neon Production, não alterar Auth0 ou secrets por automação e não promover Production.
