# G2 — preflight protegido de Environments
Dependência #181. Apenas metadata, sem aquisição. Não criar ambientes automaticamente.
O workflow PR executa somente fixtures sintéticas sem credenciais externas.
A consulta real é workflow_dispatch em refs/heads/main, checkout SHA exato,
main antes/depois, token Actions com contents/actions read, GET fixo sem redirects.
Nenhum job referencia um Environment, logo não libera seus secrets.
Se a API negar leitura de inventário de secrets/vars/policies, HOLD;
não substituir por PAT administrativo em código de PR nem relaxar proteção.
 
## Contrato
Ambos: branch policy exclusiva main (sem tags/wildcards), reviewer
alexoaraujo83 obrigatório, prevent self-review, admin bypass false,
sem custom rules não revisadas. IDs distintos. Repositório pessoal;
se virar organização, contrato precisa de revisão de herança.
 
| Environment | Secret exclusivo | Variáveis não secretas |
|---|---|---|
| IAM-G2-Neon-Endpoint-Attestation | IAM_G2_NEON_ENDPOINT_READ_TOKEN | IAM_G2_APPROVED_SHA |
| IAM-G2-Development-Evidence-Acquisition | IAM_G2_READER_PASSWORD | IAM_G2_APPROVED_SHA, IAM_G2_RECIPIENT_CERT_SHA256 |
 
Não usar NEON_API_KEY administrativa, owner URL, G1 AES, HMAC G3,
chaves Ed25519 privadas ou RSA privada nesses ambientes. Nenhuma credencial
G2 no escopo de repositório. Não registrar valores de secrets ou variáveis
não relacionadas em logs. O pin do certificado é SHA256 hex minúsculo.
 
PASS_METADATA_ONLY não prova valor, escopo real da credencial no provedor,
posse de chave, autorização operacional, paridade, backup/restore ou lease.
A policy de aquisição segue activation_authorized=false.
O futuro executor deverá revalidar o SHA, as proteções e os escopos
antes de cada uso, ter controle de corrida e exigir aprovações independentes
por job. Não habilitar por esta PR. Nenhum G3/Production autorizado.
