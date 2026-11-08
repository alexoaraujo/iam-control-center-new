# Reconciliação de identidade dos projetos Neon — IAM Control Center

**Data/hora da verificação:** 03/11/2026, 16:57 BRT  
**Branch de código consultada:** `chore/dependencies-refresh-reconciled`  
**HEAD da branch consultada:** `a43c9d1c80c5ef00294566cfd0dd5d4abb8c7f82`  
**Escopo:** inventário read-only; nenhum secret foi descriptografado; nenhuma alteração foi feita em Neon, Vercel ou Auth0.

## 1. Resultado executivo

Foram encontrados dois projetos Neon ativos associados ao trabalho IAM:

- `floral-surf-85783683`, nome `iam-control-center`, região `aws-sa-east-1`.
- `wandering-wildflower-90908845`, nome `control-center`, região `aws-us-east-2`.

Há uma divergência de identidade do projeto:
- A variável não secreta `NEON_PROJECT_ID` do Vercel está configurada como `floral-surf-85783683` em Development e Preview. Não há essa variável em Production.
- O documento `docs/operations/auth0-neon-integration-readiness.md` declara `wandering-wildflower-90908845` como Neon canônico.
- A revisão SQL e o bootstrap de roles documentados e consultados nesta execução ocorreram em Development de `wandering-wildflower-90908845`.

**Decisão operacional:** a identidade do projeto efetivamente utilizado pela aplicação permanece **BLOCKED / RECONCILIATION REQUIRED**. Não alterar `NEON_PROJECT_ID`, `DATABASE_URL` ou `DATABASE_MIGRATION_URL` até confirmar explicitamente qual projeto deve ser canônico e alinhar os endpoints por ambiente. Não executar migration enquanto essa correspondência não estiver resolvida.

## 2. Projeto A — `floral-surf-85783683`

| Campo | Evidência observada |
|---|---|
| Nome | `iam-control-center` |
| Região | `aws-sa-east-1` |
| PostgreSQL | 18 |
| Criação | 24/10/2026 |
| Production | `br-super-flower-b6k7w8wp`, READY, primary/default |
| Development | `br-bitter-rain-b6j4sexv`, READY |
| Preview | `br-holy-rain-b6i380c9`, READY |
| Proteção de branches | As três aparecem como `protected=false` |
| Database | `iam_control_center`, owner `iam_owner` nas três branches |

### 2.1 Roles observadas pela API administrativa

Development e Preview listam, entre outras, as roles `iam_owner`, `iam_migrator`, `iam_migrator_login`, `iam_app_runtime` e `iam_app_runtime_login`. Também aparece uma segunda família de roles `app_runtime` / `app_runtime_login`; a última aparece com método de autenticação `password` na API administrativa.

A API de roles expõe `authentication_method`, que **não substitui** a leitura dos atributos catalogais PostgreSQL (`rolcanlogin`, `rolinherit`, `rolbypassrls`, etc.). Não inferir `NOLOGIN` apenas a partir de `authentication_method=no_login`.

A consulta SQL read-only ao projeto A não foi concluída: a conexão administrativa retornou `missing authentication credentials: required password`. Portanto, não há nesta auditoria evidência SQL de memberships, ACLs, schema ou flags RLS do projeto A.

## 3. Projeto B — `wandering-wildflower-90908845`

| Campo | Evidência observada |
|---|---|
| Nome | `control-center` |
| Região | `aws-us-east-2` |
| PostgreSQL | 18 |
| Criação | 02/11/2026 |
| Production | `br-dry-mouse-b4gyjp04`, READY, primary/default |
| Development | `br-nameless-wave-b49yqod7`, READY |
| Preview | `br-broad-base-b4gnjmg5`, READY |
| Recovery | `br-fancy-wind-b4ura0x5`, READY |
| Proteção de branches | As quatro aparecem como `protected=false` |
| Database Development | `Iam-control-center`, owner `Iam-control-center_owner` |

### 3.1 Atributos catalogais PostgreSQL observados em Development

Consulta read-only em `pg_roles`, executada em 03/11/2026:

| Role | LOGIN | INHERIT | SUPERUSER | CREATEDB | CREATEROLE | REPLICATION | BYPASSRLS |
|---|---:|---:|---:|---:|---:|---:|---:|
| `iam_owner` | Não | Não | Não | Não | Não | Não | Não |
| `iam_migrator` | Não | Não | Não | Não | Não | Não | Não |
| `iam_app_runtime` | Não | Sim | Não | Não | Não | Não | Não |
| `iam_migrator_login` | Sim | Não | Não | Não | Não | Não | Não |
| `iam_app_runtime_login` | Sim | Sim | Não | Não | Não | Não | Não |

