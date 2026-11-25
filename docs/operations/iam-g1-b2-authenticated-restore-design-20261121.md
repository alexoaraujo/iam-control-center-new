# PEOS G1 — contrato de autenticação AES-GCM antes da restauração (21/11/2026)

## Status: OFFLINE SYNTHETIC PASS REQUIRED; REAL RESTORE NOT ATTESTED

Esta mudança **não** baixa o arquivo real do B2, não usa `IAM_G1_AES256_GCM_KEY_B64`,
não grava plaintext, não acessa Neon e não oferece uma CLI de `pg_restore`.
O propósito é validar, com fixtures públicas e credenciais inexistentes, o contrato
criptográfico do formato criado pelo writer revisado.

### Proveniência imutável

- **Origem G1 Development (NÃO Production)**: `tiny-rice-70320263`, `br-ancient-term-b6mmx5ol`, `iam_database`.
- **Writer do backup real**: `0ee3e512bb761ce4d81202eb77a48a1ef9c77109`, run `44655204795`.
- **Objeto**: `iam-g1/full-backups/0ee3e512bb761ce4d81202eb77a48a1ef9c77109/20261120T014019Z-44655204795.pgdump.aesgcm`.
- **SHA256 ciphertext**: `610d5f0ef74ec77ebe35912207856d2a4638cab462a6f9e39d9c472382083aa9`.
- **Tamanho**: `110953` bytes.
- **Leitura independente read-only**: workflow `44964345287`, SHA `331febfb9e480dfb85c013f4c8870f36d10a2239`, SUCCESS.

### Envelope e negações (somente fixtures sintéticas)

O writer usa bytes `IAMG1A1!` (8), nonce aleatório AES-GCM (12),
ciphertext AES-256-GCM, tag (16) e AAD = `IAMG1A1!` + SHA ASCII
de 40 caracteres do writer. O verificador primeiro aplica limites de tamanho,
compara SHA256 ciphertext e só libera bytes de memória **depois** de
`AESGCM.decrypt` autenticar a tag. Exige a assinatura `PGDMP`.
Testes negativos cobrem tag modificada, AAD SHA incorreto, chave errada,
digest falsificado, magic, comprimento, limite e manifesto divergentes.
A memória fica limitada a 64 MiB neste contrato; um runner operacional
para arquivos maiores exigirá implementação diferente e revisão específica.

### Bloqueios para a futura recuperação real

1. O clone `br-sweet-union-b6j80a7j` expira em **22/11/2026 09:12 UTC**;
   a janela de segurança de 24h já é insuficiente. **Não** remover
   `MIN_TARGET_HEADROOM`, nem reaproveitar a URL/host antigos por tentativa.
2. O Neon Free contém **9 branches** no projeto de origem. Alocar no
   máximo uma branch descartável adicional, somente após validação da cota
   e aprovação do escopo. Criar database de recuperação distinto e vazio
   na branch descartável aprovada; nunca escrever no database herdado.
3. Custódia segregada da chave de descriptografia: usar apenas segredo do
   Environment protegido `main`, com prova do escrow privado anterior.
   **Nunca** copiar o AES de volta para issues, PRs, logs ou runner artifacts.
4. Nova implementação operacional: cópia do ciphertext em canal restrito,
   SHA256/size/metadados e S3 Native capabilities comprovadas, AES-GCM
   autenticado **antes** de qualquer DDL, validação `pg_restore --list`
   com dados, e `pg_restore --single-transaction --exit-on-error` em
   database vazio e exclusivo sob PostgreSQL 18 e TLS verify-full.
5. Provar schema, extension pgcrypto, tabelas (23), FORCE RLS (20), policies
   (41), ACLs/owners, memberships, ledger, deny-by-default, cleanup pós-commit,
   capacidade de rollback e zero resíduos. A restauração não inclui
   automaticamente roles globais do cluster; exigir reconciliação explícita.
6. Verificação separada para Production real: Vercel usa fingerprint
   `8715cdceeb5370d814869cca`, correspondente à branch
   `twilight-fire-88497009 / br-little-fire-b6adup9f`.
   O backup G1 de Development **NÃO** é backup de Production.

### Teste de CI

`python3 .github/tests/test-iam-g1-archive-authentication.py -v`

O workflow `iam-g1-full-recovery-contract.yml` executa apenas testes
offline com pacote `cryptography`, sem secrets, sem B2, sem SQL e sem DDL.
Só registrar `PASS_G1_AES_GCM_OFFLINE_SYNTHETIC_AUTHENTICATION`.
Não registrar `PASS_G1_FULL_BACKUP_RESTORE` antes da restauração real.

**Status:** `G1_FULL_CIPHERTEXT_READBACK=PASS`,
`G1_REAL_AES_GCM_DECRYPTION=NOT_ATTESTED`,
`G1_FULL_BACKUP_RESTORE=NOT_ATTESTED`,
`PRODUCTION_CUTOVER=HOLD`. Sem funções pagas.
