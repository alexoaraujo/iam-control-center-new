// IAM-008: read-only, fail-closed assertions for a temporary Vercel callback
// alias lease. Does not authorize approval or mutate Vercel/Auth0/Neon.
const PROJECT = "prj_OnuwD1iarOsXh6FFGkSpK4A5mj80";
const REPO = "alexoaraujo/iam-control-center-new";
const CALLBACK = "iam-control-center-new-ci-preview.vercel.app";
const BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REQUIRED_VARIABLES = ["APP_BASE_URL", "DATABASE_URL", "AUTHZ_CONTEXT_SIGNING_KEY_HEX"];

function stop(code) {
  throw new Error(code);
}
function validRef(ref) {
  return typeof ref?.branch === "string" && BRANCH_PATTERN.test(ref.branch) &&
    !/[\r\n]/.test(ref.branch) && SHA_PATTERN.test(ref.sha ?? "") &&
    ref.repo === REPO && /^[a-zA-Z0-9-]+\.vercel\.app$/.test(ref.previewHost ?? "") &&
    typeof ref.deploymentId === "string" &&
    /^dpl_[a-zA-Z0-9]+$/.test(ref.deploymentId);
}
function verifyDeployment(deployment, ref) {
  const metadata = deployment?.meta ?? {};
  if (!validRef(ref) || deployment?.id !== ref.deploymentId ||
      deployment?.readyState !== "READY" ||
      deployment?.project?.id !== PROJECT ||
      metadata.githubCommitRef !== ref.branch ||
      metadata.githubCommitSha !== ref.sha ||
      metadata.githubOrg !== "alexoaraujo" ||
      metadata.githubRepo !== "iam-control-center-new" ||
      (deployment?.url !== ref.previewHost &&
       !deployment?.alias?.includes(ref.previewHost))) {
    stop("BLOCKED_PREVIEW_LEASE_EXACT_DEPLOYMENT");
  }
}
function verifyScopedVariableNames(variables, branch) {
  // This checks metadata only, never secret values or access grants.
  if (!Array.isArray(variables)) stop("BLOCKED_PREVIEW_LEASE_SCOPED_VARIABLES");
  const scoped = new Set(variables
    .filter(item => item?.gitBranch === branch && Array.isArray(item.target) &&
      item.target.includes("preview"))
    .map(item => item.key));
  for (const key of REQUIRED_VARIABLES) {
    if (!scoped.has(key)) stop("BLOCKED_PREVIEW_LEASE_SCOPED_VARIABLES");
  }
}
export function verifyLeaseSnapshot(snapshot) {
  const { phase, source, target, sourceDeployment, targetDeployment,
    domain, alias, targetPreviewVariables } = snapshot ?? {};
  if (!["before", "leased", "rollback"].includes(phase)) {
    stop("BLOCKED_PREVIEW_LEASE_PHASE");
  }
  if (!validRef(source) || !validRef(target) ||
      source.branch === target.branch || source.sha === target.sha) {
    stop("BLOCKED_PREVIEW_LEASE_REFERENCES");
  }
  verifyDeployment(sourceDeployment, source);
  verifyDeployment(targetDeployment, target);
  if (domain?.name !== CALLBACK || domain?.projectId !== PROJECT ||
      domain?.verified !== true || alias?.alias !== CALLBACK ||
      alias?.projectId !== PROJECT) {
    stop("BLOCKED_PREVIEW_LEASE_PROJECT_DOMAIN");
  }
  if (phase === "before" || phase === "rollback") {
    if (domain.gitBranch !== source.branch ||
        alias.deploymentId !== source.deploymentId) {
      stop("BLOCKED_PREVIEW_LEASE_SOURCE_BINDING");
    }
  } else if (domain.gitBranch !== target.branch ||
             alias.deploymentId !== target.deploymentId) {
    stop("BLOCKED_PREVIEW_LEASE_TARGET_BINDING");
  }

  // A lease must not be declared ready for transfer while its target lacks
  // branch-scoped Preview configuration. This does NOT validate secret values.
  if (phase !== "rollback") {
    verifyScopedVariableNames(targetPreviewVariables, target.branch);
  }
  return {
    state: phase === "leased"
      ? "PASS_PREVIEW_LEASE_TARGET_BINDING_READ_ONLY"
      : phase === "rollback"
        ? "PASS_PREVIEW_LEASE_ROLLBACK_BINDING_READ_ONLY"
        : "PASS_PREVIEW_LEASE_PRECONDITIONS_READ_ONLY",
    operationalApproval: "NOT_ATTESTED",
    dataSourceAndRls: "NOT_ATTESTED",
    auth0LoginAndGrantRevoke: "NOT_TESTED",
  };
}
