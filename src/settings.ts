// Read-only startup recovery. Never retry writes or external provider requests.
export async function loadLocalSettings<T>(
  read: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (signal.aborted) throw new DOMException("Canceled", "AbortError");
    let deadline: ReturnType<typeof globalThis.setTimeout> | undefined;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([
        Promise.resolve().then(() => {
          if (signal.aborted) throw new DOMException("Canceled", "AbortError");
          return read();
        }),
        new Promise<never>((_, reject) => {
          deadline = globalThis.setTimeout(
            () => reject(new Error("Local settings did not respond.")),
            1500,
          );
          onAbort = () => reject(new DOMException("Canceled", "AbortError"));
          signal.addEventListener("abort", onAbort, { once: true });
        }),
      ]);
    } catch (error) {
      if (signal.aborted || attempt === 2) throw error;
    } finally {
      globalThis.clearTimeout(deadline);
      signal.removeEventListener("abort", onAbort);
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
  }
  throw new Error("Local settings could not be loaded.");
}
