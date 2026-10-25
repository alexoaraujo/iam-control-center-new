# Catálogo permanente de fontes — IAM Control Center

**Versão:** 1.0  
**Última revisão das páginas e evidências:** 2026-10-24 (America/Sao_Paulo).  
**Responsável pelo uso:** manutenção do projeto IAM Control Center.  
**Escopo:** fontes primárias, documentação técnica complementar, artefatos do repositório, evidência de CI e critérios de aceitação para identidade, autorização, PostgreSQL, Neon e GitHub Actions.

Este catálogo complementa o [índice operacional por etapa](README.md). As páginas oficiais são fontes para requisitos e procedimentos; os PRs e runs listados são evidências pontuais do projeto. Nenhum catálogo documental substitui teste, revisão ou aprovação de mudança.

## Como interpretar os registros

- **Fonte normativa:** documentação do mantenedor/produto, especificação técnica ou documentação oficial.
- **Evidência do projeto:** arquivo, PR, commit, workflow run ou estado observado por integração autenticada.
- **Critério de validação:** teste observável que deve existir antes de considerar o item concluído.
- **Estado da informação:** valores de plano, versão, quota, API e estado do repositório são dinâmicos; verificar novamente antes de usar em uma decisão de merge, migration ou release.

---

## A. Neon: integração GitHub e ciclo de vida de branches

### A1. The Neon GitHub integration

