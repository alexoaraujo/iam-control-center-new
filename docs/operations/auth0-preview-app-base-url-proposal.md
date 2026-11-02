# Proposta: configuração de APP_BASE_URL para Preview Auth0

**Status:** proposta revisável; nenhuma variável ou configuração externa foi alterada.  
**Escopo:** Vercel Preview da aplicação IAM Control Center, mantendo Auth0 como IdP.  
**Base de evidência:** branch `proposal/neon-vercel-workflow-reconciliation`, SHA `7de15f57297d14296e6a24fc89b5ea6b86dc1aaa`; consulta de metadados Vercel com `decrypt=false); inspeção do Preview e do painel Auth0 em 2026-11-02.

## 1. Achado reproduzível

O código da aplicação instancia o SDK Auth0 v4 em `apps/web/src/lib/auth0.ts` e fornece explicitamente:

```ts
appBaseUrl: process.env.APP_BASE_URL!,
```

O middleware encaminha as requisições ao `auth0.middleware(request)`. Portanto, `APP_BASE_URL` é uma dependência direta da configuração do SDK, e não apenas uma variável documental.

Na configuração Vercel consultada, com descriptografia desabilitada:

- existe `APP_BASE_URL` Preview com escopo exclusivo para `fix/next16-proxy-r2`;
- não existe `APP_BASE_URL` Preview genérica;
- não existe `APP_BASE_URL` Preview para `proposal/neon-vercel-workflow-reconciliation`;
- a consulta específica dessa branch retornou lista vazia;
- nenhum valor secreto foi descriptografado.

O Preview canônico acessado no navegador foi `https://iam-control-center-preview.vercel.app`. A página informa que o SDK Auth0 v4 está registrado, mas login/callback/logout ainda precisam de teste E2E real.

## 2. Evidência Auth0 disponível

A inspeção do painel da aplicação **IAM Control Center Web** confirmou que as listas de URLs permitidas incluem o domínio canônico Preview:

- Callback: `https://iam-control-center-preview.vercel.app/auth/callback`;
- Logout: `https://iam-control-center-preview.vercel.app`;
- Web Origin: `https://iam-control-center-preview.vercel.app`.

Também há entradas para localhost e o domínio canônico de Production. Isso comprova somente o cadastro das URLs no tenant; não comprova que o SDK conclua o fluxo de autenticação.

Não alterar Allowed Callback URLs, Allowed Logout URLs, Allowed Web Origins, client secret, sessão, consentimento ou qualquer outra configuração Auth0 nesta proposta.

## 3. Estado recomendado para revisão

| Item | Valor/decisão proposta |
|---|---|
| Vercel Project | `iam-control-center` |
| Environment | Preview |
| Key | `APP_BASE_URL` |
| Value | `https://iam-control-center-preview.vercel.app` |
| Escopo preferencial | Preview genérico, se o domínio canônico for o destino estável de todos os testes Preview |
| Alternativa conservadora | Escopo somente para a branch de integração escolhida, desde que essa branch receba o domínio canônico |
| Production | Sem alteração |
| Development | Sem alteração; manter `http://localhost:3000` |

**Decisão ainda necessária:** confirmar que o domínio `iam-control-center-preview.vercel.app` deve ser o destino estável de autenticação para os deployments Preview. Se o domínio for atribuído somente a uma branch específica, usar variável Preview branch-scoped para essa branch em vez de propagar o valor a todos os Previews.

Não usar URL efêmera de deployment como `APP_BASE_URL`: o domínio correspondente não está cadastrado nas URLs permitidas do Auth0 e pode mudar entre deployments. Não adicionar domínios aleatórios de Preview ao allowlist Auth0 como solução automática.

## 4. Plano de validação após aprovação

1. Confirmar no Vercel Domains qual deployment/branch recebe `iam-control-center-preview.vercel.app`.
2. Aplicar a variável somente em Preview, sem selecionar Development ou Production.
3. Reimplantar o Preview da branch aprovada e confirmar, sem imprimir secrets, que o runtime recebeu a origem esperada.
4. Validar resposta HTTP e redirecionamento de `/auth/login` para o domínio Auth0 correto.
5. Concluir login com uma conta de teste autorizada e verificar retorno ao callback canônico.
6. Verificar cookie/sessão server-side sem registrar tokens, cookies ou dados sensíveis.
7. Executar logout e confirmar retorno ao destino esperado.
8. Testar falhas: callback inválido, state/nonce inválido, sessão ausente e variável ausente.
9. Registrar evidências por deployment ID, branch, SHA, horário e resultado redigido.

O teste E2E deve usar conta de teste e não deve expor authorization code, access token, ID token, refresh token, cookie ou client secret nos logs/artefatos.

## 5. Critérios de aceite

- [ ] Domínio canônico Preview e branch/deployment de destino confirmados.
- [ ] Valor e escopo Preview aprovados.
- [ ] Nenhuma alteração em Production.
- [ ] Runtime confirma a origem configurada sem revelar secrets.
- [ ] Login, callback, sessão e logout E2E passam no Preview.
- [ ] Testes negativos de callback/sessão passam.
- [ ] CI e deployment correspondem ao SHA exato da proposta.
- [ ] Evidências anexadas sem tokens, cookies ou secrets.

## 6. Limites e rollback

Esta proposta não altera Vercel, Auth0, Neon, GitHub Environments, secrets ou código de autenticação. Não habilita Neon Auth; Auth0 permanece como provedor de identidade.

Antes de uma alteração futura, registrar os metadados não secretos da variável anterior (target, gitBranch, comentário e existência), sem copiar valor secreto. Se o teste falhar, remover ou reverter somente a configuração Preview aprovada, reimplantar e confirmar o retorno ao estado anterior. Não alterar Production como tentativa de correção.

## 7. Estado atual

| Controle | Estado |
|---|---|
| SDK Auth0 v4 recebe `APP_BASE_URL` | PASS — inspeção do código |
| Preview canônico acessível | PASS — inspeção do navegador |
| Domínio canônico cadastrado no Auth0 | PASS — inspeção do painel |
| `APP_BASE_URL` Preview genérica | NOT CONFIGURED |
| `APP_BASE_URL` para branch da PR #66 | NOT CONFIGURED |
| Login/callback/logout E2E | PENDING |
| Alterações externas executadas | NONE |

**Conclusão:** a configuração Preview está incompleta para a branch desta proposta. O valor sugerido é o domínio canônico Preview, condicionado à confirmação do vínculo desse domínio com o deployment que será testado. Nenhuma alteração deve ser aplicada antes dessa confirmação e da aprovação do escopo.
