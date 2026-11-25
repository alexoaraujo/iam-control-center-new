# PEOS G2 — executor protegido de aquisição Development (staged)
 
Dependência: PR #179. Não integrar antes do merge e dos checks da PR anterior.
Estado: `activation_authorized=false`. O CLI expõe somente `--check`;
as funções de aquisição/atestado/cifragem são candidatos para revisão e
testes, não workflow live habilitado. A próxima PR deverá habilitar somente
após aprovação de SHA, privilégios, custódia, proteção e teste real em clone.
 
## Escopo e desenho implementado
 
- Target fixo tiny-rice-70320263 / br-ancient-term-b6mmx5ol /
  ep-winter-leaf-b6cp8d2c / iam_database / iam_schema_export_reader.
  Endpoint confirmado por readback do control plane em 24/11/2026 UTC;
  direto, sem pooler, não desabilitado. Sem URL livre, sem Production.
- Função de atestado por GET HTTPS fixo do endpoint Neon, sem redirects,
  valida project/branch/host/id/pooler. Só usar credencial de control plane
  separadamente aprovada e restrita; não reutilizar NEON_API_KEY de administração.
- Sessão read-only repeatable read, TLS verify-full com CA do sistema,
  channel binding require, sem libpq service ou parâmetros herdados.
  Confirma identidade SQL, branch, PG18, ACLs efetivas e ledger presente,
  valida snapshot e mantém bytes originais. SHA válido não comprova história.
- Cifragem CMS AES-256-GCM com chave RSA >=3072 e OAEP SHA256; certificado
  público com fingerprint pinado. Só ciphertext vai para disco 0600; chave
  privada de recuperação fora de CI. O repositório é público: proibido
  publicar catálogo, ledger, dumps ou chaves em plaintext. Aprovar também
  o destino privado ou a publicação de ciphertext antes da ativação.
- Não há assinatura no coletor. Após recuperação privada, construir pacote
  PR #176, reconciliar duas capturas e verificar backup/restore e lease.
  Coletor e revisor assinam os mesmos bytes Ed25519 separadamente em
  dispositivos/custódias distintos; trust roots aprovadas por fingerprint
  SPKI DER; chave privada nunca em Git, Vercel, Neon ou Environment de coleta.
 
## Workflow protegido futuro (não habilitado nesta PR)
 
1. Pré-validação sem secrets: conferir main atual, checkout SHA exato,
   workflow_dispatch, gates completos, Environments existentes e branch
   policy exclusiva refs/heads/main, reviewer independente, prevent self-review,
   sem admin bypass. Não deixar Actions autocriar Environment sem proteção.
2. Environment IAM-G2-Neon-Endpoint-Attestation: token exclusivamente aprovado
   de leitura do control plane; devolver apenas tupla fixa e SHA, expirar após
   uso. Não executar código de PR com secrets.
3. Environment IAM-G2-Development-Evidence-Acquisition: variável
   IAM_G2_APPROVED_SHA, IAM_G2_RECIPIENT_CERT_SHA256 e certificado público
   validado; secret IAM_G2_READER_PASSWORD apenas neste job. Revalidar main
   e attestation antes da conexão. Nenhuma chave Ed25519 neste job.
4. Após revisão de ACL de clear_tenant_context() e testes em clone aprovado,
   avaliar grants mínimos CONNECT, USAGE iam e SELECT ledger exclusivamente.
   Development reader ainda sem autenticação comprovada, USAGE e SELECT;
   nenhum grant é autorizado por esta PR.
5. Validar criptografia, saída privada, logs redigidos, limpeza, expiração e
   aprovação de custódia. Nova PR para ativar a policy e entrypoint live.
 
A rotina não cria baseline, não faz backfill, não executa migrations, não
concede grants, não cria lease. Production e G3 HOLD.
