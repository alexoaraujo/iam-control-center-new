import React from "react";
import { requireSession } from "../../lib/session";

export default async function ProtectedPage() {
  await requireSession("/protected");

  return (
    <main style={{ maxWidth: 960, margin: "64px auto", padding: 24 }}>
      <h1>Área protegida</h1>
      <p role="status">Acesso autenticado confirmado.</p>
      <p>Esta rota valida exclusivamente a existência de uma sessão Auth0.</p>
    </main>
  );
}
