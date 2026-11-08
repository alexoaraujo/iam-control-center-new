# Ciclo de vida seguro de branch PR no Neon

## Objetivo

Garantir que cada pull request do próprio repositório receba uma branch temporária isolada no Neon, mantendo a linha permanente de `main (default) -> development` intacta e sem criar migrations, endpoints de computação ou credenciais adicionais.

## Escopo e limites

Este documento cobre o workflow `.github/workflows/neon-pr-branch-lifecycle.yml` e a intenção operacional dele. Ele não substitui uma auditoria de produção, nem prova que a infraestrutura remota está 100% isolada em todos os níveis.

O workflow:
- reage somente a `pull_request_target` para PRs do mesmo repositório;
- ignora forks e eventos fora do repositório canônico;
- não faz `checkout`, não baixa artefatos e não executa código do PR;
- cria ou reutiliza `preview/pr-<número>` como branch filha de `development`;
- define expiração de 14 dias e verifica nome, parent e TTL;
- falha fechado em caso de dados inválidos, projeto incorreto, parent inesperado ou limite da conta;
- não exclui automaticamente ao fechar o PR, por ausência de prova de autoria da branch.

## Premissas

Antes do uso em produção, o repositório deve possuir:
- `NEON_API_KEY` configurado como GitHub Actions secret;
- `NEON_PROJECT_ID` configurado como repository variable com valor canônico;
- `main` (default) e `development` como branches permanentes esperadas no projeto Neon;
- projeto Neon de entrega IAM identificado como `twilight-fire-88497009`.

## Como o workflow funciona

### 1. Validação inicial

O primeiro passo valida:
- número do PR em formato numérico positivo;
- `NEON_PROJECT_ID` igual ao projeto canônico;
- presença de `NEON_API_KEY`;
- ação permitida: `opened`, `reopened`, `synchronize` ou `closed`.

Todas as validações são feitas sem expor segredos em logs.

### 2. Verificação da linha permanente

A API do Neon é consultada para listar as branches do projeto. Em seguida, o workflow confirma:
- existe exatamente uma branch `default == true`;
- seu `current_state` é `ready`;
- existe exatamente uma branch `development` com `parent_id` igual ao `id` da branch default;
- a branch de desenvolvimento também está pronta.

Se qualquer um desses passos falhar, o job termina sem alterar a infraestrutura de PR.

### 3. Nome da branch temporária

A branch gerenciada é:
- `preview/pr-<PR_NUMBER>`

Esse nome é determinístico para o PR em questão e ajuda a evitar conflitos com branches permanentes do ambiente.

### 4. Criação ou reutilização

Se a branch ainda não existe:
- verifica se o limite gratuito de 10 branches foi atingido;
- cria a branch como filha de `development`;
- define `expires_at` para 14 dias no futuro;
- anexa metadados de propriedade para rastrear que a branch foi criada por este workflow.

Se a branch já existe:
- exige que haja exatamente uma correspondência pelo nome;
- exige que `parent_id` seja o mesmo da branch `development`;
- exige que a API devolva os metadados de propriedade esperados para o PR atual;
- recusa qualquer branch que não tenha origem verificada, evitando reutilização perigosa.

### 5. Espera de prontidão

Antes de aplicar a expiração, o workflow aguarda a branch ficar em estado `ready`.

A espera é limitada e falha fechado se a branch não estabilizar dentro do timeout de 6 minutos.

### 6. Expiração e verificação final

A branch recebe `expires_at` com 14 dias e o workflow reconsulta o objeto completo para verificar:
- `name` correto;
- `parent_id` igual ao da branch `development`;
- `expires_at` dentro de uma janela aceitável do valor solicitado.

Se qualquer verificação falhar, o workflow conclui com erro e não tenta corrigir a branch por suposição.

## Política de fechamento do PR

Quando a ação é `closed`, o workflow não remove a branch automaticamente.

Isso foi intencionalmente desabilitado porque:
- o nome e o parent não provam autoria da branch;
- uma branch manualmente criada poderia coincidir com o padrão;
- a API do Neon não expõe um histórico de autoria suficientemente confiável para uma exclusão segura;
- a política de segurança do repositório prioriza falhar fechado e preservar infra existente.

Nesse caso, a branch mantém a expiração previamente validada e o sistema continua operacional, sem remover dados que não puderam ser atribuídos com segurança.

## Riscos e limitações

Este workflow reduz muito o risco operacional, mas ainda possui limitações explícitas:
- depende da validade e disponibilidade da API Neon;
- depende da presença correta de variáveis e segredos do GitHub Actions;
- não cria ou valida endpoint de computação, conexão de banco, migration ou variáveis do runtime;
- não prova isolamento funcional de dados em nível de aplicação;
- não substitui revisão de segurança e testes de integração para branch de preview.

## Segurança operacional

Os princípios de proteção deste workflow são:
- `permissions: {}` para minimizar privilégios;
- `pull_request_target` apenas para PRs do mesmo repositório;
- ausência de `checkout` ou execução de código de PR;
- validação explícita de `NEON_PROJECT_ID` e `main/development`;
- `cancel-in-progress: false` para evitar串行/eliminação de execuções em fila de sincronização;
- falha fechada em caso de inconsistência.

## Checklist de ativação

Antes de ativar o workflow em produção, confirmar:
- [ ] `NEON_API_KEY` presente e acessível no contexto do workflow;
- [ ] `NEON_PROJECT_ID` configurado com o ID canônico correto;
- [ ] `main` e `development` existem e estão `ready`;
- [ ] a branch `preview/pr-*` não conflita com ambientes já existentes;
- [ ] todas as equipe/owners entenderam que a branch não será removida automaticamente no fechamento do PR;
- [ ] os limites do plano gratuito e a política de expiração foram revisados com a operação.

## Observação final

Este workflow foi desenhado como um guardrail de segurança e integridade operacional, não como um mecanismo de execução de código ou de provisionamento de runtime. Seu objetivo é garantir que branches de PR tenham uma existência temporária, previsível e rastreável sem comprometer as branches permanentes do projeto.

## Projeto e topologia vigentes — 08/11/2026

O alvo vigente deste workflow é o projeto Neon `iam-database-delivery` (`twilight-fire-88497009`). A API Neon confirmou a branch `main` (`br-little-fire-b6adup9f`) como única default/primary READY e a branch `development` (`br-proud-brook-b6woqo6z`) como READY e filha direta de `main`. O workflow deve interpretar a branch default como `main`, não como Production.

A branch `preview` (`br-lingering-art-b6lzio6z`) também existe como filha direta de `main`, mas o lifecycle cria branches `preview/pr-<número>` como filhas de `development`.

**Limite operacional (inventário read-only de 2026-11-08):** o projeto lista 5 branches e o plano Free informa limite de 10. Há capacidade nominal disponível neste inventário; o workflow deve reavaliar a contagem ao executar e falhar fechado se o limite estiver atingido. Não excluir branches existentes automaticamente.

O endpoint da branch `main` é `ep-twilight-shadow-b618ef5h`; a API informa `pooler_enabled=false`. Isso não altera o lifecycle, mas impede declarar pooler ativo ou utilizar o hostname `-pooler` como se estivesse habilitado.
