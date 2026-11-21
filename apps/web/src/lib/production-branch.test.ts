import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { expectedProductionBranch, productionBranchValid, productionBranchFingerprint } from "./production-branch";

afterEach(() => vi.unstubAllEnvs());

it("does not apply Production binding to Preview and Development", () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID", "br-muddy-snow-b63cepcv");
  expect(expectedProductionBranch()).toBeUndefined();
  expect(productionBranchValid("br-super-sound-b63gtz88")).toBe(true);
  vi.stubEnv("VERCEL_ENV", "development");
  expect(productionBranchValid(null)).toBe(true);
});

it("fails closed on missing or invalid Production binding", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID", "");
  expect(expectedProductionBranch()).toBe("");
  expect(productionBranchValid("br-muddy-snow-b63cepcv")).toBe(false);
  vi.stubEnv("IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID", "wrong; SELECT 1");
  expect(productionBranchValid("br-muddy-snow-b63cepcv")).toBe(false);
});

it("accepts only exact approved Production branch; no prefixes or substitutions", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID", "br-muddy-snow-b63cepcv");
  expect(productionBranchValid("br-muddy-snow-b63cepcv")).toBe(true);
  for (const wrong of ["br-muddy-snow-b63cepcv-other", "br-super-sound-b63gtz88", "", null, 1]) {
    expect(productionBranchValid(wrong)).toBe(false);
  }
});

it("returns no fingerprint for nonproduction or disabled diagnostics", () => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("IAM_PRODUCTION_BRANCH_FINGERPRINT_ENABLED", "true");
  expect(productionBranchFingerprint("br-muddy-snow-b63cepcv")).toBeUndefined();
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("IAM_PRODUCTION_BRANCH_FINGERPRINT_ENABLED", "false");
  expect(productionBranchFingerprint("br-muddy-snow-b63cepcv")).toBeUndefined();
});

it("returns a stable 96-bit fingerprint ONLY for a recognized Neon branch ID", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("IAM_PRODUCTION_BRANCH_FINGERPRINT_ENABLED", "true");
  const id = "br-little-fire-b6adup9f";
  const fp = productionBranchFingerprint(id);
  expect(fp).toMatch(/^[0-9a-f]{24}$/);
  expect(fp).toBe(createHash("sha256")
    .update(`iam-prod-branch-attestation:v1:${id}`, "utf8").digest("hex").slice(0, 24));
  for (const bad of ["", null, "postgres://password", "br-x\r\nsecret", 1, "ep-winter-leaf-b6cp8d2c"]) {
    expect(productionBranchFingerprint(bad)).toBeUndefined();
  }
});
