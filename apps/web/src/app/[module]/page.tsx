import { notFound } from "next/navigation";
import { isDashboardPath } from "../../components/dashboard/presentation";
import Dashboard from "../dashboard";

export default async function ModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const path = `/${module}`;
  if (!isDashboardPath(path) || path === "/") notFound();
  return <Dashboard path={path} />;
}
