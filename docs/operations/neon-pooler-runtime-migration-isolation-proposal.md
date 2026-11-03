# Proposta — isolamento de runtime, pooling e migrations

**Status:** PROPOSTA / NÃO EXECUTADA  
**Projeto:** IAM Control Center  
**Repositório:** `alexoaraujo83/iam-control-center`  
**Data da inspeção:** 2026-11-02  
**Escopo:** Development e Preview primeiro. Production permanece fora de qualquer alteração até aprovação explícita.

## 1. Decisão arquitetural

Manter Auth0 como provedor de identidade. Neon Auth permanece desabilitado.

| Consumidor | Variável / conexão | Endpoint | Escopo e finalidade |
|---|---|---|---|
| Aplicação web (Next.js/Vercel) | `DATABASE_URL` | Neon pooled, hostname `-pooler` | Somente operações de runtime com role dedicada de privilégio mínimo |
| Executor protegido de migrations | `DATABASE_MIGRATION_URL` | Neon direto, hostname sem `-pooler` | DDL/migrations controladas; nunca exposta ao runtime web |
| CI de qualidade/testes | `DATABASE_URL` de serviço PostgreSQL descartável | PostgreSQL local/container do runner | Testes de integração isolados; não conecta ao Neon |

A URL direta de migrations não deve ser cadastrada como variável de ambiente do projeto Vercel. O segredo deve existir somente no escopo do job executor protegido (por exemplo, GitHub Actions Environment/secret dedicado), injetado exclusivamente no job que executa migrations. Não deve estar disponível em jobs de build, Preview, runtime web ou testes comuns.

## 2. Regras de segurança

1. A aplicação web recebe somente `DATABASE_URL`; não deve ler, validar, logar, propagar ou receber `DATABASE_MIGRATION_URL`.
2. O executor de migrations usa `DATABASE_MIGRATION_URL` diretamente, sem PgBouncer/pooler, e com identidade migrator separada da role runtime.
3. O workflow de migrations não é acionado por `pull_request`, não executa código arbitrário de PR com credenciais e exige disparo manual/guardas explícitas.
4. O executor valida projeto, branch, database e hostname esperados antes de qualquer operação. Production fica bloqueada por padrão.
5. CI usa PostgreSQL efêmero descartável e não recebe secrets Neon nem credenciais de migrations.
6. Nenhuma migration é executada automaticamente por build, inicialização da aplicação, Preview ou deploy Vercel.
7. Pooling em modo transacional exige verificar compatibilidade do driver/ORM e eliminar dependências de estado de sessão entre transações. Não presumir que operações como `SET` de sessão, advisory locks ou prepared statements persistentes funcionem sem validação específica.
8. Segredos não devem ser impressos em logs, artefatos, outputs, command-line arguments ou arquivos versionados.

## 3. Estado observado em 2026-11-02

### Neon — projeto canônico

Projeto: `wandering-wildflower-90908845`, região `aws-us-east-2`.

| Ambiente | Branch ID | Endpoint ID | Pooler observado |
|---|---|---|---|
| Development | `br-nameless-wave-b49yqod7` | `ep-shiny-glade-b4awlrlg` | Desabilitado |
| Preview | `br-broad-base-b4gnjmg5` | `ep-soft-night-b4xgjlht` | Desabilitado |
| Production | `br-dry-mouse-b4gyjp04` | `ep-dawn-river-b4xl1228` | Desabilitado |

A API de roles listou somente `Iam-control-center_owner` nas três branches. Isso não prova ausência de outras roles no catálogo SQL; roles `iam_app_runtime` e `iam_migrator` continuam **NOT VERIFIED**. A API de databases listou `Iam-control-center` nas três branches.

### Vercel — metadados de variáveis (sem descriptografar)

Projeto: `iam-control-center`.

| Chave | Alvo atual | Tipo | Observação |
|---|---|---|---|
| `DATABASE_URL` | Development | Secret | Comentário identifica conexão runtime para Development |
| `DATABASE_URL` | Preview | Secret | Comentário identifica conexão de Preview |
| `DATABASE_URL` | Production | Secret | Não inspecionar valor nem alterar nesta proposta |
| `DATABASE_MIGRATION_URL` | Development | Secret | Cadastrada no projeto Vercel |
| `DATABASE_MIGRATION_URL` | Preview | Secret | Cadastrada no projeto Vercel |

Os valores não foram descriptografados. A presença de `DATABASE_MIGRATION_URL` nos alvos Development e Preview do projeto Vercel viola o isolamento desejado, mesmo sem evidência de que o código atual a consuma. A remoção dessas variáveis é uma mudança externa e não foi executada.

O pooler dos três endpoints Neon está desabilitado; portanto, não se pode afirmar que as `DATABASE_URL` cadastradas usem efetivamente o hostname `-pooler`.

## 4. Implementação proposta — etapas revisáveis

### Etapa A — inventário e consumidores

- Buscar todas as referências a `DATABASE_URL` e `DATABASE_MIGRATION_URL` no código, scripts, workflows, configurações Vercel e documentação.
- Confirmar ORM/driver, suporte a PgBouncer em modo transacional e requisitos de conexão direta.
- Confirmar que nenhum código de runtime importa ou acessa `DATABASE_MIGRATION_URL`.
- Documentar cada consumidor e seu ambiente.

**Aceite:** inventário completo por caminho de arquivo e SHA; nenhum segredo lido ou exibido.

