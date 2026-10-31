# Revisão de configuração por ambiente — 2026-10-31

**Status:** auditoria documental e de configuração somente leitura; ajustes externos pendentes.
**Base GitHub:** `main` em `c0323194be7962cd9a641418e0746715a8bf2b82`.
**Referências normativas:** `alexoaraujo83/configuracao-doc`, especialmente:
- `docs/09-planos-free/README.md`
- `docs/18-provisionamento-multiplos-projetos/02-ambientes-free.md`
- `docs/18-provisionamento-multiplos-projetos/03-matriz-variaveis.md`
- `docs/00-fontes-oficiais/github.md`
- `docs/16-manuais-implementacao/02-auth0-nextjs.md`
- `docs/16-manuais-implementacao/03-neon-postgresql.md`

## 1. Decisões normativas aplicáveis

1. Não presumir recursos pagos, trials ou add-ons.
2. GitHub Free em repositório privado não oferece Rulesets/branch protection e GitHub Environments com secrets como mecanismo de enforcement equivalente aos planos pagos.
3. Não tornar o repositório público apenas para obter controles gratuitos.
4. Vercel Hobby é para projetos pessoais/não comerciais; não hospedar SaaS comercial nesse plano.
5. Auth0 Free usa tenant único e quota compartilhada de Applications; não criar clients por ambiente sem conferir a quota.
6. Neon: Production usa a branch root; Development usa branch persistente; Preview usa branch não produtiva. Branches não são backup.
7. Secrets ficam no runtime/host apropriado, não em GitHub Variables, arquivos versionados ou logs. Não copiar segredos entre ambientes.
8. Não executar migrations ou deploy Production sem aprovação explícita.

## 2. Estado observado

### GitHub

| Item | Evidência observada | Avaliação |
|---|---|---|
| Visibilidade | API do repositório retorna `private` | Confirmado |
| Branch padrão | `main` | Confirmado |
| SHA auditado | `c0323194be7962cd9a641418e0746715a8bf2b82` | Baseline |
| PRs abertos após limpeza | 0 | Confirmado no momento da consulta |
| Rulesets / proteção | API retorna 403 para recursos de regras/proteção no contexto atual | Não verificável; não declarar enforcement |
| GitHub Actions | Workflow `quality.yml` usa `permissions: contents: read`, actions fixadas por SHA e executa audit/lint/typecheck/test/build | Configuração do workflow observada |
| Secrets/variables Actions | Workflow atual não consome secrets/vars customizadas | Não cadastrar itens sem consumidor |

**Ajuste de governança:** manter o repositório privado. No plano Free, reduzir escritores de `main`, manter PR como procedimento operacional e CI como evidência de qualidade. Isso não equivale a proteção server-side obrigatória. Não afirmar que o ruleset `main ci quality` está aplicado enquanto não houver evidência no painel/API.

### Vercel

Projeto observado: `iam-control-center`, framework Next.js, Node.js `24.x`, projeto na equipe identificada pela integração. O projeto retornou `live: false`; o deployment mais recente estava `READY`, sem target Production comprovado. SSO protection estava habilitada para deployments exceto custom domains.

Domínios observados:
- `iam-control-center.vercel.app`
- `iam-control-center-preview.vercel.app`, atualmente associado à branch `test/auth0-playwright-preview-e2e`.

Variáveis observadas sem descriptografar valores:
- `AUTH0_DOMAIN` e `AUTH0_CLIENT_ID`: compartilhadas entre Development, Preview e Production.
- `AUTH0_CLIENT_SECRET`: entradas separadas por Development, Preview e Production.
- `AUTH0_SECRET`: entradas separadas por Development, Preview e Production.
- `DATABASE_URL`: entradas para Development, Preview e Production; valores secretos não foram lidos.
- `APP_BASE_URL`: Development usa localhost; Production usa o domínio principal; Preview possui entrada vinculada à branch antiga `test/auth0-playwright-preview-e2e`.
- `AUTH0_ISSUER_BASE_URL`: existe como variável legada compartilhada; a configuração padrão do SDK v4 usa `AUTH0_DOMAIN`.
- `NEON_PROJECT_ID`: está configurada para os três targets, apesar de comentário antigo mencionar apenas Development/Preview.

**Ajustes necessários na Vercel:**
1. Corrigir/remover a associação da variável Preview `APP_BASE_URL` à branch antiga e confirmar a URL de Preview que será mantida.
2. Corrigir/remover a associação do domínio `iam-control-center-preview.vercel.app` à branch antiga; não reatribuir até existir branch Git ativa e URL aprovada.
3. Conferir que os valores de `DATABASE_URL` apontam para a branch Neon correta em cada target. A listagem sem descriptografia confirma nomes/escopos, não validade nem destino das conexões.
4. Não remover variáveis legadas nem alterar secrets sem teste do consumidor e plano de rollback.
5. **Decisão do projeto em 31/10/2026:** o IAM Control Center não será oferecido como SaaS comercial neste momento; a possibilidade poderá ser reavaliada futuramente. Manter o plano Vercel Hobby somente enquanto o uso permanecer pessoal/não comercial. Antes de qualquer oferta comercial, reavaliar elegibilidade e migrar para plano/hospedagem compatível.

