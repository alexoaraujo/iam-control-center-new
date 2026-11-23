# PEOS G2 — aquisição autenticada de evidências (fixture PG18)

Esta etapa testa o coletor por autenticação real de uma role dedicada, em um
serviço PostgreSQL 18 local descartável. Nenhum modo Neon existe. A coleta
usa uma única transação REPEATABLE READ READ ONLY, com identidade da sessão,
versão, isolamento e backend conferidos; usa a query de catálogo já integrada,
e lê somente as cinco colunas do ledger canônico. Ledger ausente é null,
ledger vazio é uma lista vazia; formato clean-proposal e permissões faltantes
bloqueiam. Não há leitura de registros de negócio, assinatura ou autorização.

Os arquivos session.json, schema-manifest.json, ledger.json e index.json
ficam em diretório novo 0700 e arquivos 0600, com hashes dos bytes originais.
Nunca publicar manifest/ledger ou credenciais nos logs, PRs ou artefatos
públicos. Os testes usam dados sintéticos e removem o diretório e a role.
A conexão local não usa TLS porque é uma fixture; não extrapolar isso a Neon.

## Readback real (23/11/2026)

Consulta administrativa somente leitura em iam_database, PG18.7, branch SQL
conferida, projeto tiny-rice-70320263:
- Development br-ancient-term-b6mmx5ol: iam_schema_export_reader LOGIN,
  NOINHERIT/NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE/NOCREATEDB/NOREPLICATION,
  CONNECT sim, CREATE não; USAGE em iam e SELECT no ledger ausentes.
  Ledger existe. Não é uma prova de sessão autenticada do leitor.
- Production br-muddy-snow-b63cepcv: leitor e ledger ausentes.

Não conceder privilégios automaticamente. O futuro contrato live requer
aprovação independente de role/grants mínimos por branch, identidade real
e control-plane, conexão direta TLS verify-full, revisão de cobertura do
manifest, commit exato, custódia protegida e saída privada. Nenhuma senha ou
chave de assinatura compartilhada com o coletor. Coletor e revisor devem
assinar separadamente bytes do pacote validado por PR #176, com trust roots
aprovadas e recuperação/lease verificadas independentemente. O coletor fixture
não produz evidência aceitável como aquisição de Development/Production.

Production, G3, execução de migrations, ledger backfill e nova lease HOLD.
