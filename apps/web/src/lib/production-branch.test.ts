import { afterEach, expect, it, vi } from "vitest";
import { expectedProductionBranch, productionBranchValid } from "./production-branch";

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
