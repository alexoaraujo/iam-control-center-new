# Auth0 Free + Next.js 16 — configuração e operação

**Estado:** guia de implementação e validação. Este documento não comprova que o tenant esteja configurado nem que o fluxo E2E tenha passado.
**Stack verificada:** Next.js 16.4.3, TypeScript 6.0.3 e @auth0/nextjs-auth0 4.33.0.
**Plano:** Auth0 Free, domínio padrão do tenant e sem add-ons pagos.

## 1. Responsabilidades e confiança

- Auth0 autentica o usuário e mantém a sessão OIDC.
- A aplicação resolve identidade externa por (iss, sub); e-mail é atributo mutável.
- Membership, tenant ativo, roles e permissões pertencem à aplicação.
- Sessão autenticada não concede automaticamente acesso a tenants ou recursos.
- Browser não é confiável. Autorize cada leitura e mutação no servidor.

## 2. Criar a aplicação no Auth0

No Dashboard, crie uma aplicação **Regular Web Application**, registre domínio padrão do tenant, Client ID e Client Secret. Não habilite add-ons pagos. A página Free consultada informa que domínio personalizado exige verificação de cartão; para evitar cartão, use o domínio padrão tenant.auth0.com.

### URLs locais

Para http://localhost:3000:

| Campo | Valor |
|---|---|
| Allowed Callback URLs | http://localhost:3000/auth/callback |
| Allowed Logout URLs | http://localhost:3000 |
| Allowed Web Origins | http://localhost:3000 |

O SDK v4 monta rotas sem o prefixo legado /api.

### URLs Preview

Cadastre explicitamente o hostname autorizado:

- Callback: https://HOST_PREVIEW/auth/callback
- Logout: https://HOST_PREVIEW
- Web Origin: https://HOST_PREVIEW

Não liberar curingas amplos como https://*.vercel.app. Confirmar o hostname efetivo do deployment antes de cadastrar. Não adicionar Production nesta fase.

## 3. Variáveis

| Variável | Obrigatória | Uso |
|---|---:|---|
| AUTH0_DOMAIN | sim | host do tenant, sem https:// |
| AUTH0_CLIENT_ID | sim | Client ID da Regular Web Application |
| AUTH0_CLIENT_SECRET | sim | segredo OAuth, server-only |
| AUTH0_SECRET | sim | segredo hexadecimal de 32 bytes para criptografia de cookies |
| APP_BASE_URL | recomendada local | URL base local; em Preview dinâmico pode ser inferida do host |
| AUTH0_AUDIENCE | não consumida automaticamente | variável presente no exemplo do repo; SDK v4 exige audience via parâmetros/opções de autorização |
| AUTH0_MGMT_CLIENT_ID / AUTH0_MGMT_CLIENT_SECRET | não | reservadas para futura Management API; não usadas no login |

Gerar AUTH0_SECRET com:

    openssl rand -hex 32

Exemplo local, usando placeholders:

    APP_BASE_URL=http://localhost:3000
    AUTH0_DOMAIN=SEU_TENANT.us.auth0.com
    AUTH0_CLIENT_ID=valor-do-client-id
    AUTH0_CLIENT_SECRET=valor-do-client-secret
    AUTH0_SECRET=64-caracteres-hexadecimais-gerados

Manter os valores em apps/web/.env.local, arquivo ignorado pelo Git, e no escopo Preview da Vercel. Não usar prefixo NEXT_PUBLIC_. Não reutilizar o segredo entre aplicações. Nunca imprimir secrets em logs, CI output ou comentários.

## 4. Código existente no repositório

O cliente server-side está em apps/web/src/lib/auth0.ts:

    import { Auth0Client } from "@auth0/nextjs-auth0/server";

    export const auth0 = new Auth0Client({
      domain: process.env.AUTH0_DOMAIN!,
      clientId: process.env.AUTH0_CLIENT_ID!,
      clientSecret: process.env.AUTH0_CLIENT_SECRET!,
      secret: process.env.AUTH0_SECRET!,
      appBaseUrl: process.env.APP_BASE_URL!,
    });

