/**
 * EXPERIMENTAL test-only bridge for Bun 1.4.4's incomplete Vitest API surface.
 * Never import this file from production code. Every shim has to be removed or
 * independently validated before any release approval. It is NOT a security bypass.
 */
import { mock, vi as bunVi } from "bun:test";
import { beforeEach, vi as vitestVi } from "vitest";

const nativeAndCompat = [...new Set([bunVi, vitestVi])];
type Patchable = typeof bunVi & {
  hoisted?: <T>(factory: () => T) => T;
  stubEnv?: (name: string, value: string | undefined) => void;
  unstubAllEnvs?: () => void;
  stubGlobal?: (name: string, value: unknown) => void;
  unstubAllGlobals?: () => void;
};

const originalEnv = new Map<string, { existed: boolean; value?: string }>();
const originalGlobals = new Map<string, { existed: boolean; value?: unknown }>();

for (const v of nativeAndCompat) {
  const compat = v as Patchable;
  if (typeof compat.hoisted !== "function") {
    // This is safe only if Bun's module hoisting is validated by the negative
    // security suites, including tests that mock server-only dependencies.
    compat.hoisted = <T>(factory: () => T): T => factory();
  }
  if (typeof compat.stubEnv !== "function") {
    compat.stubEnv = (name, value) => {
      if (!originalEnv.has(name)) {
        originalEnv.set(name, {
          existed: Object.prototype.hasOwnProperty.call(process.env, name),
          value: process.env[name],
        });
      }
      if (value === undefined) delete process.env[name];
      else process.env[name] = String(value);
    };
  }
  if (typeof compat.unstubAllEnvs !== "function") {
    compat.unstubAllEnvs = () => {
      for (const [name, before] of originalEnv) {
        if (before.existed) process.env[name] = before.value ?? "";
        else delete process.env[name];
      }
      originalEnv.clear();
    };
  }
  if (typeof compat.stubGlobal !== "function") {
    compat.stubGlobal = (name, value) => {
      if (!originalGlobals.has(name)) {
        originalGlobals.set(name, {
          existed: Object.prototype.hasOwnProperty.call(globalThis, name),
          value: (globalThis as Record<string, unknown>)[name],
        });
      }
      (globalThis as Record<string, unknown>)[name] = value;
    };
  }
  if (typeof compat.unstubAllGlobals !== "function") {
    compat.unstubAllGlobals = () => {
      for (const [name, before] of originalGlobals) {
        if (before.existed) (globalThis as Record<string, unknown>)[name] = before.value;
        else delete (globalThis as Record<string, unknown>)[name];
      }
      originalGlobals.clear();
    };
  }
}

// Next's "server-only" marker is intentionally not an application runtime
// dependency. These test files import server modules under mocked boundaries;
// the Bun test loader must treat the marker as inert ONLY within this test VM.
mock.module("server-only", () => ({}));

// Vitest 5 resets mock call histories before each case. Bun 1.4.4 currently
// retains calls between cases in a suite, which would produce false failures.
// Preserve the stricter original semantics without resetting implementations.
beforeEach(() => vitestVi.clearAllMocks());
