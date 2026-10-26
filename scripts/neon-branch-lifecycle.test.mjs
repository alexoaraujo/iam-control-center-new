import test from "node:test";
import assert from "node:assert/strict";
import {
  listBranches,
  planCreate,
  planDelete,
  previewBranchName,
} from "./neon-branch-lifecycle.mjs";

const branch = (name, current_state = "ready", parent_id = "parent") => ({
  name,
  current_state,
  parent_id,
});
const response = (status, payload, jsonError = false) => ({
  ok: status >= 200 && status < 300,
  status,
  async json() {
    if (jsonError) throw new SyntaxError("bad json");
    return payload;
  },
});
const noWait = async () => {};

test("requires a positive PR number and constructs only the exact preview name", () => {
  assert.equal(previewBranchName(25), "preview/pr-25");
  for (const invalid of ["", "0", "-1", "25/../production", "abc"]) {
    assert.throws(() => previewBranchName(invalid));
  }
});

test("retries a transient timeout/network failure, then succeeds", async () => {
  let calls = 0;
  const branches = [branch("preview/pr-25")];
  const result = await listBranches({
    projectId: "project",
    apiKey: "mock-secret",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new DOMException("timeout", "TimeoutError");
      return response(200, { branches });
    },
    sleepImpl: noWait,
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, branches);
});

test("does not retry authorization failures (401/403)", async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async () => {
      let calls = 0;
      await assert.rejects(
        listBranches({
          projectId: "project",
          apiKey: "mock-secret",
          fetchImpl: async () => {
            calls += 1;
            return response(status, {});
          },
          sleepImpl: noWait,
        }),
        new RegExp(`HTTP ${status}`),
      );
      assert.equal(calls, 1);
    });
  }
});

test("retries 429 and 5xx, with a bounded attempt count", async (t) => {
  for (const status of [429, 500, 503]) {
    await t.test(String(status), async () => {
      let calls = 0;
      await assert.rejects(
        listBranches({
          projectId: "project",
          apiKey: "mock-secret",
          maxAttempts: 3,
          fetchImpl: async () => {
            calls += 1;
            return response(status, {});
          },
          sleepImpl: noWait,
        }),
        new RegExp(`HTTP ${status}`),
      );
      assert.equal(calls, 3);
    });
  }
});

test("fails closed on invalid JSON or a missing branches array", async (t) => {
  await t.test("invalid JSON", async () => {
    await assert.rejects(
      listBranches({
        projectId: "project",
        apiKey: "mock-secret",
        fetchImpl: async () => response(200, null, true),
        sleepImpl: noWait,
      }),
      /invalid JSON/,
    );
  });
  await t.test("missing branches array", async () => {
    await assert.rejects(
      listBranches({
        projectId: "project",
        apiKey: "mock-secret",
        fetchImpl: async () => response(200, { branches: {} }),
        sleepImpl: noWait,
      }),
      /branches array/,
    );
  });
});

test("follows Neon branch pagination cursor until all pages are collected", async () => {
  const requested = [];
  const result = await listBranches({
    projectId: "project",
    apiKey: "mock-secret",
    fetchImpl: async (url) => {
      requested.push(url);
      if (requested.length === 1) {
        return response(200, {
          branches: [branch("production", "ready", null)],
          pagination: { next: "cursor-2" },
        });
      }
      assert.match(url, /cursor=cursor-2/);
      return response(200, {
        branches: [branch("preview/pr-25")],
        pagination: {},
      });
    },
    sleepImpl: noWait,
  });
  assert.equal(requested.length, 2);
  assert.deepEqual(result.map((item) => item.name), ["production", "preview/pr-25"]);
});

test("fails closed when Neon pagination cursor repeats", async () => {
  let calls = 0;
  await assert.rejects(
    listBranches({
      projectId: "project",
      apiKey: "mock-secret",
      fetchImpl: async () => {
        calls += 1;
        return response(200, {
          branches: [],
          pagination: { next: "same-cursor" },
        });
      },
      sleepImpl: noWait,
    }),
    /repeated pagination cursor/,
  );
  assert.equal(calls, 2);
});

test("requires non-empty Neon configuration and never logs API credentials", async () => {
  await assert.rejects(
    listBranches({ projectId: " ", apiKey: "mock-secret" }),
    /configuration is missing/,
  );
});

test("create is idempotent when the exact preview branch is already ready", () => {
  assert.deepEqual(
    planCreate([branch("preview/pr-25"), branch("production", "ready", null)], "preview/pr-25"),
    { shouldCreate: false, reason: "already-ready" },
  );
});

test("create rejects duplicate target names and non-ready preview branches", async (t) => {
  await t.test("duplicate", () => {
    assert.throws(
      () => planCreate([branch("preview/pr-25"), branch("preview/pr-25")], "preview/pr-25"),
      /Duplicate/,
    );
  });
  await t.test("not ready", () => {
    assert.throws(
      () => planCreate([branch("preview/pr-25", "creating")], "preview/pr-25"),
      /not ready/,
    );
  });
});

test("create refuses when root branch capacity is reached", () => {
  assert.throws(
    () => planCreate([
      branch("production", "ready", null),
      branch("development", "ready", null),
      branch("another-root", "ready", null),
    ], "preview/pr-25"),
    /allowance reached/,
  );
});

test("delete is idempotent when target is missing and only accepts preview/pr-N", () => {
  assert.deepEqual(planDelete([], "preview/pr-25"), { exists: false, reason: "already-absent" });
  assert.deepEqual(planDelete([branch("preview/pr-25")], "preview/pr-25"), { exists: true, reason: "present" });
  for (const protectedName of ["production", "development", "preview/pr-x", "preview/pr-25/../production"]) {
    assert.throws(() => planDelete([], protectedName), /non-preview target/);
  }
});

test("delete refuses duplicate preview targets", () => {
  assert.throws(
    () => planDelete([branch("preview/pr-25"), branch("preview/pr-25")], "preview/pr-25"),
    /Duplicate/,
  );
});
