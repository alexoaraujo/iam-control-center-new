# G1 — restrições efetivas dos GitHub Environments (18/11/2026)

**Status operacional: BLOCKED / requer GitHub Repository Administration.** Este runbook não altera Environments e não constitui aprovação. O GitHub App conectado suporta leitura, commits e PRs, mas não permite atualizar Settings → Environments ou Rulesets.

## Evidência da falha

Run [44205711997](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44205711997) no SHA da PR #128 `4ff66d3d2944934e48a8a096e998962a745d421e`:

- `BLOCKED_PE0S_ENV Preview BRANCH_RESTRICTIONS_NOT_ATTESTED`
- `BLOCKED_PE0S_ENV Neon-PR-Lifecycle BRANCH_RESTRICTIONS_NOT_ATTESTED`
- Cinco outros Environments: `PASS_PE0S_ENV_NO_HUMAN_APPROVAL`.

## Configuração administrativa a aplicar

1. Abrir `https://github.com/alexoaraujo/iam-control-center-new/settings/environments`.
2. Para **Neon-PR-Lifecycle**: em *Deployment branches and tags* escolher **Selected branches and tags** e permitir **somente `main`**. O workflow `.github/workflows/neon-pr-branch-lifecycle.yml` usa `workflow_dispatch` e exige explicitamente `refs/heads/main` antes de acessar `NEON_API_KEY`. Não abrir `refs/pull/*/merge` nesse Environment.
3. Para **Preview**: escolher **Selected branches and tags**. Permitir `main` para operações de main que usam este Environment. Para PRs que exigem Preview/Authenticação, autorizar os refs de merge **`refs/pull/128/merge`** e **`refs/pull/129/merge`** somente enquanto forem necessários para o trabalho destas PRs, removendo após a conclusão. Para futuras PRs, incluir explicitamente `refs/pull/NUMERO/merge` somente após classificação do escopo. **Não confundir o nome da branch de origem com o `GITHUB_REF` em `pull_request`**.
4. Em **ambos**, manter *Required reviewers* vazio, *Wait timer* 0, *Allow administrators to bypass configured protection rules* desativado e *Custom deployment protection rules* sem regras inesperadas.
5. Não alterar, revelar, duplicar ou regravar secrets, tokens, credentials ou environment variables. Não habilitar políticas globais de bypass ou desproteger `main`.

> Nota de compatibilidade: a documentação oficial GitHub explica que `pull_request` usa `refs/pull/NUMERO/merge`, e que um padrão opcional `refs/pull/*/merge` permite todas as PRs. **Não usar o wildcard global como padrão aqui**: os testes IAM empregam callbacks Auth0/Neon com escopo específico e o conjunto de PRs deve ser mínimo. Caso uma PR não listada necessite acesso, passar pela verificação de lease e adicionar seu ref explicitamente, sem ignorar a proteção.

## Como verificar após a alteração

- Reexecutar o *PEOS Environment approvals readback* na PR #128, usando o SHA aprovado da branch atual; não marcar PASS com base apenas em captura de tela.
- Exigir `PEOS_ENVIRONMENTS=7 BLOCKED=0`, `can_admins_bypass=false`, ausência de revisores humanos, regra de branches selecionadas aplicada e listagem efetiva dos padrões permitidos.
- Em um workflow `pull_request` aprovado, confirmar acesso a **Preview**; em um `workflow_dispatch` sobre `main`, confirmar acesso a **Neon-PR-Lifecycle** sem ler nem imprimir valores de secrets.
- O readback existente verifica a presença do mecanismo de restrição; uma verificação separada deve comparar **também os padrões permitidos** com esta allowlist antes de declarar paridade integral.
- Preservar checks `quality` e `security-gate`. Falha ou `SKIPPED` do Auth0 E2E não pode ser tratado como sucesso de autorização.

## Política de release/*

A ruleset `protect-release-branches` (#27234184) permanece com 1 aprovação humana e revisão CODEOWNERS; isso diverge da política de mantenedor único, mas não concede autorização para remover checks, bloqueios de histórico, revisões resolvidas ou proibições de force-push. Ajustes de Settings são separados deste runbook, requerem leitura posterior do JSON efetivo e não são declarados aplicados aqui.
