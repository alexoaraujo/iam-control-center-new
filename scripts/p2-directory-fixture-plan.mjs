// Offline-only validation of sanitized provider readback; never authorizes or executes SQL.
// The caller must authenticate provider evidence independently. Input booleans are not attestations.
export const P2_PROJECT = "tiny-rice-70320263";
export const P2_PARENT = "br-muddy-bar-b63ksdy7";
export const P2_HOST = "iam-control-center-new-p2-directory-ci.vercel.app";
export const P2_BRANCH = "feat/peos-p2-tenant-directory-20261125";
const reserved = new Set(["br-muddy-snow-b63cepcv","br-ancient-term-b6mmx5ol","br-floral-glitter-b6zvytjp","br-solitary-sunset-b681d15f","br-calm-forest-b6a1jpzs",P2_PARENT,"br-nameless-hat-b6j2p4m4","br-plain-cell-b68uorki"]);
const exactSha = /^[a-f0-9]{40}$/;
const branchId = /^br-[a-z0-9-]{3,100}$/;
export function validateP2FixturePlan(plan, now = Date.now()) {
  const block = reason => { throw new Error("BLOCKED_P2_" + reason); };
  if (!plan || plan.project !== P2_PROJECT || plan.pgVersion !== 18 || plan.plan !== "free" || plan.parent !== P2_PARENT ||
      !branchId.test(plan.branch ?? "") || reserved.has(plan.branch) || plan.branchName !== "validation/peos-p2-pr197-directory" ||
      plan.database !== "iam_database" || plan.default !== false || plan.protected !== false) block("TARGET");
  if (plan.pr !== 197 || plan.previewHost !== P2_HOST || plan.gitBranch !== P2_BRANCH ||
      !exactSha.test(plan.headSha ?? "") || plan.approvedSha !== plan.headSha || plan.deploymentSha !== plan.headSha) block("SHA");
  const start = Date.parse(plan.startAt ?? ""), end = Date.parse(plan.expiresAt ?? ""), providerEnd = Date.parse(plan.providerExpiresAt ?? "");
  if (![now,start,end,providerEnd].every(Number.isFinite) || start > now || end - start > 7200000 ||
      end - now < 900000 || providerEnd < end || providerEnd - now > 86400000) block("LEASE");
  if (!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(plan.endpointHost ?? "") ||
      plan.endpointHost.includes("-pooler") || plan.endpointBranch !== plan.branch ||
      plan.tlsMode !== "verify-full" || plan.rootCert !== "system" ||
      plan.runtimeRole !== "iam_app_runtime_login" || plan.operatorRole !== "neondb_owner") block("ENDPOINT");
  return "PASS_P2_FIXTURE_PLAN_OFFLINE_ONLY";
}