A role administrativa `Iam-control-center_owner` é LOGIN, não é SUPERUSER, mas possui CREATEDB, CREATEROLE, REPLICATION e BYPASSRLS. Ela é owner do database e não pode ser usada como runtime nem como sessão migrator.

### 3.2 Memberships observadas

| Membro | Role concedida | INHERIT | SET | ADMIN |
|---|---|---:|---:|---:|
| `iam_migrator_login` | `iam_migrator` | false | true | false |
| `iam_migrator` | `iam_owner` | false | true | false |
| `iam_app_runtime_login` | `iam_app_runtime` | true | false | false |

Também existem memberships provider-managed em que `Iam-control-center_owner` é membro de roles IAM, com ADMIN OPTION. Essas associações são do proprietário administrativo do Neon; não são memberships concedidas aos principals IAM e não devem ser revogadas como correção do teste.

### 3.3 ACLs e estado do schema observados

| Verificação | Resultado |
|---|---|
| Owner do database | `Iam-control-center_owner` |
| `iam_owner` tem CREATE no database | Sim |
| `iam_migrator_login` tem CONNECT | Sim |
| `iam_app_runtime_login` tem CONNECT | Sim |
| Logins têm CREATE no database | Não |
| Runtime login tem TEMP | Não |
| PUBLIC tem CONNECT | Não |
| Schema `iam` existe | Não |
| Schema `audit` existe | Não |
| Relações em `iam`, `audit`, `app_private` | 0 |

A consulta confirma o estado limpo necessário para a proposta 0001 neste database, mas não autoriza sua execução.

### 3.4 Autenticação real dos logins

Tentativas read-only de conexão via Neon como `iam_migrator_login` e `iam_app_runtime_login` retornaram:

`missing authentication credentials: required password`

Portanto:
- Atributos e memberships das roles estão confirmados por catálogo.
- Autenticação real desses principals permanece **BLOCKED**.
- Não há prova de query runtime com a role dedicada.
- Não usar a role administrativa para simular runtime ou migrator.

## 4. Compatibilidade da migration 0001

A migration `database/migrations/0001_initial_iam_schema.sql` exige:
- `session_user = iam_migrator_login`;
- `current_user = iam_owner`;
- cadeia de `SET ROLE` permitida por `iam_migrator_login → iam_migrator → iam_owner`;
- atributos não privilegiados e memberships exatas.

O runner de teste descartável `database/tests/run.sh` prepara a sessão autenticada executando `SET ROLE iam_migrator;` e depois `SET ROLE iam_owner;` antes de enviar o SQL da migration. Assim, a ausência de `SET ROLE` dentro do próprio arquivo 0001 não é, isoladamente, um defeito: o futuro executor deverá reproduzir explicitamente essa cadeia e preservar `session_user`.

No Neon Development do Projeto B, a topologia de memberships e os atributos das roles são compatíveis com esse preflight. **A execução continua bloqueada** porque os logins não autenticam pelo conector e ainda não existe executor operacional aprovado para `DATABASE_MIGRATION_URL`.

A migration mantém RLS enabled/forced sem policies e sem grants de runtime: default-deny intencional. O harness PostgreSQL 18 descartável não comprova RLS ou credenciais no Neon.

## 5. Estado do código e das PRs

- PR #57: merged em 03/11/2026 às 13:17 UTC.
- PR #69: merged em 03/11/2026 às 13:42 UTC.
- PR #48: permanece Draft; HEAD consultado `a43c9d1c80c5ef00294566cfd0dd5d4abb8c7f82`.
- PR #81: permanece Draft; não faz parte desta mudança de inventário.
- `apps/web/src/lib/db.ts` instancia `neon(DATABASE_URL)`, mas não executa query. Os testes do módulo usam mock. A presença do cliente não comprova conexão PostgreSQL.

## 6. Próximas ações e gates

| Ordem | Ação | Estado |
|---|---|---|
| 1 | Confirmar se o projeto canônico é `floral-surf-85783683` ou `wandering-wildflower-90908845` | BLOCKED — conflito entre Vercel e documentação/operação |
| 2 | Alinhar `NEON_PROJECT_ID` e endpoints por Development/Preview ao projeto escolhido | Aguardando 1; não alterar automaticamente |
| 3 | Provisionar credenciais dedicadas em Development por processo aprovado | BLOCKED |
| 4 | Provar conexão `SELECT 1` com `iam_app_runtime_login` | BLOCKED |
| 5 | Provar conexão migrator e cadeia `SET ROLE` sem owner/admin como sessão | BLOCKED |
| 6 | Executar harness RLS com role runtime real e cenários cross-tenant | Pendente |
| 7 | Revisar checksum, runner, rollback e proposta 0001 | Pendente |
| 8 | Aprovar execução em Development separadamente | Não autorizada |
| 9 | Preview e Production | Não autorizadas; Production intocada |

