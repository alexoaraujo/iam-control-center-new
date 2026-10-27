export default function HomePage() {
  return (
    <main style={{ maxWidth: 960, margin: "64px auto", padding: 24 }}>
      <p style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#52616b" }}>
        Identity · Access · Governance
      </p>
      <h1 style={{ fontSize: 42, lineHeight: 1.1 }}>IAM Control Center</h1>
      <p style={{ fontSize: 18, maxWidth: 680, lineHeight: 1.6 }}>
        Base inicial de uma plataforma IAM multi-tenant, com segurança e evidências como critérios de entrega.
      </p>
      <section style={{ marginTop: 32, background: "#fff", border: "1px solid #dfe4e8", borderRadius: 12, padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Autenticação</h2>
        <p>O fluxo de login é fornecido pelo SDK Auth0 v4. A conclusão do fluxo depende das variáveis de ambiente e das URLs permitidas no tenant.</p>
        <p style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <a href="/auth/login">Entrar com Auth0</a>
          <a href="/auth/logout">Sair</a>
        </p>
        <h2>Estado do projeto</h2>
        <ul style={{ lineHeight: 1.9 }}>
          <li>SDK Auth0 v4 e middleware registrados.</li>
          <li>Login/callback/logout ainda precisam de teste E2E real.</li>
          <li>Não considerar o scaffold pronto para produção.</li>
        </ul>
      </section>
    </main>
  );
}
