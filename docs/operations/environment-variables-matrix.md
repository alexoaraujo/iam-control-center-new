# Matriz operacional de variáveis — IAM Control Center

**Estado do registro:** DOCUMENTADO; configuração externa parcialmente verificada.  
**Repositório:** `alexoaraujo83/iam-control-center`  
**Branch desta alteração:** `chore/iam-env-matrix-status`  
**Política:** nenhum segredo deve aparecer neste documento, em `.env.example`, em logs ou em valores de GitHub Variables.

> Este documento separa inventário de configuração, evidência de execução e aprovação. Um valor mascarado/vazio na resposta de uma API com `decrypt=false` não comprova que o segredo esteja vazio.

## 1. Ambientes e locais de aplicação

| Ambiente | Aplicação | Banco Neon pretendido | Local de configuração |
|---|---|---|---|
| Local / Development | Next.js local, `http://localhost:3000` | Branch `development` | `apps/web/.env.local` (ignorado pelo Git) e Vercel Development |
| Preview | Deploy por PR/branch | Branch `preview` isolada; não usar credenciais de produção | Vercel Preview; GitHub Environment `Preview` somente para jobs que a declarem |
| Production | Domínio `https://iam-control-center.vercel.app` | Branch `production`, somente após aprovação explícita | Vercel Production |
| GitHub Actions quality | Audit, lint, typecheck, tests e build | Nenhum banco necessário pelo workflow atual | Workflow; sem secrets customizados necessários no estado atual |
| Automação futura Neon/Vercel | Apenas se houver workflow implementado que consuma credenciais | Permissões mínimas, branches não produtivas por padrão | GitHub Environment protegido, nunca expor secrets a código de PR não confiável |

## 2. Auth0 — variáveis da aplicação

O código atual `apps/web/src/lib/auth0.ts` usa `@auth0/nextjs-auth0/server` e lê `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` e `APP_BASE_URL`.

| Variável | Tipo | Regra |
|---|---|---|
| `AUTH0_DOMAIN` | Configuração não secreta | Apenas hostname, sem `https://`; tenant atual identificado: `iam-control-center.us.auth0.com` |
| `AUTH0_CLIENT_ID` | Identificador não secreto | Client ID da aplicação Regular Web Application correspondente ao ambiente |
| `AUTH0_CLIENT_SECRET` | Segredo | Obter diretamente do Auth0; não gerar nem substituir por valor inventado |
| `AUTH0_SECRET` | Segredo de sessão | Valor aleatório forte, separado por ambiente; não reutilizar entre Development, Preview e Production |
| `APP_BASE_URL` | Configuração não secreta | URL base exata do ambiente em execução |
| `AUTH0_AUDIENCE` | Opcional | Somente quando existir API Auth0 confirmada e a aplicação solicitar tokens para ela |
| `AUTH0_MGMT_CLIENT_ID` / `AUTH0_MGMT_CLIENT_SECRET` | Opcionais | Não configurar até haver funcionalidade server-side que precise da Management API e scopes mínimos |
| `AUTH0_ISSUER_BASE_URL` | Legada para a configuração atual | Está cadastrada no Vercel, mas não é consumida pelo construtor atual do SDK v4; não usar como substituta de `AUTH0_DOMAIN` |

### Estado observado no Vercel

| Chave | Development | Preview | Production | Resultado |
|---|---|---|---|---|
| `AUTH0_DOMAIN` | Presente | Presente | Presente | CONFIGURADA; ainda não prova login |
| `AUTH0_CLIENT_ID` | Presente | Presente | Presente | CONFIGURADA; ainda não prova login |
| `AUTH0_CLIENT_SECRET` | Entrada sensível presente | Entrada sensível presente | Não apareceu no inventário | BLOQUEADA para E2E/Production até confirmar segredo válido no Auth0 e cadastrar em Production |
| `AUTH0_SECRET` | Entrada sensível presente | Entrada sensível presente | Não apareceu no inventário | BLOQUEADA para login completo em Production; valores sensíveis não foram lidos nem sobrescritos |
| `APP_BASE_URL` | `http://localhost:3000` | Valor específico da branch `feat/auth0-nextjs-sdk-integration` | `https://iam-control-center.vercel.app` | CONFIGURADA; confirmar a URL de Preview real usada por cada deploy |
| `AUTH0_ISSUER_BASE_URL` | Presente | Presente | Presente | LEGADA/REDUNDANTE para o código atual |
| `AUTH0_AUDIENCE` | Não confirmada | Não confirmada | Não confirmada | Não necessária até API/Audience serem confirmadas |
| `DATABASE_URL` | Entrada sensível presente | Não encontrada | Não encontrada | Development não verificada; Preview/Production BLOQUEADAS até credenciais runtime apropriadas |