## 7. Não execução

Nesta verificação:
- nenhum secret ou connection string foi descriptografado, impresso ou alterado;
- nenhuma variável Vercel foi alterada;
- nenhuma role, membership, grant, schema, policy ou branch Neon foi alterada;
- nenhuma migration ou SQL de escrita foi executado;
- nenhum deploy foi disparado;
- Production permaneceu intocada.

**Conclusão:** o Projeto B tem evidência SQL read-only útil da topologia IAM e do estado limpo em Development, mas não tem autenticação dos logins comprovada. O Projeto A é o projeto indicado atualmente pela variável Vercel `NEON_PROJECT_ID` em Development e Preview, porém não tem nesta auditoria evidência SQL equivalente. A seleção do projeto canônico precisa ser resolvida antes de conectar aplicação, credenciais e migration.


## 8. Decisão do projeto canônico — 03/11/2026

O usuário confirmou **wandering-wildflower-90908845** como projeto Neon canônico do IAM Control Center. Esta decisão substitui o estado “aguardando escolha” da seção 6 e o resumo executivo da seção 1.

### 8.1 Estado da configuração após a decisão

- Projeto canônico escolhido: **wandering-wildflower-90908845** (control-center), região `aws-us-east-2`, PostgreSQL 18.
- Vercel `NEON_PROJECT_ID` continua com valor `floral-surf-85783683` em Development e Preview, conforme consulta sem descriptografar secrets.
- Portanto, a decisão de arquitetura está **CONFIRMADA**, mas o roteamento da aplicação permanece **BLOCKED / DIVERGENTE** até alinhar as variáveis e os endpoints `DATABASE_URL` / `DATABASE_MIGRATION_URL` por ambiente.
- Não há `NEON_PROJECT_ID` configurado em Production; Production não deve ser alterada nesta etapa.

### 8.2 Verificação adicional de Development e Preview

Consultas SQL somente leitura executadas em 03/11/2026, usando a conexão administrativa fornecida pelo Neon (sem revelar credenciais):

| Verificação | Development `br-nameless-wave-b49yqod7` | Preview `br-broad-base-b4gnjmg5` |
|---|---|---|
| Database | `Iam-control-center` | `Iam-control-center` |
| Owner | `Iam-control-center_owner` | `Iam-control-center_owner` |
| Roles IAM catalogadas | `iam_owner`, `iam_migrator`, `iam_migrator_login`, `iam_app_runtime`, `iam_app_runtime_login` | Não encontradas |
| LOGIN dedicado migrator/runtime | Sim, `rolcanlogin=true` | Não aplicável; roles ausentes |
| `iam` / `audit` / `app_private` | Ausentes | Ausentes |
| Auth real dos LOGINs dedicados | Não comprovada | Não configurada |

Em Development, os atributos catalogais confirmam `iam_owner` e `iam_migrator` com `LOGIN=false` e `INHERIT=false`; `iam_migrator_login` com `LOGIN=true` e `INHERIT=false`; `iam_app_runtime` com `LOGIN=false` e `INHERIT=true`; e `iam_app_runtime_login` com `LOGIN=true` e `INHERIT=true`. Nenhuma dessas roles tem SUPERUSER, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS.

Memberships em Development: `iam_migrator_login → iam_migrator` (`SET=true`, `INHERIT=false`); `iam_migrator → iam_owner` (`SET=true`, `INHERIT=false`); `iam_app_runtime_login → iam_app_runtime` (`SET=false`, `INHERIT=true`).

A API administrativa Neon listou apenas a role proprietária no Preview. A consulta SQL confirmou que não há as cinco roles IAM nem os schemas IAM nesse branch. Não provisionar automaticamente; o bootstrap Preview deve ser uma etapa separada, revisada e autorizada.

### 8.3 Próximas ações com limites

