import Link from "next/link";
import { auth0 } from "../lib/auth0";

export default async function HomePage() {
  const session = await auth0.getSession();

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
        <h2 style={{ marginTop: 0 }}>Sessão Auth0</h2>
        {session?.user ? (
          <>
            <p>Autenticado como: {session.user.email ?? session.user.sub}</p>
            <p><Link href="/auth/profile">Consultar perfil retornado pelo SDK</Link></p>
            <p><Link href="/auth/logout">Encerrar sessão</Link></p>
          </>
        ) : (
          <>
            <p>Nenhuma sessão ativa.</p>
            <p><Link href="/auth/login">Entrar com Auth0</Link></p>
            <p><Link href="/auth/login?screen_hint=signup">Criar conta</Link></p>
          </>
        )}
        <p style={{ marginTop: 24, fontSize: 14, lineHeight: 1.6 }}>
          A autenticação não substitui a autorização por tenant, membership e permissões. A persistência e os controles de acesso ainda precisam ser implementados e validados.
        </p>
      </section>
    </main>
  );
}
