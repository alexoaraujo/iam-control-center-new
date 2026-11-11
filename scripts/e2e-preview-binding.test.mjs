import assert from "node:assert/strict";
import { test } from "node:test";
import { derivePreviewBinding } from "./e2e-preview-binding.mjs";

const env = {
  GITHUB_REPOSITORY: "alexoaraujo/iam-control-center-new",
  PR_HEAD_REPOSITORY: "alexoaraujo/iam-control-center-new",
  PR_HEAD_BRANCH: "feat/auth0-neon-identity-sync-20261111",
  E2E_DEPLOYMENT_HOST: "iam-control-center-new-git-feat-auth0-neon-xyz-aoa4.vercel.app",
};
test("automatically selects the current PR branch and exact-SHA Preview callback", () => {
  assert.deepEqual(derivePreviewBinding(env), {
    E2E_CALLBACK_BRANCH: env.PR_HEAD_BRANCH,
    E2E_CALLBACK_HOST: env.E2E_DEPLOYMENT_HOST,
    E2E_DEPLOYMENT_URL: `https://${env.E2E_DEPLOYMENT_HOST}`,
    E2E_BASE_URL: `https://${env.E2E_DEPLOYMENT_HOST}`,
  });
});
test("rejects forks, invalid Preview hosts and newline injection", () => {
  for (const change of [
    { PR_HEAD_REPOSITORY: "attacker/fork" },
    { PR_HEAD_BRANCH: "main\nE2E_CALLBACK_HOST=evil.test" },
    { E2E_DEPLOYMENT_HOST: "some-other-project.vercel.app" },
    { E2E_DEPLOYMENT_HOST: "iam-control-center-new-foo.vercel.app.evil.test" },
    { E2E_DEPLOYMENT_HOST: "" },
  ]) assert.throws(() => derivePreviewBinding({ ...env, ...change }));
});
test("does not reuse stale callback variables from another PR", () => {
  const binding = derivePreviewBinding({
    ...env,
    E2E_CALLBACK_BRANCH: "old-branch",
    E2E_CALLBACK_HOST: "iam-control-center-new-old.vercel.app",
  });
  assert.equal(binding.E2E_CALLBACK_BRANCH, env.PR_HEAD_BRANCH);
  assert.equal(binding.E2E_CALLBACK_HOST, env.E2E_DEPLOYMENT_HOST);
});
