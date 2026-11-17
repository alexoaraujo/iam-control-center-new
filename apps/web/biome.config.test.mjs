import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("./biome.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

describe("Biome lint replacement contracts", () => {
  it("keeps React and Next.js recommended lint domains active", () => {
    expect(config.linter?.enabled).toBe(true);
    expect(config.linter?.rules?.preset).toBe("recommended");
    expect(config.linter?.domains?.next).toBe("recommended");
    expect(config.linter?.domains?.react).toBe("recommended");
  });

  it("makes React Hooks, Next.js image optimization and JSX interaction rules blocking", () => {
    expect(config.linter?.rules?.correctness?.useHookAtTopLevel).toBe("error");
    expect(config.linter?.rules?.correctness?.useExhaustiveDependencies).toBe("error");
    expect(config.linter?.rules?.performance?.noImgElement).toBe("error");
    expect(config.linter?.rules?.a11y?.noStaticElementInteractions).toBe("error");
  });

  it("keeps generated files outside the linted source tree", () => {
    expect(config.files?.includes).toContain("!!**/.next");
    expect(config.files?.includes).toContain("!!**/coverage");
    expect(config.files?.includes).toContain("!**/next-env.d.ts");
  });

  it("pins Biome and excludes the vulnerable eslint-config-next dependency chain", () => {
    expect(manifest.scripts?.lint).toBe("biome lint .");
    expect(manifest.devDependencies?.["@biomejs/biome"]).toBe("2.6.8");
    expect(manifest.devDependencies).not.toHaveProperty("eslint-config-next");
    expect(manifest.devDependencies).not.toHaveProperty("eslint");
  });

  it("leaves independent typecheck and unit test gates enabled", () => {
    expect(manifest.scripts?.typecheck).toBe("tsc --noEmit");
    expect(manifest.scripts?.test).toBe("bun test --isolate --globals=vitest");
  });
});
