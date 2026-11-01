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

## Configuração Vercel — Trusted Sources

A configuração de Deployment Protection foi inspecionada visualmente e já apresenta **GitHub Actions** como Trusted Source para o repositório `alexoaraujo83/iam-control-center`, autorizado para o ambiente `preview`.

O job solicita um token GitHub Actions OIDC com audience `https://vercel.com` e o envia por meio do header `x-vercel-trusted-oidc-idp-token` somente às requisições destinadas ao hostname configurado em `E2E_BASE_URL`. O token é mascarado nos logs e não é enviado ao Auth0 nem a outros hosts.

A presença da Trusted Source no painel não prova, por si só, que a troca OIDC funcionará. A validação depende de execução real do job.

## Configuração Auth0 a verificar

No Regular Web Application do tenant `iam-control-center.us.auth0.com`, verificar sem presumir que estejam salvas:

- Allowed Callback URLs: `https://iam-control-center-preview.vercel.app/auth/callback`
- Allowed Logout URLs: `https://iam-control-center-preview.vercel.app`
- Allowed Web Origins: `https://iam-control-center-preview.vercel.app`

Usar origens exatas, sem wildcards. A conexão esperada é `Username-Password-Authentication`; não usar Google OAuth.

A inspeção visual anterior encontrou os endereços Preview nas allowlists, Username-Password-Authentication habilitada e Google OAuth desabilitada. Isso não comprova login E2E.

## GitHub Actions — ativação controlada

O job `auth0-e2e` só executa em eventos `pull_request` quando a variável de repositório `AUTH0_E2E_ENABLED` estiver definida como `true`.

Configurar manualmente, como GitHub Actions repository secrets:

- `AUTH0_E2E_USERNAME`: usuário dedicado exclusivamente aos testes.
- `AUTH0_E2E_PASSWORD`: senha desse usuário de teste.

O workflow não cria, lê, substitui ou rotaciona esses secrets. O token OIDC é obtido durante a execução e não exige um secret Vercel estático.

Enquanto a variável `AUTH0_E2E_ENABLED` não estiver habilitada, o job fica `skipped`; isso significa **BLOCKED / NOT RUN**, nunca PASS.

## Dependência de teste

O workflow instala `@playwright/test@1.64.1` em diretório temporário do runner, executa auditoria npm com nível `high` e instala apenas Chromium. A dependência não entra no runtime da aplicação.

## Critério de aprovação

Somente declarar E2E PASS quando o job efetivamente executar e comprovar login, callback, sessão persistente e logout no Preview, associado ao SHA testado.

Não aplicar migrations, não escrever em Neon Production, não alterar Auth0 ou secrets por automação e não promover Production.
