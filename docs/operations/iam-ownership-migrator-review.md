# Revisão de ownership e privilégio do migrator

Status: **análise arquitetural para revisão; nenhuma alteração aplicada ao Neon**.

## Estado observado na migration 0001

A migration exige `current_user = iam_owner`, cria os schemas `iam`, `audit` e `app_private` com `AUTHORIZATION iam_owner`, e cria as tabelas sob essa identidade efetiva. O ledger `iam.schema_migrations` fica sem FORCE RLS e sem grants ao runtime. As tabelas de negócio/auditoria recebem ENABLE + FORCE RLS, sem policies nem grants de runtime na baseline.

O bootstrap PostgreSQL descartável concede `CREATE` no database a `iam_owner`. A introspecção Neon registrada na checklist não demonstrou ainda que esse privilégio está presente no database real. A migration atual não faz preflight explícito de `has_database_privilege(current_user, current_database(), 'CREATE')`.

## Alternativas

| Alternativa | Ownership de schemas/tabelas | Capacidade do login migrator | Avaliação |
|---|---|---|---|
| A. Owner separado, migrator assume owner | `iam_owner` | `iam_migrator_login → iam_migrator → iam_owner` via SET TRUE | Preserva owner NOLOGIN e identidade administrativa separada; cadeia precisa ser estritamente limitada e auditada |
| B. Migrator como owner | `iam_migrator` | Assume somente `iam_migrator` | Remove o salto para owner, mas mistura identidade de execução de migrations com ownership duradouro dos objetos |
| C. Login assume owner diretamente | `iam_owner` | `iam_migrator_login → iam_owner` | Mais simples, mas elimina o grupo intermediário como fronteira organizacional; menor granularidade para agrupar logins migrator |

## Recomendação para revisão

Manter a Alternativa A como proposta preferencial, condicionada a todos os controles abaixo. Ela preserva a distinção entre:
- `iam_owner`: owner NOLOGIN dos objetos e schemas IAM;
- `iam_migrator`: role de capacidade de execução de migrations;
- `iam_migrator_login`: credencial LOGIN dedicada, NOINHERIT e NOBYPASSRLS;
- `iam_app_runtime`: role de aplicação sem membership em owner/migrator.

A cadeia de assunção é um privilégio administrativo efetivo: quem pode assumir `iam_owner` pode alterar objetos pertencentes ao owner. `iam_migrator` não deve ser tratado como role de baixo privilégio só por ser NOLOGIN. A credencial migrator deve ficar fora do runtime e ser usada apenas por processo controlado, com migration revisada e checksum registrado.

A Alternativa B não é recomendada para a baseline atual porque deixa o role de execução como owner persistente de todos os objetos. Pode ser reconsiderada se houver requisito operacional que justifique ownership pelo migrator e uma revisão completa do preflight, dos owners e do ledger.

## Preflight e testes adicionais obrigatórios antes de qualquer execução Neon

1. Confirmar no database alvo que `iam_owner` tem `CREATE` no database; o preflight deve falhar com mensagem clara se não tiver.
2. Confirmar que as duas memberships existem com `SET TRUE`, `INHERIT FALSE` e `ADMIN FALSE`, sem memberships alternativas que contornem a cadeia.
3. Confirmar `session_user = iam_migrator_login` e `current_user = iam_owner` na sessão real, sem usar `Administrador`.
4. Confirmar que os schemas e objetos criados pertencem a `iam_owner`.
5. Confirmar `iam_owner`, `iam_migrator`, `iam_app_runtime` como NOLOGIN/NOBYPASSRLS e `iam_migrator_login` como LOGIN/NOINHERIT/NOBYPASSRLS.
6. Confirmar que `iam_app_runtime` não é membro direto ou transitivo de `iam_migrator` ou `iam_owner`.
7. Executar a migration somente em banco descartável antes de qualquer aprovação de execução Neon.

## Decisão e limites

Esta recomendação não aprova os GRANTs, não aprova execução da migration e não altera roles. A topologia Neon atual precisa ser consultada novamente antes de qualquer decisão operacional. Production, Development e Preview permanecem intocados até autorização específica.