A listagem foi feita com `decrypt=false`. Portanto, nenhuma conclusão sobre o conteúdo real dos secrets é inferida da string vazia retornada pelos metadados. URLs de callback, logout e web origins precisam ser conferidas no Dashboard Auth0 e testadas com login real; o cadastro de variáveis, isoladamente, não é prova de autenticação.

## 3. Neon PostgreSQL — conexão e automação

| Item | Estado observado | Regra de configuração |
|---|---|---|
| Projeto | `floral-surf-85783683`, região `aws-sa-east-1` | Identificador não secreto; não substitui a URL de conexão |
| Branches | `development`, `preview`, `production` existentes | Cada ambiente usa a sua branch; não apontar Preview para Production |
| Banco | `iam_control_center` | Confirmar banco e branch antes de emitir credenciais |
| Roles | `iam_owner`, `iam_migrator`, `iam_app_runtime` e outras roles observadas | Não usar owner/migrator na aplicação; roles `NOLOGIN` não são URLs runtime prontas |
| `DATABASE_URL` | Entrada sensível observada em Development; Preview/Production não confirmadas | Usar role LOGIN de privilégio mínimo, TLS e branch correspondente; migrations devem usar credencial separada |
| `NEON_PROJECT_ID` | `floral-surf-85783683` em Development e Preview | Metadado não secreto; só manter se algum código/workflow o consumir |
| `NEON_API_KEY` | Não há necessidade no workflow atual | Não criar até implementar automação Neon. Se necessário, armazenar como GitHub Secret em ambiente protegido e limitar seu uso |

**Não concluído:** a existência das branches não prova conectividade da aplicação, TLS, privilégios efetivos, isolamento por tenant ou RLS. Não foi emitida nem copiada connection string administrativa.

## 4. Vercel — projeto e deployments

| Item | Evidência observada | Estado |
|---|---|---|
| Projeto | `iam-control-center`, Next.js, Node.js 24.x | CONFIGURADO |
| Domínio principal | `iam-control-center.vercel.app` | IDENTIFICADO |
| Deployment consultado | Estado `READY`, target reportado como `null` | READY não prova que seja Production nem que Auth0/DB funcionem |
| Proteção de deployment | SSO protection `all_except_custom_domains` | Considerar em testes automatizados e acesso a Preview |
| Variáveis de runtime | Inventário disponível, secrets não revelados | Configuração parcial; conferir escopo por ambiente e branch |
| Token Vercel em GitHub | Não requerido pelo workflow atual | Preferir Git Integration/OIDC; só criar token se um workflow explícito exigir |

Não promover nem disparar deployment de Production como parte desta configuração. Depois de mudar variáveis no Vercel, criar um novo Preview e verificar o status associado ao SHA exato do PR.

## 5. GitHub Actions — Variables e Secrets

O workflow `.github/workflows/quality.yml` fixa Node.js 24 e pnpm 10.12.1 no YAML e executa audit, lint, typecheck, testes e build. Não lê secrets de Auth0, Neon ou Vercel no job `quality`.

| Local GitHub | Variável/secret | Decisão atual |
|---|---|---|
| Repository Variables | Nenhuma necessária | Não duplicar Node/pnpm como variables sem alterar o workflow para consumir `${{ vars.NAME }}` |
| Repository Secrets | Nenhum necessário para o workflow atual | Não cadastrar credenciais sem consumidor implementado |
| Environment `Preview` | Usado pelo job `preview-deployment` | O job espera um status de deploy Vercel associado ao SHA do PR |
| Environment `Development` | Não é declarado pelo workflow atual | Criar/configurar apenas quando houver job que o utilize; verificar alinhamento com regras de proteção |
| `NEON_API_KEY` | Futuro, apenas para automação Neon | NÃO CRIAR ainda |
| `VERCEL_API_TOKEN` | Futuro, apenas se workflow explícito exigir token | NÃO CRIAR ainda; preferir integração nativa/OIDC |
| `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `DATABASE_URL` | Segredos do runtime da aplicação | Não são secrets de CI no workflow atual; manter no Vercel por ambiente |

**Limitação de execução:** a integração disponível nesta sessão permite consultar e editar arquivos do repositório e consultar Vercel/Neon, mas não disponibilizou operação de escrita para GitHub Actions Repository/Environment Variables ou Secrets. Esses cadastros não foram realizados nem serão declarados como concluídos.

## 6. Matriz-alvo de valores por ambiente

| Chave | Local/Development | Preview | Production |
|---|---|---|---|
| `APP_BASE_URL` | `http://localhost:3000` | URL HTTPS exata do Preview atual | `https://iam-control-center.vercel.app` |
| `AUTH0_DOMAIN` | Tenant de desenvolvimento aprovado | Tenant/configuração de teste aprovada | Tenant de produção aprovado |
| `AUTH0_CLIENT_ID` | Client ID válido | Client ID válido para Preview | Client ID de produção confirmado |
| `AUTH0_CLIENT_SECRET` | Segredo Auth0 de Development | Segredo Auth0 de Preview | Segredo Auth0 de Production |
| `AUTH0_SECRET` | Secret exclusivo de Development | Secret exclusivo de Preview | Secret exclusivo de Production |
| `DATABASE_URL` | Role runtime na branch `development` | Role runtime na branch `preview` | Role runtime na branch `production`, após aprovação |
| `AUTH0_AUDIENCE` | Opcional, após confirmar API | Opcional, após confirmar API | Opcional, após confirmar API |
| `NEON_PROJECT_ID` | Opcional, se consumido por automação | Opcional, se consumido por automação | Não habilitar sem necessidade aprovada |
| `AUTH0_MGMT_CLIENT_SECRET` | Não configurar sem necessidade | Não configurar sem necessidade | Não configurar sem necessidade |

