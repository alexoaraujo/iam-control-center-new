import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("normative PEOS policy allows one maintainer without second-human approval", () => {
  const policy = read("docs/operations/peos-single-maintainer-governance.md");
  assert.match(policy, /não há aprovação humana independente/);
  assert.match(policy, /operator=alexoaraujo/);
  assert.match(policy, /decision=APPROVED_BY_MAINTAINER/);
  assert.match(policy, /target_sha=<40 lowercase hex>/);
  assert.match(policy, /quality/);
  assert.match(policy, /security-gate/);
  assert.match(policy, /rollback/);
  assert.match(policy, /não é causa de bloqueio/);
});

test("canonical setup enforces owner, branch and no required reviewers", () => {
  const source = read(".github/scripts/configure-iam-canonical-environment.py");
  assert.match(source, /MAINTAINER = "alexoaraujo"/);
  assert.match(source, /permissions\.get\("permission"\) != "admin"/);
  assert.match(source, /"reviewers": \[\]/);
  assert.match(source, /"can_admins_bypass": False/);
  assert.match(source, /mandatory independent reviewer still configured/);
  assert.match(source, /"main", "branch"/);
  assert.doesNotMatch(source, /REVIEWER =/);
  assert.match(source, /--verify-only/);
  assert.match(source, /historical provisioning disabled/);
  assert.doesNotMatch(source, /getpass\.getpass/);
});

test("G1 revoker retains technical safeguards without extra human approval", () => {
  const workflow = read(".github/workflows/iam-g1-disposable-emergency-revoke.yml");
  const bootstrap = read(".github/scripts/iam-g1-disposable-environment-bootstrap.py");
  const runner = read(".github/scripts/iam-g1-disposable-emergency-revoke.py");
  assert.match(workflow, /BLOCKED_G1_REVOKER_MAINTAINER_SHA_NOT_RECORDED/);
  assert.match(workflow, /PASS_G1_ENV_SINGLE_MAINTAINER_MAIN_ONLY/);
  assert.match(workflow, /\.can_admins_bypass == false/);
  assert.match(workflow, /\[\.protection_rules\[\]\? \| select\(\.type == "required_reviewers"\)\] \| length == 0/);
  assert.match(workflow, /'2026-11-16T12:00:00Z'/); // TTL stays expired
  assert.match(workflow, /IAM_G1_DISPOSABLE_REVOKER_APPROVED_SHA/);
  assert.match(workflow, /IAM_G1_DISPOSABLE_REVOKER_URL/);
  assert.match(bootstrap, /"reviewers": \[\]/);
  assert.match(bootstrap, /"can_admins_bypass": False/);
  assert.match(bootstrap, /"prevent_self_review": False/);
  assert.match(bootstrap, /G1_DISPOSABLE_BRANCH_TTL_EXPIRED/);
  assert.match(runner, /REVOKE MAINTAIN/);
  assert.match(runner, /COMMIT;/);
  assert.match(runner, /MAINTAINER_REVOKE_CONFIRMATION_MISSING/);
});

test("main required gate is never downgraded by single-maintainer governance", () => {
  const ci = read(".github/workflows/quality.yml");
  const gate = read("scripts/release-security-gate.mjs");
  assert.match(ci, /security-gate:/);
  assert.match(ci, /auth0-e2e/);
  assert.match(ci, /sync-auth0-preview/);
  assert.match(ci, /pnpm audit/);
  assert.match(gate, /AUTH0_E2E_NOT_SUCCESS/);
});
