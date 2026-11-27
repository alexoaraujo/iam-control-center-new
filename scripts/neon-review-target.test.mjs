import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkLease, connectionEnv, target } from "./neon-review-target.mjs";

const env = { NEON_REVIEW_BRANCH_ID: target.branch, NEON_REVIEW_DATABASE: target.database };
const expires = Date.parse(target.expires);
const host = target.endpoint + ".c-2.sa-east-1.aws.neon.tech";
const uri = "postgresql://" + target.login + ":test%3Aonly@" + host +
  ":5432/" + target.database + "?sslmode=verify-full&sslrootcert=system";

test("accepts only the enrolled branch and database before expiry", () => {
  checkLease(env, expires - 1);
  for (const at of [expires, expires + 1, NaN]) assert.throws(() => checkLease(env, at), /expired/);
  for (const branch of ["", "br-ancient-term-b6mmx5ol", "br-muddy-snow-b63cepcv", "br-fancy-bird-b6j7etpp"]) {
    assert.throws(() => checkLease({ ...env, NEON_REVIEW_BRANCH_ID: branch }, expires - 1));
  }
  assert.throws(() => checkLease({ ...env, NEON_REVIEW_DATABASE: "iam_database" }, expires - 1));
});

test("uses only pinned libpq parameters and decodes the password", () => {
  const pg = connectionEnv(uri);
  assert.equal(pg.PGHOST, host);
  assert.equal(pg.PGPASSWORD, "test:only");
  assert.equal(pg.PGSSLMODE, "verify-full");
  assert.equal(pg.PGSSLROOTCERT, "system");
  assert.match(pg.PGOPTIONS, /default_transaction_read_only=on/);
});

test("rejects mismatched credentials and TLS without rendering the URI", () => {
  for (const raw of [undefined, uri.replace(host, "example.invalid"),
    uri.replace(target.endpoint, target.endpoint + "-pooler"), uri.replace("5432", "5433"),
    uri.replace(target.login, "neondb_owner"), uri.replace(target.database, "iam_database"),
    uri.replace("verify-full", "require"), uri.replace("system", "client.crt"),
    uri.replace("test%3Aonly", ""), uri.replace("test%3Aonly", "test%00only"),
    uri + "#fragment", uri + "&host=other", uri + "&sslmode=disable", uri.replace("postgresql:", "https:")]) {
    assert.throws(() => connectionEnv(raw), { message: "Invalid protected review connection." });
  }
});

test("dispatch scopes the secret to verification and checks the dispatched SHA", () => {
  const workflow = readFileSync(new URL("../.github/workflows/neon-review-role-verification.yml", import.meta.url), "utf8");
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: \$\{\{ github.sha \}\}/);
  assert.ok(workflow.indexOf("--preflight") < workflow.indexOf("secrets.NEON_REVIEW_DATABASE_URL"));
  assert.equal(workflow.match(/secrets\.NEON_REVIEW_DATABASE_URL/g)?.length, 1);
  assert.doesNotMatch(workflow, /pull_request_target|br-fancy-bird|ep-curly-shape/);
  const hit = spawnSync(process.execPath, ["scripts/neon-review-target.mjs", "--verify"], {
    env: { ...env, NEON_REVIEW_BRANCH_ID: "wrong", NEON_REVIEW_DATABASE_URL: "sensitive-sentinel" },
    encoding: "utf8",
  });
  assert.equal(hit.status, 1);
  assert.match(hit.stderr, /differs from/);
  assert.doesNotMatch(hit.stderr, /sensitive-sentinel/);
});
