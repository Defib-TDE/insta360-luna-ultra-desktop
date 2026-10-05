/** Retry an ended/failed HTTP reader without restarting a healthy camera session. */
export async function recoverPreviewReader(
  consume: () => Promise<void>,
  signal: AbortSignal,
  onRetry: (cause: unknown, attempt: number) => void,
) {
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    signal.throwIfAborted();
    try {
      await consume();
      signal.throwIfAborted();
      throw new Error("The preview connection ended.");
    } catch (cause) {
      signal.throwIfAborted();
      if (attempt === 2) throw cause;
      onRetry(cause, attempt + 1);
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", onAbort);
            resolve();
          },
          500 * (attempt + 1),
        );
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    }
  }
}
