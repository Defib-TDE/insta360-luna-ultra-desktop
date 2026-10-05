import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverPreviewReader } from "~/utils/previewRecovery";

afterEach(() => vi.useRealTimers());

describe("preview reader recovery", () => {
  it("bounds retries for clean EOF as well as a broken HTTP reader", async () => {
    vi.useFakeTimers();
    const consume = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("socket closed"));
    const retry = vi.fn();
    const verdict = expect(
      recoverPreviewReader(consume, new AbortController().signal, retry),
    ).rejects.toThrow("socket closed");
    await vi.runAllTimersAsync();
    await verdict;
    expect(consume).toHaveBeenCalledTimes(3);
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("cancels a reader backoff before opening another HTTP connection", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const consume = vi.fn(async () => {});
    const retry = vi.fn();
    const verdict = expect(
      recoverPreviewReader(consume, controller.signal, retry),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await verdict;
    await vi.runAllTimersAsync();
    expect(consume).toHaveBeenCalledOnce();
  });
});
