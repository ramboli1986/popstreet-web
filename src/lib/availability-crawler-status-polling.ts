export const crawlerWorkerStatusIntervalMs = 30_000;

export function pollCrawlerWorkerStatus<T>({ read, onStatus, isVisible, subscribeVisibility }: {
  read: (signal: AbortSignal) => Promise<T>;
  onStatus: (status: T | null) => void;
  isVisible: () => boolean;
  subscribeVisibility: (callback: () => void) => () => void;
}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | null = null;
  let nextCheckAt = 0;

  const check = async () => {
    if (stopped || !isVisible() || request) return;
    if (Date.now() < nextCheckAt) {
      clearTimeout(timer);
      timer = setTimeout(check, nextCheckAt - Date.now());
      return;
    }
    const controller = new AbortController();
    request = controller;
    try {
      const status = await read(controller.signal);
      if (!stopped && !controller.signal.aborted && isVisible()) onStatus(status);
    } catch {
      if (!stopped && !controller.signal.aborted && isVisible()) onStatus(null);
    } finally {
      request = null;
      nextCheckAt = Date.now() + crawlerWorkerStatusIntervalMs;
      if (!stopped && isVisible()) timer = setTimeout(check, crawlerWorkerStatusIntervalMs);
    }
  };
  const unsubscribe = subscribeVisibility(() => {
    clearTimeout(timer);
    if (!isVisible()) request?.abort();
    else void check();
  });
  void check();
  return () => {
    stopped = true;
    clearTimeout(timer);
    request?.abort();
    unsubscribe();
  };
}
