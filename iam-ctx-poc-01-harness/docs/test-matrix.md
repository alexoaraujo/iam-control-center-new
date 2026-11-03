# SEC-01..SEC-16 — matriz inicial

| ID | Controle | Implementação nesta fixture | Limite |
|---|---|---|---|
| SEC-01 | Sem contexto | RLS nega linhas | Local apenas |
| SEC-02 | GUC adulterado | `app.tenant_id` isolado é ignorado | Não prova resistência a SQL arbitrário |
| SEC-03 | Token inválido | Lookup fixture desconhecido | Sem assinatura criptográfica |
| SEC-04 | Expiração | `expires_at` fixture | Sem política real de relógio/chaves |
| SEC-05 | Token malformado | Token sem registro nega | Sanitização de erros deve ser revista |
| SEC-06 | Identidade desconhecida | Deny-by-default, sem bootstrap | Regra de bootstrap ainda precisa ADR |
| SEC-07 | Cross-tenant | RLS por tenant | Local apenas |
| SEC-08 | Membership revogado | Verificação em cada statement | Concorrência/isolation precisa ampliar |
| SEC-09 | Tenant suspenso | Verificação em cada statement | Local apenas |
| SEC-10 | Segredo inacessível | Runtime sem SELECT no registry | Não é teste de gestão de chave real |
| SEC-11 | Identidade imutável | Grant de coluna | Revisar INSERT/UPDATE completos |
| SEC-12 | Função privilegiada | Sem função/grant não aprovado | Não valida desenho final SECURITY DEFINER |
| SEC-13 | Revogação na escrita | Função verifica membership/permissão no write path | Concorrência/revogação simultânea exige teste dedicado |
| SEC-14 | Contexto transacional | `set_config(..., true)` | Testado após COMMIT |
| SEC-15 | Sem membership | Sem contexto válido, zero tenants | Bootstrap real não implementado |
| SEC-16 | Role mínima | `NOSUPERUSER`, `NOBYPASSRLS`, não owner | Repetir com role Neon real |

## Classificação
Nenhum resultado é `PASS local` até a execução do script num PostgreSQL 18 descartável e a preservação do log sanitizado. Todos os itens de compatibilidade com Neon permanecem `BLOCKED Neon`.
