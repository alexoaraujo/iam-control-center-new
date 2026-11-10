import { redirect } from "next/navigation";
import { auth0 } from "./auth0";

export async function requireSession(returnTo: "/" | "/protected") {
  const session = await auth0.getSession();
  if (!session) redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  return session;
}