O proxy Next.js 16 está em apps/web/src/proxy.ts:

    import { auth0 } from "./lib/auth0";

    export async function proxy(request: Request) {
      return await auth0.middleware(request);
    }

    export const config = {
      matcher: [
        "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
      ],
    };

O SDK monta /auth/login, /auth/logout e /auth/callback. Não criar handler legado /api/auth/[...auth0] do SDK v3 em paralelo.

Padrão de proteção server-side (adaptar à estrutura existente):

    import { redirect } from "next/navigation";
    import { auth0 } from "@/lib/auth0";

    export default async function ProtectedPage() {
      const session = await auth0.getSession();
      if (!session) redirect("/auth/login?returnTo=%2Fprotected");
      return <main>Área autenticada</main>;
    }

A sessão responde quem autenticou; não responde a qual tenant ou recurso a pessoa tem acesso. Resolver membership e permission no servidor em toda operação. Nunca confiar em tenantId, role, e-mail ou permission enviados pelo browser.

## 5. Sessão e segurança

- Usar HTTPS em Preview remoto e defaults seguros do SDK para cookies.
- Não reduzir Secure, HttpOnly ou SameSite para contornar erros.
- Não armazenar tokens ou Client Secret em localStorage, bundle cliente, query string ou logs.
- Não devolver access token ao browser sem contrato explícito de API.
- Validar returnTo; preferir paths relativos e rejeitar destinos externos não permitidos para evitar open redirect.
- Não registrar objetos completos de sessão.
- Proteger Server Actions e Route Handlers individualmente; proxy não substitui autorização por recurso.
- Para futura Management API, separar credenciais e limitar scopes.

## 6. Vercel Hobby — somente Preview

1. Configurar as variáveis Auth0 no escopo Preview.
2. Não copiar valores para Production nesta fase.
3. Fazer redeploy do Preview após configurar variáveis.
4. Confirmar hostname final e allowlists Auth0.
5. Confirmar elegibilidade Vercel Hobby: uso pessoal e não comercial. Se o produto for comercial, bloquear Hobby e não promover Production.

Nunca inserir secrets em NEXT_PUBLIC_*, vercel.json, commits ou comentários de PR.

## 7. Testes de aceitação

Checks locais/CI: lint, typecheck, testes unitários e build. Depois, com usuário de teste dedicado e secrets previstos pelo workflow Playwright:

1. Abrir rota protegida sem sessão e confirmar redirect.
2. Autenticar com usuário de teste.
3. Confirmar callback OIDC e sessão server-side.
4. Confirmar acesso à página protegida.
5. Executar logout.
6. Confirmar cookie removido/inutilizável e bloqueio posterior.
7. Registrar SHA, workflow run e evidência sem tokens/cookies.

O workflow existente tem job auth0-e2e condicional. Configurar AUTH0_E2E_ENABLED=true e os secrets exigidos pelo workflow, sem inventar nomes; usar conta dedicada sem privilégios administrativos. **SKIPPED não é PASS.** Na validação de 31/10/2026, Auth0 E2E estava SKIPPED; login interativo, callback, sessão e logout continuam pendentes.

## 8. Troubleshooting

| Sintoma | Verificar |
|---|---|
| Callback URL mismatch | protocolo, hostname e /auth/callback exatos na allowlist |
| Logout URL mismatch | origem exata em Allowed Logout URLs |
| SDK sem configuração | quatro variáveis obrigatórias; AUTH0_DOMAIN sem protocolo |
| Preview falha, local funciona | variáveis no escopo Preview e hostname real |
| Login funciona, tenant não autoriza | membership e autorização local; Auth0 não cria membership |
| E2E skipped | flag, secrets e resultado do job no SHA atual |

## 9. Limites e referências

O plano Free não equivale a SLA, suporte empresarial ou recursos avançados. Documentação SDK não comprova configuração efetiva do tenant. Redirect 307 não comprova autenticação interativa.

Referências oficiais:
- https://auth0.github.io/nextjs-auth0/
- https://github.com/auth0/nextjs-auth0
- https://github.com/auth0/nextjs-auth0/blob/main/V4_MIGRATION_GUIDE.md
- https://auth0.com/pt/pricing
- https://auth0.com/blog/handling-auth-nextjs16-with-server-actions-middleware/
