import Link from "next/link";
import { auth0 } from "../lib/auth0";
import { getPublicRuntimeStatus } from "../lib/env";

export default async function HomePage() {
  const session = await auth0.getSession();
  const runtimeStatus = getPublicRuntimeStatus();
  const userLabel =
    session?.user?.name ?? session?.user?.email ?? "Usuário autenticado";

  return (
    <main style={{ maxWidth: 960, margin: "64px auto", padding: 24 }}>
      <p
        style={{
          fontSize: 12,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "#52616b",
        }}
      >
        Identity · Access · Governance
      </p>
      <h1 style={{ fontSize: 42, lineHeight: 1.1 }}>IAM Control Center</h1>
      <p style={{ fontSize: 18, maxWidth: 680, lineHeight: 1.6 }}>
        Base inicial de uma plataforma IAM multi-tenant, com segurança e
        evidências como critérios de entrega.
      </p>

      <section
        style={{
          marginTop: 32,
          background: "#fff",
          border: "1px solid #dfe4e8",
          borderRadius: 12,
          padding: 24,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Autenticação</h2>
        {session ? (
          <>
            <p role="status">Sessão Auth0 ativa para {userLabel}.</p>
            <p>
              <Link href="/auth/logout">Sair</Link>
            </p>
          </>
        ) : (
          <>
            <p>Você não está autenticado nesta sessão.</p>
            <p>
              <Link href="/auth/login">Entrar com Auth0</Link>
            </p>
          </>
        )}

        <h2>Configuração do ambiente</h2>
        <ul style={{ lineHeight: 1.9 }}>
          <li>
            Auth0:{" "}
            {runtimeStatus.authConfigured
              ? "variáveis necessárias presentes"
              : "não configurado"}.
          </li>
          <li>
            Banco de dados:{" "}
            {runtimeStatus.databaseConfigured
              ? "variável de conexão presente"
              : "não configurado"}.
          </li>
        </ul>

        <h2>Limites de validação</h2>
        <ul style={{ lineHeight: 1.9 }}>
          <li>
            O SDK oficial Auth0 está registrado no servidor; a presença de
            variáveis não comprova autenticação ponta a ponta.
          </li>
          <li>
            Login, callback, sessão e logout reais ainda precisam ser
            verificados no Preview com um tenant Auth0 configurado.
          </li>
          <li>
            Autorização por tenant, membership e permissões não está
            comprovada nesta etapa.
          </li>
          <li>
            Persistência PostgreSQL, isolamento por tenant e RLS não estão
            implementados ou validados por esta página.
          </li>
          <li>
            Esta etapa não autoriza promoção para Production.
          </li>
        </ul>
      </section>
    </main>
  );
}
