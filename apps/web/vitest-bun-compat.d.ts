/**
 * Test-only TypeScript declaration for Bun's built-in Vitest runtime shim.
 * No runtime import and no replacement of application authorization types.
 *
 * Keep assertions and mocking strongly typed through the real bun:test APIs;
 * never replace test functions or vi with any.
 *
 * Bun 1.4.4's package does not currently expose bun-types/vitest to TS 6.0.3
 * via compilerOptions.types under pnpm, so bridge the virtual module here.
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
    vi,
  } from "bun:test";
}
