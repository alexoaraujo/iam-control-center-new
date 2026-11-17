/**
 * Types for Bun 1.4.4's built-in virtual "vitest" module in test files only.
 * The application never imports this module; production code is unchanged.
 *
 * Bun's core vi is strongly typed but lacks the Vitest-compatible helpers
 * that test-preload.ts provides. Mirror their precise signatures here rather
 * than masking test failures with skipLibCheck / any / ts-ignore.
 */
declare module "vitest" {
  export {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    test,
  } from "bun:test";

  export const vi: typeof import("bun:test").vi & {
    hoisted<T>(factory: () => T): T;
    stubEnv(name: string, value: string | undefined): void;
    unstubAllEnvs(): void;
    stubGlobal(name: string, value: unknown): void;
    unstubAllGlobals(): void;
  };
}
