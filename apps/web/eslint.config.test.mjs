import { describe, expect, it } from "vitest";
import eslintConfig from "./eslint.config.mjs";

const configs = Array.isArray(eslintConfig) ? eslintConfig : [eslintConfig];

function isEnabled(setting) {
  if (setting === undefined || setting === null || setting === "off" || setting === 0) {
    return false;
  }

  return !(Array.isArray(setting) && (setting[0] === "off" || setting[0] === 0));
}

describe("ESLint dependency compatibility", () => {
  it("keeps import/no-internal-modules disabled with the minimatch 11 override", () => {
    const enabled = configs.some((config) =>
      isEnabled(config.rules?.["import/no-internal-modules"]),
    );

    expect(enabled).toBe(false);
  });
});