1. Alinhar `NEON_PROJECT_ID` de Development e Preview para `wandering-wildflower-90908845` e validar a identidade de cada `DATABASE_URL` e `DATABASE_MIGRATION_URL` sem exibir seus valores — **requer aprovação explícita para alterar variáveis/conexões Vercel**.
2. Emitir credenciais dedicadas em Development e comprovar `SELECT 1` como `iam_app_runtime_login` e a cadeia migrator sem usar a role owner como sessão — **BLOCKED**.
3. Preparar bootstrap revisável para Preview após validar a baseline e os privilégios necessários — **não executado**.
4. Executar migration 0001 somente após revisão do runner, checksum, rollback, prova de runtime/RLS e autorização específica — **não autorizado**.
5. Não alterar Production, não habilitar Neon Auth e não trocar Auth0 como IdP.

Nenhuma variável, secret, role, membership, schema, policy ou database foi alterado nesta etapa. Nenhuma migration ou deploy foi executado.

## 9. Execução autorizada: alinhamento Vercel — 03/11/2026

O usuário autorizou alinhar Vercel somente em Development e Preview, mantendo Production intocada. Foi atualizada a variável não secreta `NEON_PROJECT_ID` para `wandering-wildflower-90908845`, preservando os targets `development` e `preview`. A leitura posterior com `decrypt=false` confirmou o novo valor e os dois targets.

### 9.1 Estado das conexões após inspeção de metadados

A inspeção atual de variáveis (sem descriptografar valores) encontrou:

| Variável | Target | Estado / observação |
|---|---|---|
| `NEON_PROJECT_ID` | Development, Preview | Atualizada para `wandering-wildflower-90908845`; confirmação read-back PASS |
| `DATABASE_URL` | Development | Secret existente; comentário indica runtime mínimo em Development, mas endpoint/role real não pode ser confirmado sem testar credencial |
| `DATABASE_URL` | Preview | Secret existente; comentário identifica `iam_app_runtime_dev_safe`; não corresponde ao nome da role runtime dedicado documentado no branch canônico; endpoint/role real não confirmado |
| `DATABASE_URL` | Production | Secret existente; não lido nem alterado; Production intocada |
| `DATABASE_MIGRATION_URL` | Nenhum target retornado na listagem atual | NOT CONFIGURED / não localizada nesta consulta; não criar automaticamente |

### 9.2 Bloqueio para atualização de DATABASE_URL

Em Development do projeto canônico, `iam_app_runtime_login` existe como LOGIN, mas a autenticação real não foi comprovada; as tentativas anteriores retornaram `missing authentication credentials: required password`. Em Preview, a role IAM runtime e a família de roles IAM estão ausentes. Portanto, não é seguro substituir os secrets `DATABASE_URL` com URLs administrativas, nem presumir que os secrets existentes apontam para o projeto/branch canônico.

A autorização de alinhamento foi executada na parte não secreta (`NEON_PROJECT_ID`). A substituição das URLs foi suspensa até provisionar e comprovar credenciais runtime dedicadas em Development e preparar/revisar o bootstrap isolado de Preview. Nenhum secret foi descriptografado, exposto ou alterado. Não foi redefinida senha de role.

### 9.3 Estado de execução

- `NEON_PROJECT_ID` Development/Preview: **PASS — atualizado e confirmado**.
- `DATABASE_URL` Development: **BLOCKED — credencial/endpoint não comprovados**.
- `DATABASE_URL` Preview: **BLOCKED — roles IAM ausentes e secret não alinhado comprovadamente**.
- `DATABASE_MIGRATION_URL`: **NOT CONFIGURED / não localizada na listagem atual**.
- Production: **NOT TOUCHED**.
- Migration, bootstrap Preview, role/password changes e deploy Production: **não executados**.

## 11. Read-back Vercel e Neon — 04/11/2026

Consulta atual de metadados Vercel do projeto `iam-control-center`, com `decrypt=false`, e consulta read-only do projeto Neon canônico:

| Item | Resultado atual | Classificação |
|---|---|---|
| Vercel `NEON_PROJECT_ID` | `wandering-wildflower-90908845` em Development e Preview; ausente em Production | PASS — read-back confirmado |
| Vercel `DATABASE_URL` | Presente em Development, Preview e Production; valores não descriptografados | NOT VERIFIED — projeto, branch e role dos endpoints não comprovados |
| Vercel `DATABASE_MIGRATION_URL` | Não retornada na listagem atual em nenhum ambiente | NOT CONFIGURED — snapshot atual |
| GitHub Actions variable `NEON_PROJECT_ID` | Não acessível pelo conector nesta auditoria | NOT VERIFIED — workflow da PR #56 depende dela |
| Neon `wandering-wildflower-90908845` | PostgreSQL 18, plano Free, 4 branches, limite informado de 10 | PASS — projeto localizado |

