# Auth0 — configuração de desenvolvimento

**Estado:** preparação revisável; não representa prova de configuração aplicada no tenant nem login E2E.

## Recursos informados

| Campo | Valor | Tratamento |
|---|---|---|
| Tenant/domain | `iam-control-center.us.auth0.com` | Confirmar no Dashboard que é o domínio do tenant ativo |
| Aplicação Web | `IAM Control Center Web` | Deve ser do tipo **Regular Web Application** |
| Client ID Web | `yMHxHzRP7YG6QNpGEcRpnmQUj37dYVLB` | Identificador público da aplicação; não é segredo |
| Audience da API | `https://iam-control-center-api` | Só configurar depois de confirmar que existe um recurso API Auth0 com este Identifier |
| M2M Client ID informado | `VxWWEZo0J1vgiFFVdkfoQ9mcRrmjqwDk` | Não usar como Audience; confirmar separadamente a aplicação M2M e o recurso API |

Nenhum Client Secret, segredo de sessão ou token deve ser gravado neste documento, em GitHub Variables públicas, no código ou em logs.

## Aplicação Web — URLs para desenvolvimento local

Depois de confirmar a aplicação Web no Dashboard, configurar:

- **Allowed Callback URLs:** `http://localhost:3000/auth/callback`
- **Allowed Logout URLs:** `http://localhost:3000`
- **Allowed Web Origins:** `http://localhost:3000`

Esses caminhos correspondem ao padrão de rotas do `@auth0/nextjs-auth0` v4. Antes de habilitar, conferir a versão instalada e o middleware implementado. Não adicionar domínios Preview por curingas; registrar as URLs HTTPS exatas após identificar os domínios de Preview reais.

## Variáveis de ambiente — SDK v4

O SDK v4 usa `AUTH0_DOMAIN` sem `https://` e `APP_BASE_URL`. A configuração mínima esperada para a aplicação Web é:

- `AUTH0_DOMAIN=iam-control-center.us.auth0.com`
- `AUTH0_CLIENT_ID=yMHxHzRP7YG6QNpGEcRpnmQUj37dYVLB`
- `AUTH0_CLIENT_SECRET=<configurar como segredo no ambiente>`
- `AUTH0_SECRET=<gerar segredo aleatório forte de pelo menos 32 bytes>`
- `APP_BASE_URL=http://localhost:3000`
- `AUTH0_AUDIENCE=https://iam-control-center-api` somente após confirmar o recurso API e quando a aplicação realmente precisar solicitar token para essa API.

Use `apps/web/.env.local` localmente e os armazenamentos de segredos por ambiente no host de deploy. Não usar prefixo `NEXT_PUBLIC_` para credenciais. Nunca ler, copiar ou imprimir o conteúdo de arquivos de ambiente com segredos.

## Integração técnica ainda necessária

1. Instalar `@auth0/nextjs-auth0` v4 e atualizar o `pnpm-lock.yaml` com pnpm 10.12.1.
2. Criar o cliente server-side em `apps/web/src/lib/auth0.ts`.
3. Criar `apps/web/src/middleware.ts` para Next.js 15, montando `auth0.middleware()`.
4. Adicionar UI de login/logout e uma rota/página de sessão que não exponha tokens.
5. Testar comportamento sem configuração, sessão ausente, login/callback/logout e erros de configuração.
6. Executar lint, typecheck, testes e build; registrar evidência vinculada ao SHA do PR.
7. Depois, configurar as URLs reais de Preview e validar o fluxo E2E com o tenant.

## Limites de autorização e segurança

- Login válido identifica o usuário, mas **não** concede automaticamente acesso a tenants nem permissões administrativas.
- Autorização de tenant/membership deve ser implementada e validada no servidor antes de proteger recursos de negócio.
- A API deve validar assinatura, `iss`, `aud`, expiração e scopes/permissions adequados; não confiar em dados de tenant enviados pelo cliente.
- Não habilitar RBAC amplo nem atribuir permissões administrativas nesta etapa.
- Não executar migrations nem realizar deploy de produção.
- A configuração do tenant Auth0 só pode ser marcada como aplicada após verificação direta no Dashboard/CLI e teste de login real.
