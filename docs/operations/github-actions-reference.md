# Referências técnicas — GitHub Actions

**Projeto:** IAM Control Center  
**Atualizado em:** 2026-10-25  
**Escopo:** workflows de CI, variáveis/contextos e distinção entre migração de workflows e importação de rulesets.

## 1. Fontes oficiais e quando utilizá-las

| Etapa | Fonte oficial | Utilização no projeto | Limite de aplicação |
|---|---|---|---|
| Migração de CI para GitHub Actions | [Argumentos e configurações complementares do GitHub Actions Importer](https://docs.github.com/pt/actions/reference/github-actions-importer/supplemental-arguments-and-settings#optional-parameters) | Consultar somente quando for necessário migrar workflows de outra plataforma por meio do Actions Importer. Conferir os parâmetros opcionais e as opções aceitas pelo importador. | Não é uma especificação para arquivos YAML de workflow em geral nem um procedimento de importação de rulesets. |
| Implementação e operação de workflows | [Instruções para GitHub Actions](https://docs.github.com/pt/actions/how-tos) | Referência geral para configurar gatilhos, trabalhos, executores, permissões, segredos, concorrência, artefatos, reexecução e diagnóstico. | As instruções específicas devem ser escolhidas conforme a operação em execução; a página é um índice de tarefas. |
| Variáveis, contextos e referências do runtime | [Referência de variáveis](https://docs.github.com/pt/actions/reference/workflows-and-actions/variables) | Confirmar nomes, disponibilidade, limites e contextos de variáveis usados em expressões e scripts de workflow. | A disponibilidade de uma variável/contexto depende do evento e da fase em que a expressão é avaliada. |

## 2. Relação com os artefatos atuais do repositório

### Workflow de qualidade

Arquivo: [`.github/workflows/quality.yml`](../../.github/workflows/quality.yml)

A versão consultada contém:
- gatilhos `push` e `pull_request`;
- `permissions: contents: read`;
- grupo de concorrência `ci-${{ github.ref }}` com `cancel-in-progress: true`;
- job/check com nome `quality`;
- ações referenciadas por SHA imutável;
- instalação com pnpm 10.12.1 e Node.js 24;
- etapas de auditoria de dependências, lint, typecheck, testes e build.

Qualquer alteração nesses pontos deve ser validada por uma execução concluída no SHA exato da alteração.

### Ruleset de qualidade da branch principal

Arquivo versionado: [`main ci quality.json`](../../main%20ci%20quality.json)

O JSON consultado exige um status check cujo contexto é `quality`. Esse nome precisa corresponder ao check produzido pelo workflow. O nome exibido para o ruleset, isoladamente, não demonstra que o check existe nem que foi concluído no SHA em análise.

Antes de importar ou reaplicar uma configuração exportada, comparar o arquivo com a configuração ativa no GitHub. Não presumir que identificadores exportados, o contexto de integração ou o estado do enforcement continuam atuais. Esta documentação não altera nem substitui a configuração ativa do ruleset.

#### Divergência identificada na auditoria de 2026-10-25

A leitura da API do GitHub para o ruleset ativo `25821220` retornou o nome `main_ci_quality`, enforcement `active` e alvo `refs/heads/main`. A comparação com o arquivo versionado `main ci quality.json` identificou divergências materiais:

| Item | JSON versionado (SHA de blob consultado) | Ruleset ativo retornado pela API |
|---|---|---|
| Identificação | ID `25757502`, nome `main ci quality` | ID `25821220`, nome `main_ci_quality` |
| Status check | `quality`, política estrita habilitada | `quality`, política estrita habilitada |
| Resolução de threads de revisão | Obrigatória (`true`) | Não obrigatória (`false`) |
| Aprovação extra para alterações sem atribuição | Não exigida (`false`) | Exigida (`true`) |
| Métodos de merge | `merge`, `squash`, `rebase` | `squash`, `rebase` |
| Regra de exclusão da branch | Não consta no arquivo | Regra `deletion` ativa |
| Deployments obrigatórios | Não constam no arquivo | Ambientes `Development` e `Preview` |

**Conclusão:** o arquivo `main ci quality.json` não representa fielmente o ruleset ativo observado nesta auditoria e não deve ser usado como cópia de restauração/importação sem reconciliação explícita. Não importar o arquivo atual sobre a configuração ativa: isso pode modificar controles de revisão e métodos de merge e deixar de representar regras de exclusão e deployments. Primeiro defina a política desejada, gere um JSON fiel a essa política e revise o arquivo importado na interface antes de salvar.

A documentação oficial explica a criação e a importação de rulesets: [Creating rulesets for a repository](https://docs.github.com/pt/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) e [Managing rulesets for repositories in your organization](https://docs.github.com/pt/organizations/managing-organization-settings/managing-rulesets-for-repositories-in-your-organization). A importação de um JSON cria uma configuração que ainda precisa ser revisada e salva; o arquivo não prova, sozinho, que a configuração ativa corresponde a ele.

A regra ativa também exige deployments bem-sucedidos nos ambientes `Development` e `Preview`. Antes de considerar a política pronta para o fluxo de merge, confirme que esses ambientes são publicados e geram estados de deployment para os SHAs que devem entrar em `main`. A leitura da API de rulesets confirma a configuração declarada, mas não comprova que os deployments exigidos ocorreram.

A atualização do JSON com os campos observados no ruleset ativo está proposta separadamente no [PR #20](https://github.com/alexoaraujo83/iam-control-center/pull/20). No momento deste registro, o PR #20 está em Draft e seus checks ainda precisam concluir com sucesso. Até a revisão e integração verificadas dessa correção, trate o JSON presente em `main` como snapshot desatualizado; depois da integração, confira o conteúdo efetivo em `main` antes de importar. Mesmo com o snapshot corrigido, não o importe no próprio repositório como novo ruleset sem intenção explícita.

### Evidência relacionada de workflows

[PR #10 — ciclo de vida de branches Neon isoladas para PRs](https://github.com/alexoaraujo83/iam-control-center/pull/10)

O PR #10 é uma referência de trabalho relacionada à operação de workflows e está em Draft. Suas execuções e seus resultados pertencem aos SHAs e à branch descritos no próprio PR; não constituem, por si só, evidência de integração em `main` nem validação do ruleset de qualidade.

## 3. Cuidados com variáveis e contextos

- Consulte a documentação de variáveis antes de introduzir uma expressão, especialmente quando o workflow aceitar mais de um tipo de evento.
- `GITHUB_BASE_REF` e `GITHUB_HEAD_REF` são específicos de eventos `pull_request` e `pull_request_target`; não os trate como valores universais em execuções de `push`.
- A variável padrão `GITHUB_REF` corresponde ao contexto `${{ github.ref }}`. Prefira os caminhos e contextos disponibilizados pelo GitHub a caminhos de runner codificados manualmente.
- Não tente sobrescrever variáveis padrão `GITHUB_*` ou `RUNNER_*`.
- Não imprima tokens, segredos ou valores sensíveis nos logs. Use secrets para credenciais e permissões mínimas para o `GITHUB_TOKEN`.

## 4. Critérios de validação para alterações futuras

| Critério | Evidência necessária | Condição para PASS |
|---|---|---|
| Sintaxe e execução do workflow | Execução do GitHub Actions no commit/PR atual | Workflow inicia no evento pretendido e termina sem falha inesperada. |
| Check exigido pelo ruleset | Check runs do SHA exato e configuração ativa do ruleset | Existe um check chamado `quality`, concluído com sucesso no SHA exigido. |
| Atualidade da evidência | SHA da execução comparado ao HEAD do PR | SHA corresponde ao código em avaliação; resultado antigo, cancelado, ignorado ou de outro SHA não é PASS. |
| Segurança da execução | Revisão de `permissions`, secrets, expressões e logs | Permissões mínimas; nenhum segredo exposto; variáveis usadas apenas nos eventos/contextos suportados. |
| Importação de configuração | Revisão do JSON e comparação com a configuração ativa | O conteúdo representa as regras pretendidas e não é tratado como uma prova de enforcement sem verificação posterior. |

Para reproduzir as verificações locais cobertas pelo workflow, use os scripts definidos no repositório, incluindo `pnpm install --frozen-lockfile`, `pnpm audit`, `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm build`. O resultado local complementa, mas não substitui, a evidência atual do GitHub Actions no SHA objeto da revisão.

## 5. Regra de uso da biblioteca

A documentação oficial é a fonte normativa. Os arquivos do repositório mostram a configuração observada no momento da revisão. Antes de declarar PASS, reconciliar ambos com a execução atual, a branch/commit em análise e a configuração ativa no GitHub. Não inferir que uma importação, um arquivo JSON ou uma execução anterior ativou ou validou automaticamente um ruleset.
