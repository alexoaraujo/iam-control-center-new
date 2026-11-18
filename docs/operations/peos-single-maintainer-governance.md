# PEOS — Política de mantenedor único (v1.0)

**Adoção proposta em 17/11/2026 UTC** — repositório `alexoaraujo/iam-control-center-new`.  
**Responsável único pela decisão operacional:** mantenedor administrativo do repositório `alexoaraujo`.

## Decisão normativa

A partir da **integração e ativação verificável desta política**, **não há aprovação humana independente, segundo revisor, segunda conta GitHub, segundo operador ou aceite independente de rollback obrigatórios** no PEOS. O mantenedor único pode autorizar suas próprias alterações e operações e executar o rollback. Uma revisão independente poderá ser solicitada voluntariamente, mas a sua ausência **não é causa de bloqueio**.

**Não reduzir segurança a uma aprovação verbal:** uma decisão do mantenedor não converte em `PASS` um controle técnico que não foi executado. A execução continua vinculada a SHA, branch, escopo, janela UTC, logs auditáveis e verificação de precondições.

Esta é uma **mudança de política prospectiva**, não uma reescrita de evidências históricas. Reviews, aprovações, leases e backups anteriores permanecem com seus estados e IDs originais. PRs de aprovação anteriores não se tornam automaticamente autorizadas.

## Responsabilidade e segregação técnica

- **Um humano:** o mantenedor decide, registra e executa (ou delega opcionalmente). Não exigir outro humano como reviewer, rollback operator ou aprovador.
- **Controles técnicos separados:** preservar contas de serviço, tokens/roles dedicados, isolamento por ambiente/branch, privilégios mínimos, sessões de banco distintas para testes de revogação, backups privados e evidência de restauração. `independent connection` e `independent test` significam independência *técnica*, não segundo operador.
- **Autorização autocertificada rastreável:** para mudança sensível, registrar `operator=alexoaraujo`, `decision=APPROVED_BY_MAINTAINER`, SHA completo, motivo, alvo e branch exatos, horário UTC, evidência de snapshot, período autorizado, plano de recuperação e IDs dos checks. O próprio mantenedor pode assinar a decisão. Um comentário de intenção sem execução/revalidação não prova que o controle está operacional.
- **Fail-closed inalterado:** Auth0 E2E real, HTTP grant 200/revoke 403, PostgreSQL 18, RLS deny-by-default, controle de roles/ACLs, `quality`, `security-gate` integrado, restrições OIDC, preservação de secrets, callback por SHA, snapshot e rollback conforme o risco. Nunca converter `SKIPPED`/`FAILED` em `PASS` por autorização.
- **Produção:** qualquer promoção exige controle de origem/branch e aprovação explícita do SHA pelo **mesmo mantenedor**, ensaio de rollback e checagens efetivas. Ignored Build Step da Vercel não equivale a garantia primária; evitar push/merge na `main` até comprovar comportamento de Production.
- **Operações de dados:** `GRANT`, `REVOKE`, backup, restore ou rotação em Neon exigem pré-condições técnicas, URLs diretas com TLS `verify-full`, allowlists e leases isolados. O mesmo mantenedor pode aprovar, executar e recuperar; **não** reutilizar senha/role de runtime como identidade administrativa, nem dispensar RLS/rollback.
- **GitHub Environments:** `Required reviewers` deve ser desativado nos ambientes que seguem esta política, com `prevent_self_review=false`, mantendo branch policy restrita, secrets em Environment, `can_admins_bypass=false` quando aplicável e checks obrigatórios. Verificar a configuração efetiva via API e manter os Jobs de risco em Environment protegido mesmo sem reviewers.
- **GitHub Ruleset `protect-main`:** preservar PRs, resolução de threads, bloqueio de force-push/deletion e checks `quality`/`security-gate`. Readback de 17/11/2026: `required_approving_review_count=0`, `required_reviewers=[]`, `require_code_owner_review=false`. Não desabilitar os checks para eliminar aprovação humana.

## Campos mínimos de autorização operacional autocertificada

```text
PEOS_MAINTAINER_OPERATION_APPROVED
operator=alexoaraujo
decision=APPROVED_BY_MAINTAINER
repository=alexoaraujo/iam-control-center-new
target_environment=<exact environment>
target_branch=<exact branch>
target_sha=<40 lowercase hex>
operation=<read_only|preview_lease|neon_disposable_restore|neon_disposable_revoke|production_release>
window_start_utc=<ISO8601>
window_end_utc=<ISO8601>
snapshot_evidence_id=<verified provider identifier>
rollback_plan_id=<audited plan>
checks_evidence_ids=<real run IDs>
technical_preconditions=<PASS with evidence, otherwise BLOCKED>
```

Placeholders são exemplo, nunca aceite fictício. A decisão só vale no intervalo e SHA especificados, não transfere autorização para outra PR.

## Transição e limites de execução

1. Integrar primeiro esta política e scripts/testes compatíveis por PR, sob os checks atuais. Até a integração, o comportamento existente não deve ser declarado alterado.
2. Em **Settings → Environments**, remover `Required reviewers` de forma controlada, ambiente por ambiente, sem modificar secrets ou branch restrictions. O conector GitHub desta conversa não disponibiliza a edição administrativa de Environment, portanto **nenhuma mudança real desse tipo deve ser afirmada sem readback**.
3. Para ambientes com scripts antigos que exigiam um segundo reviewer, usar a versão atualizada e seus testes, sem autoaplicar a alteração em leases expirados. Rever referências antigas antes de operações reais.
4. Revalidar as operações por SHA exato e registrar a decisão do mantenedor; incidentes e rollback continuam documentados em UTC.
5. Não fazer merge automático de PRs bloqueadas pela CI, Auth0, RLS ou governança de Production.

## Revalidação crítica da ruleset ativa (17/11/2026 UTC)

Um readback autenticado posterior à redação inicial constatou a **substituição** da ruleset `protect-main` ID `26988310` pela ruleset **ativa ID `27506312`**. A versão consultada anteriormente mantinha zero revisores obrigatórios, mas exigia **somente `quality`**. **Nova leitura autenticada neste ciclo confirmou que a ruleset #27506312 agora exige `quality` e `security-gate`**, ambos com GitHub Actions integration ID `15368`. O drift de required checks foi corrigido externamente à presente PR; a conexão não registra quem alterou a regra.

**Readback de proteção cumprido:** `security-gate` voltou à lista dos checks obrigatórios, **sem adicionar revisores**. Revalidar o ID da ruleset, integração e checks após qualquer alteração futura. **Outros gates continuam bloqueados**: PR #128 requer Preview e Auth0 E2E no SHA exato; a configuração administrativa de reviewers dos GitHub Environments ainda não foi lida/aplicada pelo conector.

**Estado inicial da política:** `POLICY=PROPOSED_IN_PR`; `GITHUB_MAIN_CODE_REVIEW_COUNT=0_AT_READBACK`; `ENVIRONMENT_ADMIN_REVIEWERS=UNVERIFIED_NOT_MODIFIED`; `OPERATIONAL_AUTHORIZATIONS=NOT_RETROACTIVE`.
