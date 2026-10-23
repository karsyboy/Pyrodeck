import { logger } from "./logger";

export type AsyncCallback = () => void | Promise<void>;
export type TimeoutLoopResult = () => Promise<void>;

/** Completion-paced polling with interruptible idle time and final teardown. */
export function asyncLoop(callback: AsyncCallback, timeout: number): TimeoutLoopResult {
  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  const execute = async (): Promise<void> => {
    // Let callers capture the stop function before the first callback runs.
    await Promise.resolve();
    while (running) {
      try {
        await callback();
      } catch (error) {
        logger.critical(error);
      }

      if (running) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          timer = setTimeout(resolve, timeout);
        });
        timer = null;
        wake = null;
      }
    }
  };
  const finished = execute();
  return async () => {
    running = false;
    if (timer !== null) clearTimeout(timer);
    wake?.();
    await finished;
  };
}