### 11.1 Topologia atual do projeto canônico

| Branch | ID | Parent | Estado |
|---|---|---|---|
| production | `br-dry-mouse-b4gyjp04` | default | READY |
| development | `br-nameless-wave-b49yqod7` | production | READY |
| preview | `br-broad-base-b4gnjmg5` | production | READY |
| recovery-development-pre-bootstrap-2026-11-02 | `br-fancy-wind-b4ura0x5` | development | READY |

O workflow da PR #56 exige exatamente uma Production default READY e uma Development filha direta de Production READY. A topologia atual satisfaz esse preflight. O workflow cria `preview/pr-<number>` como filha de Development; não deve reutilizar a branch `preview` existente, que é filha direta de Production.

### 11.2 Limites e pendências

- A decisão de projeto canônico `wandering-wildflower-90908845` está confirmada e o read-back Vercel de Development/Preview já está alinhado.
- A variável do GitHub Actions é distinta da variável Vercel; confirmar manualmente em Settings → Secrets and variables → Actions → Variables que `NEON_PROJECT_ID` tenha o valor canônico antes de ativar o workflow da PR #56.
- Não descriptografar nem substituir `DATABASE_URL` sem validar endpoint, branch e autenticação runtime dedicada.
- `DATABASE_MIGRATION_URL` permanece não configurada neste snapshot; não criar nem usar URL administrativa como substituta.
- Nenhuma migration, alteração de role/grant, credencial, secret ou deployment Production foi executada nesta leitura.

## 12. Decisão operacional vigente — projeto Neon de entrega IAM — 08/11/2026

Esta seção é a decisão vigente e substitui, para a automação de lifecycle de PR e para a entrega do banco IAM, as referências históricas das seções 8–11 que apontavam `wandering-wildflower-90908845`. A decisão foi confirmada pelo usuário em 08/11/2026 e validada por leitura da API Neon no mesmo dia.

| Campo | Valor verificado |
|---|---|
| Projeto | `iam-database-delivery` |
| Project ID | `twilight-fire-88497009` |
| Região | `aws-sa-east-1` |
| PostgreSQL | 18 |
| Plano | `free_v3` |
| Branch default | `main` (`br-little-fire-b6adup9f`), READY |
| Branch Development | `development` (`br-proud-brook-b6woqo6z`), READY, filha direta de main |
| Branch Preview | `preview` (`br-lingering-art-b6lzio6z`), READY, filha direta de main |
| Endpoint de main | `ep-twilight-shadow-b618ef5h`, read-write, atualmente idle/suspenso |
| Database | `iam_database` |
| Database owner | `iam_database_owner` |
| Login de migration | `iam_migrator_login` consta na API de roles da branch main |
| TLS | `sslmode=require` conforme contrato de conexão informado pelo usuário |

A API Neon também confirmou `pooler_enabled=false` para o endpoint `ep-twilight-shadow-b618ef5h`. Não usar hostname `-pooler` nem declarar PgBouncer ativo; qualquer ativação de pooler exige decisão e teste próprios.

A branch main contém ainda as roles `iam_owner`, `iam_migrator`, `iam_app_runtime`, `iam_app_runtime_login`, `iam_worker` e `iam_worker_login`. A API administrativa identifica `iam_migrator_login` como password-authenticated, mas isso não substitui inspeção SQL de `pg_roles` nem prova uma conexão real. A existência da role não autoriza executar migration.

### Consequências operacionais

1. Para o workflow `.github/workflows/neon-pr-branch-lifecycle.yml`, `twilight-fire-88497009` é o project ID autorizado. O workflow deve validar a branch `main` default e `development` como filha direta de main; não deve chamar main de Production.
2. O projeto `wandering-wildflower-90908845` continua existindo e contém evidências históricas de outra topologia. Ele não é o alvo desta automação de entrega do banco e não deve ser usado como fallback.
3. O inventário atual da API lista 10 branches no projeto de destino, atingindo o limite Free informado de 10. O workflow deve falhar fechado ao tentar criar uma nova branch de PR enquanto o limite estiver cheio. Não excluir branches existentes automaticamente nem reduzir evidências para liberar espaço.
4. A contagem de 23 tabelas do snapshot `schema-export-validation-20261105` é um artefato histórico de uma branch isolada do projeto de destino. Ela não prova equivalência com o estado atual de `main`.
5. Nenhuma migration, DDL, grant, alteração de dados, senha/secret ou branch persistente foi alterada nesta reconciliação.