### Neon

Projeto: `floral-surf-85783683`.

| Ambiente/branch | ID | Estado | Observação |
|---|---|---|---|
| Production | `br-super-flower-b6k7w8wp` | ready | Branch root/default |
| Development | `br-mute-pine-b6lc6bip` | ready | Branch persistente |
| Preview | `br-lucky-fog-b6vv08bq` | ready | Branch não produtiva |
| Migração — review | `br-fancy-bird-b6j7etpp` | ready | Preservar para revisão |
| Migração — test | `br-green-cloud-b6gin5ni` | ready | Preservar para testes |
| RLS test | `br-super-darkness-b6a0w5vc` | ready | Preservar para testes |

As três branches principais estão prontas. A consulta de roles mostra nomes de roles administrativos, migrator e runtime, mas não prova grants, ownership, RLS ou capacidade efetiva de login. Algumas roles listadas retornam `authentication_method: no_login`; isso exige validação específica antes de usar qualquer uma como credencial de conexão. Não alterar roles nem senhas nesta auditoria.

**Ajustes necessários no Neon:**
1. Verificar grants, memberships, owner, LOGIN/NOLOGIN e atributos de privilégio de `iam_owner`, `iam_migrator` e `iam_app_runtime` em cada branch principal.
2. Garantir que a aplicação use exclusivamente role runtime com LOGIN e privilégio mínimo; migrator/owner nunca serão credenciais de runtime.
3. Confirmar RLS e isolamento por tenant com testes negativos antes de declarar PASS.
4. Não aplicar a migration `0001_initial_iam_schema.sql`; ela permanece proposta não aprovada.

### Auth0

O repositório registra o tenant `iam-control-center.us.auth0.com`, a aplicação Web e o identificador de API como valores informados pelo operador, não como verificação independente do Dashboard. A ferramenta disponível nesta auditoria não oferece leitura/escrita direta do Dashboard Auth0.

Requisitos documentais:
- Tenant Free único; controlar a quota total de até 10 Applications.
- Não usar Google OAuth2; manter a conexão Database `Username-Password-Authentication` conforme decisão do projeto.
- SDK `@auth0/nextjs-auth0` v4: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET`, `APP_BASE_URL`.
- Callback local: `http://localhost:3000/auth/callback`; logout/origin local: `http://localhost:3000`.
- Registrar URLs exatas de Preview e Production no Dashboard; não usar wildcard amplo.
- API: Maximum Access Token Lifetime = 900 segundos; Allow Skipping User Consent desabilitado, conforme decisão do operador. A decisão não prova que foi salva.
- Não habilitar recursos pagos ou dependentes de cartão.

## 3. Matriz-alvo por ambiente

| Configuração | Development | Preview | Production |
|---|---|---|---|
| Git | branch de trabalho | PR/branch ativa | `main`, promoção aprovada |
| Vercel | Development/local | Preview | Production somente após elegibilidade e aprovação |
| Auth0 | tenant Free; client/credencial dev conforme quota | callback exato; credencial isolada quando viável | callback/logout/origin do domínio oficial |
| Neon | `development` | `preview` | root `production` |
| `APP_BASE_URL` | `http://localhost:3000` local | URL HTTPS real do deployment aprovado; evitar branch obsoleta | `https://iam-control-center.vercel.app` |
| `AUTH0_SECRET` | segredo próprio | segredo próprio, diferente de Development | segredo próprio, diferente dos demais |
| `AUTH0_CLIENT_SECRET` | credencial do client selecionado | credencial do client selecionado | credencial de Production |
| `DATABASE_URL` | role runtime + branch Development | role runtime + branch Preview | role runtime + branch root Production |
| Deploy | sem secrets de produção | dados sintéticos; sem acesso ao DB Production | aprovação explícita; não autorizado por este documento |

## 4. Itens que não devem ser criados no GitHub Actions agora

O workflow atual executa somente qualidade e não consome variáveis/segredos customizados. Portanto, o mínimo requerido de Repository secrets, Repository variables e Environment secrets/variables para o workflow atual é **nenhum**.

Não cadastrar `NEON_API_KEY`, `VERCEL_API_TOKEN`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` ou `DATABASE_URL` em GitHub Actions até existir workflow confiável que os consuma e justificativa de escopo. A aplicação deve receber credenciais no runtime do host elegível.

## 5. Bloqueios antes de aplicar alterações externas

- A decisão atual é uso não comercial; reavaliar a elegibilidade da hospedagem antes de eventual comercialização futura.
- Confirmar URL/branch de Preview que substituirá a branch de teste arquivada.
- Validar callbacks, logout URLs, Web Origins e configuração da API no Auth0 Dashboard.
- Verificar valores e destinos das connection strings sem exibi-los, além dos grants reais no Neon.
- A integração GitHub disponível não comprovou controles server-side de branch no repositório privado Free.

## 6. Registro de mudança

Esta revisão não altera credenciais, variáveis, roles, grants, migrations, deployments ou serviços externos. O arquivo é uma especificação auditável para orientar correções por etapas. Cada correção operacional deverá registrar ambiente, SHA, evidência antes/depois e rollback.
