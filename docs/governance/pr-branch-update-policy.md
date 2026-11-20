# PEOS — Política de atualização de branches de Pull Requests

**Repositório:** `alexoaraujo/iam-control-center-new`  
**Vigência proposta:** a partir da aprovação e integração desta política.  
**Escopo:** todas as PRs do IAM Control Center NEW, inclusive PRs empilhadas e alterações em G1/G2/G3/G4.

## Decisão

**Método padrão obrigatório: `Update with merge commit`.** O merge da branch base na branch da PR preserva os SHAs dos commits anteriores, adicionando um novo commit de integração. Não confundir atualização de branch com a decisão final de realizar o merge da PR na `main`.

**Exceção: `Update with rebase` somente quando comprovadamente:**
1. a branch não tem dependência de nenhum SHA em testes, gates, workflows, autorizações, liberações, attestações, deployments ou aprovações;
2. não há evidências de auditoria, custódia, RBAC/RLS, backup/restore, Auth0/Neon/Vercel/Backblaze B2 ou security-gate vinculadas aos commits;
3. o responsável registra **antes** da operação a justificativa e o inventário negativo de vínculos na PR;
4. o histórico pode ser reescrito sem comprometer revisões, colaboração ou branch protection; qualquer novo SHA será testado novamente.

Na dúvida, **não executar rebase**. Não usar force-push para contornar proteção da `main` ou dos ambientes.

## Checklist antes do Update

- Confirmar que a PR está aberta, seu destino (`base`) e seu `head SHA` atual.
- Conferir se a branch está atrás da base e se não há conflitos.
- Avaliar se a atualização impactará evidências, leases, approvals ou workflows vinculados a SHA.
- Para atualizar, escolher **Update with merge commit** na interface do GitHub. Alternativamente, usar o workflow manual `.github/workflows/pr-update-merge-commit.yml`, informando número da PR, SHA atual e ciência da alteração de SHA.
- Não atualizar em massa PRs de alto risco automaticamente. Respeitar a ordem de dependência das PRs empilhadas.

## Verificação após o Update

1. Registrar o SHA anterior, o novo `head SHA`, o SHA da base, data/hora UTC, PR e link da execução;
2. verificar que o SHA anterior permanece alcançável no histórico do merge commit (sem rebase);
3. reexecutar no **novo SHA** os checks obrigatórios e os gates aplicáveis (security-gate, PG18, Auth0 E2E, RBAC/RLS, Neon, Preview, backup/readback/restore e rollback);
4. reconciliar ou renovar todas as evidências, aprovações e leases que exigem correspondência com o SHA exato;
5. não declarar PASS, não realizar merge final e não promover Production enquanto houver evidência obsoleta, erro, BLOCKED ou check pendente.

`Update with merge commit` **preserva os commits anteriores, mas altera o HEAD**. Evidência associada ao HEAD antigo não se transfere automaticamente para o novo HEAD.

## Configuração do GitHub

- A opção **Settings → General → Pull Requests → Always suggest updating pull request branches** controla a *sugestão de atualização*, **não** torna merge commit a única opção disponível. GitHub não oferece nessa configuração uma seleção nativa de método padrão para o botão de Update.
- O workflow manual incluído nesta PR é **somente merge commit** e usa a API `PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch` com `expected_head_sha`, sem `force` e sem bypass de proteção.
- O workflow não aprova PRs, não efetua merge final nem substitui os checks necessários.
- O modo **Update with rebase** continua sendo exceção manual, documentada e sujeita ao gate PEOS.

## Evidência da exceção (quando necessária)

Registrar na PR, antes do rebase:

| Campo | Informação exigida |
| --- | --- |
| PR / base / head anterior | URL, nome da base e SHA exato |
| Inventário de dependências por SHA | Resultado: nenhuma, com escopos verificados |
| Inventário de evidências de auditoria | Resultado: nenhuma, com escopos verificados |
| Justificativa | Necessidade técnica da linearização |
| Revisão | Autor/responsável e data/hora UTC |
| Após o rebase | Novo SHA, checks e gates reexecutados |

**Princípio PEOS:** Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar. Não há bypass por conveniência.
