/**
 * Read-only, public GitHub metadata for release visibility.
 * This is NOT a release authorization or proof of a Production deployment.
 * Never use a browser token or expose GitHub credentials to the dashboard.
 */

const api = "https://api.github.com/repos/alexoaraujo/iam-control-center-new";
type GithubRun = { id?: unknown; name?: unknown; head_sha?: unknown; conclusion?: unknown; status?: unknown; html_url?: unknown; created_at?: unknown };
export type ReleaseSnapshot = {
  source: "github";
  observedAt: string;
  mainSha: string | null;
  ci: "success" | "failure" | "pending" | "unavailable";
  runUrl: string | null;
  openPullRequests: number | null;
  error: boolean;
};

function safeRunUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.origin === "https://github.com" &&
      /^\/alexoaraujo\/iam-control-center-new\/actions\/runs\/\d+$/.test(url.pathname)
      ? url.toString() : null;
  } catch { return null; }
}

export async function getReleaseSnapshot(): Promise<ReleaseSnapshot> {
  const snapshot: ReleaseSnapshot = {
    source: "github", observedAt: new Date().toISOString(),
    mainSha: null, ci: "unavailable", runUrl: null,
    openPullRequests: null, error: true,
  };
  try {
    const request = (path: string) => fetch(`${api}${path}`, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
      signal: AbortSignal.timeout(3500),
    });
    const [runsResponse, prsResponse] = await Promise.all([
      request("/actions/workflows/quality.yml/runs?branch=main&per_page=5"),
      request("/pulls?state=open&per_page=100"),
    ]);
    if (!runsResponse.ok || !prsResponse.ok) return snapshot;
    const [runsData, prsData]: [unknown, unknown] = await Promise.all([
      runsResponse.json(), prsResponse.json(),
    ]);
    if (!runsData || typeof runsData !== "object" || !("workflow_runs" in runsData) ||
      !Array.isArray(runsData.workflow_runs) || !Array.isArray(prsData)) return snapshot;
    const latest = (runsData.workflow_runs as GithubRun[]).find(
      run => run.name === "CI" && typeof run.head_sha === "string",
    );
    if (!latest || typeof latest.head_sha !== "string" || !/^[a-f0-9]{40}$/i.test(latest.head_sha)) return snapshot;
    const ci = latest.status !== "completed" ? "pending" :
      latest.conclusion === "success" ? "success" :
      latest.conclusion === "failure" || latest.conclusion === "cancelled" ? "failure" : "pending";
    return {
      source: "github", observedAt: snapshot.observedAt,
      mainSha: latest.head_sha, ci, runUrl: safeRunUrl(latest.html_url),
      openPullRequests: prsData.length,
      error: false,
    };
  } catch {
    return snapshot;
  }
}
