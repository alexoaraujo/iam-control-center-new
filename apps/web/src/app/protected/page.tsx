import { redirect } from "next/navigation";

import { auth0 } from "../../lib/auth0";

export default async function ProtectedPage() {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/login?returnTo=%2Fprotected");
  }

  return (
    <main style={{ maxWidth: 960, margin: "64px auto", padding: 24 }}>
      <h1>Área protegida</h1>
      <p role="status">Acesso autenticado confirmado.</p>
      <p>Esta rota valida exclusivamente a existência de uma sessão Auth0.</p>
    </main>
  );
}
