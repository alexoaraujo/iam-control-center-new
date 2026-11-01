# Proposta de cadeia de assunção de roles do migrator

Status: **proposta para revisão; não aplicada ao Neon**.

## Objetivo

Permitir que o login dedicado `iam_migrator_login` execute a migration baseline, cujo preflight exige `current_user = iam_owner`, sem tornar o login proprietário, sem conceder `BYPASSRLS` e sem envolver o runtime.

## Topologia proposta para teste

```text
iam_migrator_login (LOGIN, NOINHERIT, NOBYPASSRLS)
  └─ SET TRUE → iam_migrator (NOLOGIN, NOINHERIT, NOBYPASSRLS)
       └─ SET TRUE → iam_owner (NOLOGIN, NOBYPASSRLS)
```

A proposta utiliza membership transitiva com `SET TRUE` e `INHERIT FALSE`. O login precisa assumir explicitamente `iam_migrator` e depois `iam_owner`; os privilégios não devem ser herdados automaticamente. `ADMIN FALSE` impede que o membro administre a membership concedida.

## SQL proposto — somente referência

Executar apenas em banco PostgreSQL descartável para teste. **Não executar no Neon**.

```sql
GRANT iam_owner TO iam_migrator
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;

GRANT iam_migrator TO iam_migrator_login
  WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
```

No Neon, a segunda membership já foi observada com `INHERIT` e `SET`; portanto, a mudança potencial seria somente a primeira concessão. A consulta real deverá ser repetida antes de qualquer mudança, pois o estado pode ter mudado.

## Controles obrigatórios

- `iam_owner`, `iam_migrator` e `iam_app_runtime`: NOLOGIN e NOBYPASSRLS.
- `iam_migrator_login`: LOGIN, NOINHERIT e NOBYPASSRLS.
- Memberships sem `ADMIN OPTION`.
- Nenhuma membership de `iam_app_runtime` para `iam_migrator` ou `iam_owner`.
- Nenhuma concessão a `Administrador` como substituto do login dedicado.
- A credencial de `iam_migrator_login` não deve ser compartilhada com aplicação, CI genérico ou runtime.
- A sessão deve demonstrar `session_user = iam_migrator_login` e `current_user = iam_owner` imediatamente antes do preflight.

## Evidência automatizada e limite

O teste `database/tests/role-assumption-contract.sql` cria roles apenas no PostgreSQL 18 descartável do CI, aplica as memberships propostas e tenta a sequência `SET ROLE iam_migrator` → `SET ROLE iam_owner`. Também verifica que o login não herda privilégios antes do `SET ROLE`, que a role final não possui `BYPASSRLS` e que o runtime não participa da cadeia.

Esse teste prova a semântica PostgreSQL da membership no container descartável. **Não prova** que a membership está aplicada no Neon, que a credencial Neon autentica, nem que a migration pode ser executada lá.

## Decisão arquitetural pendente

A cadeia transitiva concede ao migrator capacidade de assumir temporariamente a role proprietária do schema. Isso é apropriado somente se a migration for tratada como código privilegiado, revisado, checksum-verificado e executado por um operador/runner dedicado. A alternativa é redesenhar ownership e migration para que `iam_migrator` seja o proprietário efetivo, removendo a necessidade de assumir `iam_owner`; essa alternativa exigiria revisão da migration 0001 e dos contratos de ownership.

Não aplicar qualquer GRANT em Production, Development ou Preview até revisão humana e autorização explícita separada.