### Etapa B — role separation

- Projetar role runtime sem privilégios DDL, sem ownership e sem BYPASSRLS.
- Projetar role migrator separada, sem uso pela aplicação.
- Definir grants mínimos, ownership, schemas e política de RLS.
- Preparar SQL revisável e testes em branch temporária/snapshot antes de qualquer aplicação.

**Aceite:** matriz de privilégios demonstrada com consultas de catálogo e testes positivos/negativos. Não criar roles nesta proposta.

### Etapa C — conexões

- Configurar pooling em Development e Preview somente após confirmar roles runtime e compatibilidade do cliente.
- Manter URL de migrations direta e fora do Vercel.
- Definir segredo exclusivo para o job protegido de migrations.
- Não alterar Production nesta etapa.

**Aceite:** metadados de endpoint comprovam pooler ativo para runtime; hostname direto comprovado para migrator sem revelar credenciais; ausência de migration URL nos ambientes Vercel.

### Etapa D — CI e executor protegido

- CI executa testes de integração com PostgreSQL efêmero, sem secrets Neon.
- Workflow de migrations é separado, manual, com permissões mínimas, guardas de branch/database/hostname e sem gatilho de PR.
- O job executor é o único consumidor de `DATABASE_MIGRATION_URL`.
- Não executar migrations em builds/deploys automáticos.

**Aceite:** logs mascarados mostram apenas metadados não sensíveis do alvo; testes demonstram que o job web/CI não recebe a variável de migration.

### Etapa E — validação Preview

- Associar o hostname usado pelo E2E ao deployment Preview do SHA testado, sem reutilizar domínio vinculado a outra branch.
- Fazer o workflow esperar o deployment daquele SHA e testar a URL imutável/correta.
- Executar Auth0 E2E somente depois da configuração explícita da variável de habilitação e de usuário de teste dedicado.

**Aceite:** login, callback, sessão persistente e logout comprovados no deployment do SHA exato. Isso não comprova RBAC, tenant isolation ou RLS.

## 5. Itens explicitamente não executados

- Nenhuma variável Vercel foi criada, removida ou atualizada.
- Nenhum valor de secret foi descriptografado.
- Nenhum endpoint Neon teve pooler habilitado/desabilitado nesta proposta.
- Nenhuma role PostgreSQL foi criada ou modificada.
- Nenhuma consulta SQL de escrita ou migration foi executada.
- Nenhuma configuração Auth0, GitHub Actions secret ou Vercel Trusted Source foi alterada.
- Nenhum deployment Production foi promovido.

## 6. Critérios para declarar PASS

Não declarar PASS com base apenas em nomes/comentários de variáveis ou status CI.

- **POOLER-RUNTIME:** endpoint Neon da branch usada pelo web mostra pooler ativo e o hostname efetivo de runtime é pooled.
- **MIGRATION-ISOLATION:** `DATABASE_MIGRATION_URL` não existe nos ambientes Vercel; está disponível somente no job protegido.
- **ROLE-SEPARATION:** role runtime e migrator existem e privilégios efetivos foram verificados.
- **CI-ISOLATION:** testes usam PostgreSQL descartável e não recebem secrets Neon.
- **MIGRATION-EXECUTOR:** workflow manual valida o alvo e executa migration somente após aprovação específica.
- **AUTH0-E2E:** execução real bem-sucedida no Preview correspondente ao SHA exato.

Cada evidência deve registrar SHA, run/deployment ID, ambiente, branch/database/hostname não sensíveis e resultado. Itens não executados permanecem **PENDING**, **BLOCKED** ou **NOT VERIFIED**, nunca PASS.

## 7. Próxima ação

Concluir a Etapa A com inventário de consumidores e inspeção de configuração do driver/ORM. Em seguida, apresentar um diff de código/workflow e uma proposta de SQL revisável. Não aplicar alterações de Vercel, Neon ou Auth0 sem autorização específica.


## Atualização de estado canônico — 03/11/2026

A revisão da PR #58 confirmou que o pooler permanece desabilitado (`pooler_enabled=false`) em Production, Development e Preview. Portanto, não usar hostname `-pooler` em `DATABASE_URL` até que o provider habilite o pooler e o driver seja testado separadamente. O uso de `@neondatabase/serverless` no scaffold não comprova compatibilidade com PgBouncer nem conectividade real.

O bootstrap IAM foi executado somente em Development. As roles `iam_app_runtime` e `iam_app_runtime_login` existem nesse branch, mas não foi provisionada senha para `iam_app_runtime_login`; autenticação real permanece BLOCKED. Preview e Production não receberam bootstrap IAM. A migration 0001 não foi executada.

A variável `DATABASE_MIGRATION_URL` aparece cadastrada no Vercel em Development e Preview, sem que seus valores tenham sido descriptografados. Isso contraria a arquitetura-alvo de manter a credencial de migration exclusivamente no executor protegido. Nenhuma remoção ou alteração foi feita; uma mudança futura exige inventário de consumidores, autorização e rollback próprio.

O módulo `getSql()` permanece apenas factory server-only. Não executa query, não prova sessão, TLS, role, grants ou RLS. O endpoint health continua sendo configuração-only.

**Decisão:** scaffold implementado; integração Neon real, pooling, migration executor e RLS permanecem BLOCKED/PENDING. Não alterar Vercel, Neon, Auth0 ou Production nesta proposta.
