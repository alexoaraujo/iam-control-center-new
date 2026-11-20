import { afterEach, expect, it, vi } from "vitest";
import { getReleaseSnapshot } from "./github-release";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("returns live SHA-bound CI and public PR count without treating CI as release approval", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [{
      name: "CI", status: "completed", conclusion: "success",
      head_sha: "a".repeat(40),
      html_url: "https://github.com/alexoaraujo/iam-control-center-new/actions/runs/123",
    }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => [{ number: 41 }, { number: 40 }] });
  vi.stubGlobal("fetch", fetchMock);
  const result = await getReleaseSnapshot();
  expect(result).toMatchObject({ mainSha: "a".repeat(40), ci: "success", openPullRequests: 2, error: false });
  expect(result.runUrl).toBe("https://github.com/alexoaraujo/iam-control-center-new/actions/runs/123");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
});

it("never reports PASS when GitHub is unavailable, malformed or rate-limited", async () => {
  for (const mock of [
    vi.fn().mockRejectedValue(new Error("network")),
    vi.fn().mockResolvedValue({ ok: false }),
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ workflow_runs: [] }) }),
  ]) {
    vi.stubGlobal("fetch", mock);
    expect(await getReleaseSnapshot()).toMatchObject({ ci: "unavailable", mainSha: null, error: true });
  }
});

it("does not trust unverified HTML links or unrelated check results", async () => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow_runs: [{
      name: "CI", status: "completed", conclusion: "success", head_sha: "b".repeat(40),
      html_url: "https://example.invalid/fake",
    }] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => [] }));
  const result = await getReleaseSnapshot();
  expect(result).toMatchObject({ ci: "success", runUrl: null, openPullRequests: 0 });
});
