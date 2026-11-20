# IAM — gate de paridade da ACL de exportação: efetiva versus catálogo exato

**Escopo:** verificação somente leitura de catálogos PostgreSQL 18 no projeto `tiny-rice-70320263`. Este contrato **não autoriza** GRANT, REVOKE, DDL, restauração ou cutover.

## Evidência observada em 13/11/2026

A origem permitida é `development/br-ancient-term-b6mmx5ol`; o clone de ensaio é `validation/iam-export-lease-rehearsal-20261113/br-spring-grass-b6gap6kp`. Banco em ambas: `iam_database`. Os IDs de projeto/branch foram verificados separadamente por Neon; o SQL **não prova** identidade de branch por si só.

Consultas SQL de catálogo independentes retornaram **23 tabelas** (iam=20, audit=2, app_private=1) em cada branch. Todas as 23 tabelas possuem proprietários iguais e ACLs **normalizadas** equivalentes: ao expandir `coalesce(relacl, acldefault('r',relowner))` com `aclexplode`, os grants efetivos são idênticos. As comparações foram por nomes das roles, não OIDs.

**Diferença literal confirmada:** `app_private.context_keys`:
- SOURCE `relacl=NULL`
- CLONE `relacl={iam_owner=arwdDxtm/iam_owner}`

Nenhuma outra ACL bruta das 23 tabelas divergiu. Não houve acesso a linhas da aplicação para obter a evidência.

## Dois vereditos separados

- **PASS — paridade efetiva de ACL de tabelas para esta amostra**, sem alteração de owner e sem grant adicional. A única diferença bruta admitida no modo `--gate effective` é a representação documentada acima.
- **BLOCKED — paridade exata de catálogo**, pois `NULL` é diferente de ACL materializada. O modo padrão `--gate exact` termina com erro quando houver essa diferença. Um PASS efetivo não pode ser reutilizado como evidência de restauração exata, schema completo, políticas, funções, dados, ledger ou backup/PITR.
- **BLOCKED — kill-switch operacional temporizado:** a PR #66 integra um revogador manual; a proteção do GitHub Environment e o funcionamento do fluxo com libpq/TLS/credenciais ainda não foram comprovados. A validação anterior de GRANT COMMIT / REVOKE COMMIT em clone foi conduzida via conector Neon, não pelo workflow de emergência.

## Reprodução e segurança

`database/scripts/iam-export-acl-manifest-readonly.sql` devolve somente nomes de schemas/relações/proprietários e ACLs, sem ler dados. Execute-o **separadamente** nas duas conexões Direct corretas, guardando os manifests em local privado e verificando os branch IDs no plano de controle.

```bash
python3 database/scripts/compare-iam-export-acl-manifests.py source.json clone.json --gate effective
python3 database/scripts/compare-iam-export-acl-manifests.py source.json clone.json --gate exact
```

O primeiro comando só aceita 23 relações na distribuição aprovada, mesmo owner, mesmo conjunto de privilégios efetivos e exclusivamente a diferença implícita→owner-default em `app_private.context_keys`. O segundo deve retornar `BLOCKED` enquanto a ACL literal divergir. Não enviar manifests reais ao repositório nem logs públicos.

**Próxima revisão independente:** conferir o SHA do PR, os testes do guard e evidências Neon read-only; avaliar política de equivalência sem apagar a anomalia do catálogo. Proibido editar `pg_catalog` diretamente ou resetar o clone sem aprovação operacional específica. O clone expira em 2026-11-16T12:00Z.

**Referências:** Issue #15, PR #65 e PR #66. Production, Auth0, Vercel e Development permanecem sem mutações nesta etapa.
