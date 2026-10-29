import { auth0 } from "../lib/auth0";
import { getPublicRuntimeStatus } from "../lib/env";
import Dashboard from "./dashboard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await auth0.getSession();
  const runtimeStatus = getPublicRuntimeStatus();
  const userLabel =
    session?.user?.name ?? session?.user?.email ?? "Usuário autenticado";

  return (
    <Dashboard
      userLabel={userLabel}
      authenticated={Boolean(session)}
      authConfigured={runtimeStatus.authConfigured}
      databaseConfigured={runtimeStatus.databaseConfigured}
    />
  );
}
