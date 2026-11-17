// Fail-closed freshness check for the PR #41 synthetic Neon RBAC fixture.
// The static expiry is an approved lease datum, not a source of authorization.
// This module never reaches Neon, reads credentials, or changes database state.
export const MIN_REMAINING_MS = 15 * 60 * 1000;
const EXPECTED_PROJECT = "tiny-rice-70320263";
const EXPECTED_PARENT = "br-muddy-bar-b63ksdy7";
const BRANCH_ID = /^br-[a-z0-9-]+$/;
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function assertRbacFixtureLease(fixture, nowMs = Date.now()) {
  if (!fixture || fixture.project !== EXPECTED_PROJECT ||
      fixture.parent !== EXPECTED_PARENT ||
      typeof fixture.branch !== "string" ||
      !BRANCH_ID.test(fixture.branch)) {
    throw new Error("BLOCKED_RBAC_FIXTURE_LEASE_IDENTITY");
  }
  if (typeof fixture.expiresAt !== "string" ||
      !UTC_ISO.test(fixture.expiresAt) ||
      !Number.isFinite(Date.parse(fixture.expiresAt)) ||
      new Date(Date.parse(fixture.expiresAt)).toISOString() !==
        fixture.expiresAt.replace(/Z$/, ".000Z") ||
      !Number.isFinite(nowMs)) {
    throw new Error("BLOCKED_RBAC_FIXTURE_LEASE_TIMESTAMP");
  }
  if (Date.parse(fixture.expiresAt) - nowMs < MIN_REMAINING_MS) {
    throw new Error("BLOCKED_RBAC_FIXTURE_LEASE_EXPIRED_OR_EXPIRING");
  }
  return "PASS_RBAC_FIXTURE_LEASE_TIME_WINDOW_OFFLINE";
}