- **Fonte:** [https://neon.com/docs/guides/neon-github-integration](https://neon.com/docs/guides/neon-github-integration)
- **Tipo:** documentação oficial Neon.
- **Usar para:** instalar/conectar o GitHub App, compreender NEON_API_KEY e NEON_PROJECT_ID, adaptar o workflow de criação/exclusão de branches para PRs e consultar actions de schema diff/reset.
- **Regras relevantes:** o workflow exemplificativo é um ponto de partida, não uma garantia de segurança de produção. Os dados de conexão retornados pela action não devem ser impressos em logs. As variáveis/secrets são removidas quando a integração é desconectada, podendo deixar workflows sem credenciais.
- **Evidência relacionada:** [PR #10](https://github.com/alexoaraujo83/iam-control-center/pull/10); [workflow executado #40148092168](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40148092168).
- **Critérios de validação:** confirmar o evento do PR, nome determinístico da branch, origem/tipo da branch, outputs secretos, permissões do workflow, expiração, exclusão e comportamento de retry/cleanup. Confirmar que o workflow não executa migrations ou SQL em production.
- **Limite:** o sucesso do workflow não comprova, isoladamente, que todos os cenários adversariais, concorrentes ou de falha foram exercitados.

### A2. Neon API Reference

- **Fonte:** [https://neon.com/docs/reference/api](https://neon.com/docs/reference/api)
- **Tipo:** especificação oficial da API REST Neon.
- **Usar para:** validar nomes de endpoints, parâmetros, schema de request/response, erros e operações suportadas antes de implementar chamadas próprias.
- **Evidência relacionada:** [PR #10](https://github.com/alexoaraujo83/iam-control-center/pull/10); workflow em [.github/workflows/neon-branch.yml](https://github.com/alexoaraujo83/iam-control-center/blob/chore/neon-pr-branching/.github/workflows/neon-branch.yml).
- **Critérios de validação:** chamadas autenticadas; tratamento de 401/403/404/429 e falhas transitórias; nunca registrar bearer tokens ou connection strings; validar IDs e resposta antes de alterar recursos.
- **Limite:** a API evolui. A referência de endpoint e o schema atuais devem ser reconsultados na implementação.

### A3. Branching with the Neon API

- **Fonte:** [https://neon.com/docs/guides/branching-neon-api](https://neon.com/docs/guides/branching-neon-api)
- **Tipo:** guia oficial Neon.
- **Usar para:** criar/listar/excluir/restaurar branches e compreender origem, branch ID, endpoint/compute e expiração.
- **Evidência relacionada:** [PR #10](https://github.com/alexoaraujo83/iam-control-center/pull/10); branch observada via API Neon: preview/pr-10.
- **Critérios de validação:** testar criação e consulta, verificar estado ready antes de usar, confirmar a origem e a expiração, eliminar apenas a branch temporária pretendida e verificar sua ausência após cleanup.
- **Limite:** a documentação alerta que a criação de branches schema-only via API tem status beta/sujeito a mudança. Não inferir equivalência exata entre um parâmetro da API e uma opção de action sem conferir a versão da action e seus logs.

### A4. Database branching workflow primer

- **Fonte:** [https://neon.com/docs/get-started/workflow-primer](https://neon.com/docs/get-started/workflow-primer)
- **Tipo:** documentação oficial Neon.
- **Usar para:** escolher estratégia de branching por ambiente, desenvolvedor e pull request.
- **Evidência relacionada:** [PR #10](https://github.com/alexoaraujo83/iam-control-center/pull/10).
- **Critérios de validação:** documentar o propósito de cada branch; isolar trabalho de PR; evitar escrita não aprovada na branch production; definir ciclo de vida e limpeza para branches efêmeras.
- **Limite:** o tutorial descreve padrões; não comprova configuração do projeto nem capacidade disponível no plano atual.

### A5. Schema-only branches

- **Fonte:** [https://neon.com/docs/guides/branching-schema-only](https://neon.com/docs/guides/branching-schema-only)
- **Tipo:** documentação oficial Neon.
- **Usar para:** avaliar branch que copia schema sem copiar registros, especialmente em testes em que dados reais não devem aparecer.
- **Evidência relacionada:** [PR #10](https://github.com/alexoaraujo83/iam-control-center/pull/10); estado da branch preview/pr-10 retornou init_source parent-schema.
- **Critérios de validação:** confirmar o tipo da branch no Neon; provar que dados de produção não estão disponíveis nela; testar a criação com o workflow atual e documentar o significado dos campos retornados.
- **Limite:** não considerar a palavra schema-only no workflow como prova suficiente de isolamento; consultar o estado real e testar o resultado.

### A6. Neon plans and quotas

- **Fonte:** [https://neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans)
- **Tipo:** documentação oficial de planos/limites.
- **Usar para:** verificar quotas incluídas, recursos por plano e limites relevantes a branches.
- **Evidência relacionada:** projeto Neon iam-control-center consultado em 2026-10-24: plano free_v3; registro do projeto retornou branches_limit 10. Branches observadas: production e preview/pr-10.
- **Critérios de validação:** confirmar quota e consumo atuais no console/API antes de criar branches em massa; testar tratamento para limite atingido; aplicar expiração/cleanup; considerar que expiração futura não libera capacidade imediatamente.
- **Divergência pendente:** o texto do PR #10 dizia “até 3 root branches”. A documentação de planos consultada mostra 10 branches no Free e a API do projeto retornou branches_limit 10. Não manter a alegação de 3 root branches sem uma fonte oficial específica que sustente essa regra e esclareça a diferença entre quota geral e branches raiz.
- **Observação:** quotas e recursos de plano são dinâmicos; esta seção não substitui a consulta ao estado atual da conta.

### A7. Neon Manage API Keys

- **Fonte:** [https://neon.com/docs/manage/api-keys](https://neon.com/docs/manage/api-keys)
- **Tipo:** documentação oficial Neon.
- **Usar para:** escolher o tipo de API key, compreender escopos pessoal/organização/projeto, criar, listar e revogar chaves.
- **Evidência relacionada:** PR #10 usa NEON_API_KEY como Actions secret e NEON_PROJECT_ID como Actions variable.
- **Critérios de validação:** escolher menor escopo viável; verificar quem pode administrar a key; manter o segredo apenas no cofre/secret store; comprovar revogação e substituição quando necessário; não revelar o token em documentação nem logs.
- **Limite:** uma key project-scoped não significa permissão restrita a uma única operação. Revisar os privilégios efetivos antes de usar em CI.

### A8. Ações Neon usadas no workflow

| Action | Fonte | Estado no workflow consultado | Critério |
|---|---|---|---|
| Create branch | [neondatabase/create-branch-action](https://github.com/neondatabase/create-branch-action) | Pin no SHA fb620d43d4c565abaf088b848a4e28e5c4ea4d9c em .github/workflows/neon-branch.yml | Confirmar que o SHA vem do repositório upstream correto; rever diff e logs ao atualizar. |
| Delete branch | [neondatabase/delete-branch-action](https://github.com/neondatabase/delete-branch-action) | Usa tag @v3 na versão consultada; pin imutável pendente | Verificar release/commit upstream, testar a exclusão pelo nome/ID correto e fixar SHA completo. |
| Schema diff | [neondatabase/schema-diff-action](https://github.com/neondatabase/schema-diff-action) | Referência complementar; não habilitada no workflow consultado | Se habilitada, limitar permissões de comentário e leitura, tratar output como dados de PR e confirmar diff contra branches corretas. |
| Reset branch | [neondatabase/reset-branch-action](https://github.com/neondatabase/reset-branch-action) | Referência complementar; não habilitada no workflow consultado | Exigir ação deliberada, revisão e branch-alvo inequívoca; nunca resetar production como rotina de PR. |

---

## B. Auth0 e identidade da aplicação

### B1. Authenticate Lakebase Postgres application users with Auth0

- **Fonte:** [https://neon.com/docs/guides/auth-auth0](https://neon.com/docs/guides/auth-auth0)
- **Tipo:** tutorial oficial Neon para Next.js, Auth0, PostgreSQL e Drizzle.
- **Usar para:** compreender o fluxo de login, sessão e persistência de registros associados ao identificador Auth0.
- **Evidência relacionada:** [PR #9](https://github.com/alexoaraujo83/iam-control-center/pull/9) define entidades propostas de identidade/tenancy, mas não implementa o tutorial. O pacote [apps/web/package.json na branch do PR #10](https://github.com/alexoaraujo83/iam-control-center/blob/chore/neon-pr-branching/apps/web/package.json) não lista @auth0/nextjs-auth0.
- **Critérios de validação:** implementar e testar login/callback/logout; mapear identidade externa validada por issuer e subject; garantir que autorização e membership são avaliados no servidor; testar falha do provedor e sessão inválida.
- **Limite de aplicação:** o tutorial demonstra uma aplicação simples e uma tabela por usuário. Não copiar sua modelagem como autorização multi-tenant completa. Não usar email, metadata editável ou dados enviados pelo cliente como concessão de acesso.

### B2. Auth0 Next.js SDK v4 Migration Guide

- **Fonte:** [https://github.com/auth0/nextjs-auth0/blob/main/V4_MIGRATION_GUIDE.md](https://github.com/auth0/nextjs-auth0/blob/main/V4_MIGRATION_GUIDE.md)
- **Tipo:** guia upstream do SDK.
- **Usar para:** validar APIs e convenções da versão principal 4 do SDK; evitar copiar exemplos antigos de rotas, middleware e variáveis.
- **Evidência relacionada:** integração Auth0 E2E ainda não comprovada no ciclo de PRs #9–#10; dependência ausente no package.json da branch do PR #10.
- **Critérios de validação:** fixar uma versão compatível no gerenciador de pacotes; seguir o guia da mesma versão; cobrir login, callback, sessão, logout, renovação/expiração e falhas no CI.
- **Limite:** o guia em branch main pode mudar; registrar a versão do SDK usada no código e validar a documentação compatível com ela.

### B3. Auth0 JWKS

- **Fonte:** [https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-key-sets](https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-key-sets)
- **Tipo:** documentação oficial Auth0.
- **Usar para:** compreender a publicação das chaves públicas para verificar a assinatura de tokens JWT.
- **Evidência relacionada:** requisito proposto no plano de validação OIDC; ainda depende de testes reais na API IAM.
- **Critérios de validação:** assinatura e algoritmo permitido; issuer e audience corretos; expiração e claims temporais; rotação de chaves; comportamento fail-closed quando JWKS está indisponível; rejeição de token malformado/expirado/audience incorreta.
- **Limite:** decodificar um JWT não significa validá-lo. A validação deve usar biblioteca confiável e políticas explícitas da API.

---

## C. PostgreSQL, migrations, autorização e auditoria

### C1. PostgreSQL Row Security Policies

- **Fonte:** [https://www.postgresql.org/docs/current/ddl-rowsecurity.html](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- **Tipo:** documentação oficial PostgreSQL.
- **Usar para:** definir o comportamento de Row-Level Security (RLS), permissões e políticas sobre linhas.
- **Evidência relacionada:** [PR #9 — desenho de schema e plano de migrations](https://github.com/alexoaraujo83/iam-control-center/pull/9); arquivo [postgresql-migration-design.md](../database/postgresql-migration-design.md).
- **Critérios de validação:** habilitar e avaliar FORCE ROW LEVEL SECURITY onde apropriado; testar com a role runtime não proprietária; negar acesso quando o contexto de tenant está ausente; permitir apenas acesso autorizado; negar leituras/escritas cross-tenant; testar conexões agrupadas e contexto transacional.
- **Limite:** RLS pode ser contornada por roles privilegiadas conforme seus atributos; não usar a role owner/superuser como única evidência de teste.

### C2. PostgreSQL constraints

- **Fonte:** [https://www.postgresql.org/docs/current/ddl-constraints.html](https://www.postgresql.org/docs/current/ddl-constraints.html)
- **Tipo:** documentação oficial PostgreSQL.
- **Usar para:** PK, FK, UNIQUE, CHECK e integridade relacional.
- **Evidência relacionada:** [PR #9](https://github.com/alexoaraujo83/iam-control-center/pull/9).
- **Critérios de validação:** constraints tenant-aware com chaves estrangeiras compostas; testes de duplicidade e valores inválidos; referential integrity; índices para FKs e consultas de autorização; regra documentada para reativação de membership e histórico de permissões.

### C3. PostgreSQL role management and privileges

- **Fonte:** [https://www.postgresql.org/docs/current/user-manag.html](https://www.postgresql.org/docs/current/user-manag.html)
- **Tipo:** documentação oficial PostgreSQL.
- **Usar para:** atributos e privilégios de roles; separar a role responsável por migrations da role de runtime.
- **Evidência relacionada:** plano proposto no [PR #9](https://github.com/alexoaraujo83/iam-control-center/pull/9).
- **Critérios de validação:** runtime sem SUPERUSER, CREATEDB, CREATEROLE, REPLICATION ou BYPASSRLS; runtime não é dono das tabelas; validar privilégios efetivos pelos catálogos e por operações reais; auditoria sem UPDATE/DELETE/TRUNCATE pelo runtime, conforme o desenho acordado.

### C4. PostgreSQL schema/migration design — artefato do projeto

- **Fonte:** [docs/database/postgresql-migration-design.md](../database/postgresql-migration-design.md) e [PR #9](https://github.com/alexoaraujo83/iam-control-center/pull/9).
- **Tipo:** artefato interno; proposta documental, não migration executável.
- **Evidência relacionada:** commit documental abc58bcd0a95a6379bf7694cb2183743467169bc; [CI #40139694057](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40139694057) com conclusão success.
- **Critérios de validação:** resolver as decisões abertas descritas no próprio documento; adicionar migrations apenas em PR separado; testar aplicação inicial, upgrade, idempotência do runner, concorrência, RLS, privilégios efetivos, rollback/forward recovery e isolamento entre dois tenants.
- **Limite:** CI verde para documentação não comprova que migrations existem nem que o modelo funciona em PostgreSQL real.

---

## D. GitHub Actions, permissões e segurança de repositório

### D1. GitHub Actions — Secure use reference

- **Fonte:** [https://docs.github.com/en/actions/reference/security/secure-use](https://docs.github.com/en/actions/reference/security/secure-use)
- **Tipo:** documentação oficial GitHub.
- **Usar para:** privilégio mínimo, segurança de secrets, actions de terceiros, runners e risco de código não confiável.
- **Evidência relacionada:** [workflow de branches Neon](https://github.com/alexoaraujo83/iam-control-center/blob/chore/neon-pr-branching/.github/workflows/neon-branch.yml) e PR #10.
- **Critérios de validação:** fixar actions em SHA completo após validar a origem; limitar permissões de GITHUB_TOKEN; proteger segredos contra logs/exfiltração; revisar quais eventos executam workflows com secrets; não executar conteúdo não confiável em contexto privilegiado.
- **Limite:** a existência de um workflow não comprova que secrets e permissões estejam configurados com menor privilégio.

### D2. GitHub branch protection

- **Fonte:** [https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches)
- **Tipo:** documentação oficial GitHub.
- **Usar para:** regras de proteção, status checks, aprovações, restrições de push e exclusão.
- **Evidência relacionada:** repositório privado; consulta da API de branch protection não forneceu evidência acessível de uma regra aplicada, e a consulta de rulesets foi limitada pelo plano.
- **Critérios de validação:** provar a regra configurada na interface/API e testar seu efeito. Se o recurso não estiver disponível no plano atual, registrar limitação explicitamente e não afirmar que existe bloqueio técnico de merge.
- **Limite de plano:** a documentação informa que branch protection está disponível no GitHub Free para repositórios públicos; proteção em repositórios privados requer plano compatível, como Pro, Team ou Enterprise.

### D3. GitHub Actions environments, deployment protections and secrets

- **Fonte:** [https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- **Tipo:** documentação oficial GitHub.
- **Usar para:** environments, secrets de environment, restrição de branches e revisores de deployment.
- **Evidência relacionada:** limitações de plano observadas para o repositório privado do projeto.
- **Critérios de validação:** verificar disponibilidade no plano e visibilidade do repositório; confirmar que qualquer proteção configurada é efetivamente aplicada; não armazenar credenciais como se fossem isoladas por environment quando o recurso não estiver disponível.
- **Limite de plano:** a documentação atual limita environments/secrets e proteções como required reviewers em repositórios privados conforme o plano. Revalidar as condições na fonte oficial antes de planejar um gate.

### D4. GitHub Quickstart for Actions

- **Fonte:** [https://docs.github.com/en/actions/quickstart](https://docs.github.com/en/actions/quickstart)
- **Tipo:** documentação oficial GitHub.
- **Usar para:** sintaxe/execução básica de workflows e inspeção de resultados.
- **Evidência relacionada:** [CI PR #9 run](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40139694057); [CI PR #10 run](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40148092164); [Neon workflow PR #10 run](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40148092168).
- **Critérios de validação:** registrar nome do workflow, evento, SHA, estado/conclusão, job e logs/artifacts relevantes; conferir que o run pertence ao head em revisão.

---

## E. Artefatos e evidências específicas do repositório

### E1. Repositório IAM Control Center

- **Fonte:** [Settings do repositório](https://github.com/alexoaraujo83/iam-control-center/settings); [README.md](https://github.com/alexoaraujo83/iam-control-center/blob/main/README.md).
- **Tipo:** configuração/artefato interno.
- **Uso:** orientação do projeto, estado do scaffold, scripts de qualidade, documentos de arquitetura e política de evidências.
- **Critérios:** a página de Settings deve ser conferida autenticado antes de afirmar configuração de Rulesets, secrets, Actions ou permissões. O README declara que autenticação, autorização, persistência e deploy ainda não estão production-ready no scaffold; revalidar a versão do arquivo antes de reutilizar esse estado.

### E2. PR #9 — PostgreSQL migration design

- **Fonte:** [https://github.com/alexoaraujo83/iam-control-center/pull/9](https://github.com/alexoaraujo83/iam-control-center/pull/9)
- **Tipo:** PR documental.
- **Head SHA observado:** abc58bcd0a95a6379bf7694cb2183743467169bc.
- **Evidência:** [workflow run #40139694057](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40139694057) terminou success no SHA registrado.
- **Estado observado:** Draft/open na consulta anterior; revalidar antes de qualquer decisão.
- **Critério:** revisão do modelo e das decisões abertas; CI no head atual; sem considerar o documento como migration executável ou como prova de isolamento real.

### E3. PR #10 — Neon PR Branch Lifecycle

- **Fonte:** [https://github.com/alexoaraujo83/iam-control-center/pull/10](https://github.com/alexoaraujo83/iam-control-center/pull/10)
- **Tipo:** mudança de workflow.
- **Head SHA observado:** f7d4aaade9ba712c3b32b066c84431c94b1fcda4.
- **Evidências:** [CI #40148092164](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40148092164) e [Neon PR Branch Lifecycle #40148092168](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40148092168), ambas success no SHA consultado.
- **Estado observado:** Draft/open na consulta de 2026-10-24 (America/Sao_Paulo); revalidar.
- **Pontos pendentes conhecidos:** pin imutável da delete-branch-action; correção/comprovação da afirmação de quota “3 root branches”; testes explícitos para falha, concorrência, cancelamento e cleanup.
- **Critério:** CI no head atual, revisão de segurança e comportamento real das branches; sem migrations, deploy ou escrita em production.

### E4. Estado Neon observado

- **Fonte de verificação:** connector Neon consultado em 2026-10-24; painel e API do Neon são a referência operacional para o estado atual.
- **Projeto retornado:** iam-control-center, id floral-surf-85783683, região aws-sa-east-1, PostgreSQL 18, plano free_v3.
- **Branches retornadas:** production (ready) e preview/pr-10 (ready); preview/pr-10 com init_source parent-schema e expiração 2026-11-08T00:35:02Z.
- **Critério:** tratar como snapshot temporal, não como configuração imutável. Reconsultar branch, expiração, uso e quotas antes de qualquer operação que altere recursos.

---

## F. Lista de pendências extraída do catálogo

| ID | Pendência | Evidência necessária para fechar |
|---|---|---|
| REF-01 | Fixar o SHA da delete-branch-action | Commit SHA verificado no upstream, diff revisado, workflow executado no novo head. |
| REF-02 | Resolver a alegação “3 root branches” do PR #10 | Fonte oficial específica ou correção do texto após validar limites/quota; CI no head revisado. |
| REF-03 | Confirmar proteção de branch/merge no repo privado com plano Free | Evidência de configuração aplicada. Se indisponível, manter como limitação, não como controle ativo. |
| REF-04 | Implementar e provar Auth0 OIDC E2E | Login/callback/logout, sessão, validação JWKS/issuer/audience/expiração, testes negativos e autorização no servidor. |
| REF-05 | Criar/testar migrations PostgreSQL separadamente | PR de SQL revisado; testes isolados de empty DB/upgrade/RLS/privilégios/tenant boundaries/rollback ou forward recovery. |
| REF-06 | Provar cleanup e recuperação do workflow Neon | Runs para PR opened/reopened/synchronize/closed, erro/retry/cancelamento e confirmação da branch removida. |
| REF-07 | Revalidar referências dinâmicas | Data de revisão, versão/limite atual e fonte oficial registrada quando qualquer dependência mudar. |

## Histórico deste catálogo

- **2026-10-24:** primeira consolidação; reuniu documentação oficial Neon/Auth0/PostgreSQL/GitHub, PRs #9–#10, runs observados e critérios de aceitação. Os status operacionais devem ser atualizados em cada revisão relevante.
- Próxima revisão: ao concluir a revisão do PR #10, implementar Auth0, iniciar migrations ou alterar plano/configurações do repositório.
