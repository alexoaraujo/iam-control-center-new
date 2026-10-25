# Catálogo permanente de fontes — IAM Control Center

**Versão:** 1.2  
**Última revisão das páginas e evidências:** 2026-10-25 (America/Sao_Paulo).  
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
- **Evidência relacionada:** [PR #10](https://github.com/alexoaraujo83/iam-control-center/pull/10); [workflow executado #40157800722](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40157800722), success no head reconciliado `efa981fc9a5c79ffac579b7e94089eb39f754404`; preflight reutilizou a preview existente. PRs de forks são ignorados explicitamente porque não recebem secrets.
- **Critérios de validação:** confirmar o evento do PR, nome determinístico da branch, origem/tipo da branch, outputs secretos, permissões do workflow, expiração, exclusão e comportamento de retry/cleanup. Confirmar que o workflow não executa migrations ou SQL em production.
- **Limite:** o sucesso do workflow não comprova, isoladamente, que todos os cenários adversariais, concorrentes ou de falha foram exercitados.

### A2. Neon API Reference

- **Fonte:** [https://neon.com/docs/reference/api](https://neon.com/docs/reference/api)
- **Tipo:** especificação oficial da API REST Neon.
- **Usar para:** validar nomes de endpoints, parâmetros, schema de request/response, erros e operações suportadas antes de implementar chamadas próprias.
- **Evidência relacionada:** [PR #10](https://github.com/alexoaraujo83/iam-control-center/pull/10); workflow em [.github/workflows/neon-branch.yml](https://github.com/alexoaraujo83/iam-control-center/blob/chore/neon-pr-branching/.github/workflows/neon-branch.yml), head atual `c5b378d2de0f7c6afc8f49e5e5d38848f51a49a9`. O workflow ignora PRs de forks porque o evento `pull_request` não fornece repository secrets e verifica a existência da preview antes de excluir.
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
- **Limite importante:** branches `schema-only` são branches raiz no Neon e consomem a quota de roots; não considerar a palavra schema-only no workflow como prova suficiente de isolamento, consultar o estado real e testar o resultado.

### A6. Neon plans and quotas

- **Fonte:** [Neon plans](https://neon.com/docs/introduction/plans); [Manage branches — root branch allowance](https://neon.com/docs/manage/branches)
- **Tipo:** documentação oficial de planos/limites.
- **Usar para:** verificar quotas incluídas, recursos por plano e limites relevantes a branches.
- **Evidência relacionada:** projeto Neon iam-control-center consultado em 2026-10-25: plano `free_v3`; API retorna `branches_limit: 10` como quota geral. A documentação atual de Manage branches lista 3 roots no Free e classifica branches `schema-only` como roots. O inventário atual tem duas roots: `production` e `preview/pr-10`; `preview/pr-12` foi removida após o PR #12. CI atual do PR #10: [#40159031535](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40159031535); workflow Neon [#40159031482](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40159031482). O teste de quota cheia usou PR #17 para ocupar a terceira root e PR #18 para provar o bloqueio da quarta root; limpeza validada em [#40159228360](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40159228360). Cleanup e recriação após close/reopen foram validados nos runs [#40158861105](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158861105) e [#40158884423](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158884423).
- **Critérios de validação:** consultar quota/uso antes de criar branches; testar a barreira de quota cheia; aplicar expiração/cleanup; não presumir que TTL libera capacidade antes da exclusão efetiva.
- **Correção aplicada:** o workflow consulta branches pela API, reutiliza preview existente ready, recusa criar quando a quota de roots está cheia, ignora forks e faz cleanup idempotente. O head `9f9a215632b6506403a3cf0d99a3f8d08576b4d2` passou CI [#40159031535](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40159031535) e Neon [#40159031482](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40159031482). Cleanup/recriação de `preview/pr-10` PASS nos runs #40158861105/#40158884423; quota cheia PASS: PR #17 criou a terceira root (#40159174152), PR #18 falhou no preflight e não criou quarta root (#40159198770); fechamento de PR #18 pulou delete de branch ausente (#40159212505) e PR #17 removeu `preview/pr-17` (#40159228360). Issue #14 fechada.
- **Observação:** quotas e recursos de plano são dinâmicos; esta seção não substitui a consulta ao estado atual da conta.

### A9. Neon Free Plan — artigo de contexto complementar

- **Fonte:** [https://neon.com/blog/neon-free-plan-1-gb-per-project](https://neon.com/blog/neon-free-plan-1-gb-per-project)
- **Tipo:** artigo oficial do blog Neon; material contextual, não substitui a documentação normativa de planos.
- **Usar para:** contexto sobre a proposta/benefícios do plano gratuito e mudanças anunciadas pela Neon.
- **Referências operacionais prioritárias:** [documentação oficial de planos](https://neon.com/docs/introduction/plans), console do projeto e resposta atual da API Neon.
- **Evidência relacionada:** snapshot do projeto IAM Control Center registrado neste catálogo e no índice operacional; consultar novamente antes de qualquer decisão sobre quotas.
- **Critérios de validação:** confirmar no momento da execução o plano ativo, limites aplicáveis, uso/consumo e quotas no console/API; registrar data, resultado e projeto/branch envolvidos sem expor credenciais.
- **Limite:** o título do artigo menciona 1 GB por projeto, mas não deve ser tratado como prova de que essa quota ou qualquer outro limite permanece vigente para a conta atual. Não inferir número de branches raiz a partir do artigo ou de uma descrição resumida.

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
| Delete branch | [neondatabase/delete-branch-action](https://github.com/neondatabase/delete-branch-action) | Pin no SHA `4468d825d5a88ef4012f1705a82f02ec3072f776` em `.github/workflows/neon-branch.yml` | Testar exclusão pelo nome/ID correto e confirmar a ausência da preview após fechamento autorizado de PR. |
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
- **Evidência relacionada:** API GitHub consultada em 2026-10-25 retornou `private: false` (repositório público), ruleset `main ci quality` (`id: 25761691`) com `enforcement: disabled` e branches `protected: false`. Acompanhar issues [#13](https://github.com/alexoaraujo83/iam-control-center/issues/13) (enforcement) e [#15](https://github.com/alexoaraujo83/iam-control-center/issues/15) (confirmar visibilidade). Não declarar branch protection ativa.
- **Critérios de validação:** provar a regra configurada na interface/API e testar seu efeito. Se o recurso não estiver disponível no plano atual, registrar limitação explicitamente e não afirmar que existe bloqueio técnico de merge.
- **Limite de plano:** a documentação informa que branch protection está disponível no GitHub Free para repositórios públicos; proteção em repositórios privados requer plano compatível, como Pro, Team ou Enterprise.

### D3. GitHub Actions environments, deployment protections and secrets

- **Fonte:** [https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- **Tipo:** documentação oficial GitHub.
- **Usar para:** environments, secrets de environment, restrição de branches e revisores de deployment.
- **Evidência relacionada:** a visibilidade atual precisa ser confirmada: API retornou `private: false`; consultar issue #15. A disponibilidade de environments/proteções deve ser validada para a visibilidade/plano efetivos.
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
- **Tipo:** PR documental, integrado na branch de trabalho.
- **Head validado:** `46288be445803bdca09445a15b994d0cc46d71b5`.
- **Evidência:** [CI PR #40158212892](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158212892) passou no head exato; merge commit `7f64580e739ab997aac4be6c1adf2acea2f0516a`.
- **Estado:** merged na branch de trabalho `fix/health-runtime-config`, não em `main`.
- **Critério:** resolver retenção de auditoria, migration runner, privilégios e testes isolados antes de SQL; o documento não prova RLS efetiva.

### E3. PR #10 — Neon PR Branch Lifecycle

- **Fonte:** [https://github.com/alexoaraujo83/iam-control-center/pull/10](https://github.com/alexoaraujo83/iam-control-center/pull/10)
- **Tipo:** mudança de workflow; PR Draft/open.
- **Head atual:** `de0ed2f26c7a5b1e3182f6320cad983b9bfa0596`.
- **Evidências:** [CI #40158589651](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158589651) e [Neon lifecycle #40158589464](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158589464) passaram no SHA exato.
- **Correções:** actions pinadas por SHA; preflight de quota; reutilização de preview ready; criação/exclusão ignoram forks; cleanup idempotente verifica existência antes de deletar.
- **Cleanup real:** após o PR #12 ser merged/fechado, [run #40158359717](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158359717) executou o job de exclusão com PASS; inventário Neon atual mostra `preview/pr-12` ausente.
- **Pendência bloqueadora:** cenário de quota cheia ainda não foi exercitado; acompanhar [issue #14](https://github.com/alexoaraujo83/iam-control-center/issues/14). Não criar/fechar PR de teste que apague branch sem autorização explícita; o operador autorizou permanentemente ações de merge, fechamento e exclusão nesta sessão. Ainda assim, quota cheia permanece pendente porque não há teste controlado com cleanup completo da branch Git de teste.
- **Critério:** não executar SQL, migrations, seeds ou deploy; sem escrita em `production`.

### E4. Estado Neon observado

- **Fonte de verificação:** connector Neon consultado em 2026-10-25; painel e API Neon são a referência operacional para o estado atual.
- **Projeto retornado:** iam-control-center, id `floral-surf-85783683`, região `aws-sa-east-1`, PostgreSQL 18, plano `free_v3`.
- **Branches atuais:** `production` (ready, `protected: false`) e `preview/pr-10` (ready, `init_source: parent-schema`); `preview/pr-12` foi excluída com sucesso no evento de fechamento/merge do PR #12. As duas branches observadas são roots; `production` não foi alterada.
- **Quota e proteção:** o Free permite 3 roots; a quota geral `branches_limit: 10` é separada. Não criar preview temporária sem plano aprovado para limpeza; Neon protected branches não serão habilitadas via upgrade de plano.
- **Critério:** tratar como snapshot temporal. Reconsultar branches, expiração, uso e quotas antes de qualquer operação que altere recursos.

---

### E5. PR #2 — bootstrap, lockfile e dependency security

- **Fonte:** [PR #2](https://github.com/alexoaraujo83/iam-control-center/pull/2).
- **Estado:** merged em `main`, commit `18a30ab67b9422be4c86c73675384e709a40a03d`.
- **Evidência:** CI pré-merge [#40158267537](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158267537) e CI pós-merge [#40158331912](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158331912) PASS.
- **Escopo:** lockfile congelado, dependency audit, lint/typecheck/tests/build, endpoint de health sem exposição de secrets e dependências corrigidas.
- **Limite:** não comprova Auth0 real, banco/RLS, migrations ou deploy.

### E6. PR #12 — biblioteca permanente de referências

- **Fonte:** [PR #12](https://github.com/alexoaraujo83/iam-control-center/pull/12).
- **Estado:** merged no branch `chore/neon-pr-branching`, commit `6417d4403ce41093856c237b47215777b0dc4833`; não foi mesclado diretamente em `main`.
- **Evidência de cleanup:** [workflow Neon #40158359717](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158359717) executou o job `Delete Neon PR branch` com PASS; o inventário atual confirma que `preview/pr-12` não existe.
- **Estado da biblioteca:** `docs/reference/README.md` e `docs/reference/permanent-source-catalog.md` foram sincronizados no branch do PR #10. CI e workflow Neon precisam passar no head mais recente antes de qualquer decisão sobre o PR #10.
- **Limite:** catálogo de fontes/evidências não é prova de Auth0 OIDC, RLS, migrations ou produção pronta.

## F. Lista de pendências extraída do catálogo

| ID | Pendência | Evidência necessária para fechar |
|---|---|---|
| REF-01 | Fixar o SHA da delete-branch-action | **Implementado e cleanup observado:** SHA `4468d825d5a88ef4012f1705a82f02ec3072f776`; runs [#40158359717](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158359717) (PR #12) e [#40158861105](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158861105) (PR #10) executaram exclusão com PASS; a reabertura recriou a preview em [#40158884423](https://github.com/alexoaraujo83/iam-control-center/actions/runs/40158884423). Falha/retry ainda pendentes. |
| REF-02 | Respeitar quota de branches raiz no Neon Free | **Concluído:** PR #17 ocupou a terceira root; PR #18 foi bloqueado pelo preflight antes de criar a quarta; PRs temporários foram fechados e a quota voltou a duas roots. Evidências #40159174152, #40159198770, #40159212505 e #40159228360. Issue #14 fechada. |
| REF-03 | Confirmar proteção de branch/merge e visibilidade do repositório | API retornou `private: false`, ruleset `main ci quality` com `enforcement: disabled` e branches `protected: false`. Acompanhar issues #13 e #15; não declarar enforcement ativo. |
| REF-04 | Implementar e provar Auth0 OIDC E2E | Login/callback/logout, sessão, validação JWKS/issuer/audience/expiração, testes negativos e autorização no servidor. |
| REF-05 | Criar/testar migrations PostgreSQL separadamente | PR de SQL revisado; testes isolados de empty DB/upgrade/RLS/privilégios/tenant boundaries/rollback ou forward recovery. |
| REF-06 | Provar cleanup e recuperação do workflow Neon | **Cleanup e idempotência validados:** close/reopen PR #10 removeu e recriou preview; PR #18 fechou sem preview e o cleanup pulou delete com success; PR #17 removeu preview existente. Evidências #40158861105, #40158884423, #40159212505 e #40159228360. PR #12 também removeu preview no #40158359717. Retry/concurrency/cancelamento adicionais seguem pendentes. |
| REF-07 | Revalidar referências dinâmicas | Data de revisão, versão/limite atual e fonte oficial registrada quando qualquer dependência mudar. |

## Histórico deste catálogo

- **2026-10-24:** primeira consolidação; reuniu documentação oficial Neon/Auth0/PostgreSQL/GitHub, PRs #9–#10, runs observados e critérios de aceitação. Os status operacionais devem ser atualizados em cada revisão relevante.
- **2026-10-24:** adicionado o artigo oficial do blog sobre o plano gratuito como contexto complementar; documentação oficial de planos e estado atual do console/API permanecem como referência para decisões de quota.
- Próxima revisão: ao concluir a revisão do PR #10, implementar Auth0, iniciar migrations ou alterar plano/configurações do repositório.