A matriz é o alvo recomendado, não uma declaração de que todos os valores estejam cadastrados ou verificados.

## 7. GitHub Environments — lista de cadastro futura

Antes de criar secrets/variables, implementar e revisar o workflow consumidor. Quando necessário, preferir Environment Secrets em vez de Repository Secrets para limitar escopo:

- `Preview`: somente credenciais de Preview e automações não produtivas.
- `Development`: somente se um job de CI/CD declarar `environment: Development`.
- `Production`: somente em fluxo aprovado, com reviewers/proteções e sem deploy automático não autorizado.

Não colocar Client Secrets, session secrets, connection strings ou API keys em GitHub Variables (que são valores não secretos). Nunca expor credenciais a workflows de fork/PR não confiável.

## 8. Modelo `.env.example`

O arquivo raiz `.env.example` é o modelo local. Ele deve conter somente nomes e placeholders vazios; copie para `apps/web/.env.local`, que não deve ser commitado. Tokens de automação Vercel/Neon não pertencem ao ambiente runtime da aplicação, salvo implementação explícita que justifique isso.

## 10. Como registrar status corretamente

Use os seguintes estados de forma consistente:

| Estado | Quando usar |
|---|---|
| `NOT CONFIGURED` | Não há cadastro confirmado no destino |
| `CONFIGURED` | A API/dashboard confirmou que a variável existe no ambiente e escopo esperado |
| `CONFIGURED_UNVERIFIED` | Existe cadastro, mas valor/credencial ou integração não foi testada |
| `PASS` | Teste real concluído com sucesso, no ambiente e SHA exatos, com evidência anexável |
| `FAIL` | Teste executado e falhou; registrar erro redigido, sem segredos |
| `BLOCKED` | A verificação depende de credencial, permissão, ferramenta ou decisão que não está disponível |
| `NOT APPLICABLE` | A variável não é consumida pelo código/workflow atual |

Para cada item, registrar: nome da variável, destino, ambiente/branch, tipo (config/secret), origem do valor sem revelar o valor, ação aplicada, resultado da leitura de metadados, teste realizado, timestamp UTC, repositório/branch/SHA e URL da execução. Não usar `PASS` para existência de secret, build isolado ou deployment `READY` sem validar o comportamento pretendido.

## 11. Bloqueios e próximos passos rastreáveis

1. **BLOCKED — governança:** a API do GitHub reportou o repositório como `public`, enquanto o README e a documentação dizem privado. Confirmar e corrigir a visibilidade no GitHub antes de armazenar credenciais ou depender de controles específicos de repositório privado. Esta alteração não muda a visibilidade.
2. **BLOCKED — Auth0:** confirmar/cadastrar secrets de Production e registrar Allowed Callback URLs, Allowed Logout URLs e Allowed Web Origins para o domínio real; depois executar login/callback/logout E2E.
3. **BLOCKED — Neon:** criar/confirmar roles de runtime com LOGIN e privilégio mínimo, emitir URLs por branch sem usar role administrativa, configurar Preview/Production e testar conexão real.
4. **BLOCKED — GitHub Actions settings:** cadastrar secrets/variables somente quando houver workflow consumidor; a ferramenta de escrita desses settings não está disponível nesta sessão.
5. **PENDING — evidência de entrega:** abrir PR para esta documentação, aguardar checks para o SHA exato e manter o PR Draft até revisão e evidências aprovadas.
6. **PENDING — Production:** não executar deployment/promote de Production sem aprovação explícita e pacote de evidências de Preview.

Nenhuma migration foi executada e nenhuma credencial sensível foi exibida ou sobrescrita nesta entrega.
