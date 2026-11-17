import test from "node:test";
import assert from "node:assert/strict";
import { assertRbacFixtureLease, MIN_REMAINING_MS } from "./neon-rbac-fixture-lease.mjs";

const valid = {
  project: "tiny-rice-70320263",
  parent: "br-muddy-bar-b63ksdy7",
  branch: "br-quiet-night-b6cfeq4j",
  expiresAt: "2026-11-20T01:30:00Z",
};
const now = Date.parse("2026-11-17T01:29:00Z");

test("reviewed child with enough lease time passes offline preflight", () => {
  assert.equal(assertRbacFixtureLease(valid, now),
    "PASS_RBAC_FIXTURE_LEASE_TIME_WINDOW_OFFLINE");
});
test("expired PR41 fixture must fail before reading credentials", () => {
  const old = { ...valid, branch: "br-royal-dream-b6di0p2w",
    expiresAt: "2026-11-16T23:00:00Z" };
  assert.throws(() => assertRbacFixtureLease(old, now),
    /BLOCKED_RBAC_FIXTURE_LEASE_EXPIRED_OR_EXPIRING/);
});
test("boundary: exactly fifteen minutes is valid, shorter is blocked", () => {
  const at = Date.parse(valid.expiresAt);
  assert.equal(assertRbacFixtureLease(valid, at - MIN_REMAINING_MS),
    "PASS_RBAC_FIXTURE_LEASE_TIME_WINDOW_OFFLINE");
  assert.throws(() => assertRbacFixtureLease(valid, at - MIN_REMAINING_MS + 1),
    /BLOCKED_RBAC_FIXTURE_LEASE_EXPIRED_OR_EXPIRING/);
});
test("wrong project or parent, even with future expiry, fails closed", () => {
  assert.throws(() => assertRbacFixtureLease({ ...valid, project: "another-project" }, now),
    /BLOCKED_RBAC_FIXTURE_LEASE_IDENTITY/);
  assert.throws(() => assertRbacFixtureLease({ ...valid, parent: "br-production" }, now),
    /BLOCKED_RBAC_FIXTURE_LEASE_IDENTITY/);
});
test("malformed branch, missing fixture, and invalid timestamp are rejected", () => {
  assert.throws(() => assertRbacFixtureLease({ ...valid, branch: "some;sql" }, now),
    /BLOCKED_RBAC_FIXTURE_LEASE_IDENTITY/);
  assert.throws(() => assertRbacFixtureLease(null, now),
    /BLOCKED_RBAC_FIXTURE_LEASE_IDENTITY/);
  for (const expiresAt of ["", "2026-11-20", "2026-02-30T01:30:00Z",
    "2026-11-20T01:30:00+00:00", "not-a-time"]) {
    assert.throws(() => assertRbacFixtureLease({ ...valid, expiresAt }, now),
      /BLOCKED_RBAC_FIXTURE_LEASE_TIMESTAMP/);
  }
  assert.throws(() => assertRbacFixtureLease(valid, NaN),
    /BLOCKED_RBAC_FIXTURE_LEASE_TIMESTAMP/);
});
