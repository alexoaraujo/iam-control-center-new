import { redirect } from "next/navigation";
import { auth0 } from "../../lib/auth0";

export const dynamic = "force-dynamic";

export default async function ProtectedPage() {
  const session = await auth0.getSession();

  if (!session) {
    redirect("/auth/login?returnTo=%2Fprotected");
  }

  return (
    <main data-testid="protected-page" style={{ maxWidth: 960, margin: "64px auto", padding: 24 }}>
      <h1>Área protegida</h1>
      <p data-testid="authenticated-state">Sessão autenticada.</p>
    </main>
  );
}
