# Auth0 — configuração de desenvolvimento

**Estado:** configuração local informada pelo operador em 2026-10-26; ainda não é verificação independente do Dashboard nem prova de login E2E.

## Registro de evidência declarada — 2026-10-26

O operador informou que os seguintes valores estão preenchidos no aplicativo Auth0 e que as URLs locais estão configuradas no Dashboard. Este registro documenta a declaração recebida; não substitui captura/consulta independente nem teste real de autenticação.

| Item | Valor declarado | Estado da evidência |
|---|---|---|
| `APP_BASE_URL` | `http://localhost:3000` | INFORMADO |
| `AUTH0_DOMAIN` | `iam-control-center.us.auth0.com` | INFORMADO |
| `AUTH0_CLIENT_ID` | `yMHxHzRP7YG6QNpGEcRpnmQUj37dYVLB` | INFORMADO |
| `AUTH0_CLIENT_SECRET` | valor mascarado na conversa | NÃO VERIFICADO; segredo não registrado |
| `AUTH0_SECRET` | valor mascarado na conversa | NÃO VERIFICADO; segredo não registrado |
| Allowed Callback URLs | `http://localhost:3000/auth/callback` | INFORMADO COMO CONFIGURADO |
| Allowed Logout URLs | `http://localhost:3000` | INFORMADO COMO CONFIGURADO |
| Allowed Web Origins | `http://localhost:3000` | INFORMADO COMO CONFIGURADO |

**Não inferir:** esses dados, isoladamente, não comprovam que a aplicação seja do tipo Regular Web Application, que o SDK v4 esteja instalado, que as rotas existam ou que login/callback/logout funcionem. Não registrar valores reais dos segredos.

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

## Estado técnico observado no repositório — 2026-11-07

O SDK Auth0 v4, o cliente server-side e o entrypoint Next.js 16 `apps/web/src/proxy.ts` já existem no main auditado (`64f96d84b33aff57d9c09bbe7ff54396e651552c`). A rota `/protected` verifica apenas a existência de uma sessão Auth0; não implementa autorização IAM por tenant, membership ou permission.

O workflow contém um fluxo E2E, mas `auth0-e2e` foi SKIPPED no SHA de main auditado. Portanto login/callback/logout não estão comprovados nesse SHA. Instalação/cliente/proxy estão implementados; autenticação E2E e autorização IAM permanecem **PENDING / NOT VERIFIED**.

Toolchain atual: pnpm `10.34.9`, Next.js `16.4.3`, Node.js 24.

## Limites de autorização e segurança

- Login válido identifica o usuário, mas **não** concede automaticamente acesso a tenants nem permissões administrativas.
- Autorização de tenant/membership deve ser implementada e validada no servidor antes de proteger recursos de negócio.
- A API deve validar assinatura, `iss`, `aud`, expiração e scopes/permissions adequados; não confiar em dados de tenant enviados pelo cliente.
- Não habilitar RBAC amplo nem atribuir permissões administrativas nesta etapa.
- Não executar migrations nem realizar deploy de produção.
- A configuração do tenant Auth0 só pode ser marcada como aplicada após verificação direta no Dashboard/CLI e teste de login real.
