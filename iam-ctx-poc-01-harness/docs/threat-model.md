# Threat model — IAM tenant context (draft)

## Ativos
- Identidade federada Auth0 (`iss`, `sub`)
- Tenant, membership e permissões
- Dados isolados por tenant
- Segredos/chaves de validação
- Integridade do audit log

## Limites de confiança
- Browser/cliente: não confiável
- Claims enviadas pelo cliente: não confiáveis
- Servidor Next.js após validar OIDC: componente confiável, sujeito a comprometimento
- Role PostgreSQL runtime: não administrativa; pode executar SQL permitido
- Role owner/migration: separada e fora do runtime
- Banco compartilhado Neon: fora do escopo do teste local

## Ameaças cobertas parcialmente
- Contexto ausente ou tenant GUC adulterado
- Token fixture inexistente/expirado
- Cross-tenant read
- Membership revogado/tenant suspenso
- Tentativa de alterar `issuer`/`subject`
- Tentativa de ler tabela fixture privada
- Uso de função sem grant
- Contexto local que vaza além da transação

## Ameaças não provadas
- Falsificação criptográfica ou comprometimento do servidor
- Roubo/replay de contexto
- SQL injection arbitrário com contexto válido
- Corrida de revogação sob isolamento concorrente
- Bypass via owner, superuser, `BYPASSRLS`, replicação ou extensões
- Compatibilidade específica de Neon
- Segurança de `SECURITY DEFINER` em desenho de produção
