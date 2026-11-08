import { afterEach, expect, it, vi } from "vitest";
import { loadLocalSettings } from "../src/settings";

afterEach(() => vi.useRealTimers());

it("recovers a lost read-only startup reply", async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue({ historyEnabled: false });
  const pending = loadLocalSettings(read, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(1600);
  expect(await pending).toEqual({ historyEnabled: false });
  expect(read).toHaveBeenCalledTimes(2);
});

it("reports persistent failures without pretending settings loaded", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValue(new Error("Database unavailable"));
  const pending = loadLocalSettings(read, new AbortController().signal);
  const failure = expect(pending).rejects.toThrow("Database unavailable");
  await vi.runAllTimersAsync();
  await failure;
  expect(read).toHaveBeenCalledTimes(3);
});

it("stops retrying when the component unmounts", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const read = vi.fn(() => new Promise(() => {}));
  const pending = loadLocalSettings(read, controller.signal);
  const failure = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  await failure;
  await vi.runAllTimersAsync();
  expect(read).toHaveBeenCalledTimes(1);
});
