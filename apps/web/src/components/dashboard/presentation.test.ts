import { expect, it } from "vitest";
import { isDashboardPath, navigation } from "./presentation";

it("lists eleven unique internal dashboard destinations including operations", () => {
  expect(navigation.length).toBe(11);
  expect(new Set(navigation.map(item => item.href)).size).toBe(11);
  expect(isDashboardPath("/operations")).toBe(true);
  expect(isDashboardPath("/protected")).toBe(false);
  expect(isDashboardPath("//example.invalid")).toBe(false);
  expect(isDashboardPath("/unknown")).toBe(false);
});
