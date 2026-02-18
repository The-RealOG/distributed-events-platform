export interface ShutdownLogger {
  info(obj: object, msg: string): void;
  info(msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ShutdownStep {
  name: string;
  run: () => Promise<void>;
}

export interface GracefulShutdownOptions {
  log: ShutdownLogger;
  /** Hard ceiling for the whole sequence; a hung dependency must not block termination. */
  timeoutMs: number;
  /** Runs first and synchronously, e.g. flip readiness so load balancers stop routing here. */
  onStart?: () => void;
  /** Run in order. A failing step is logged and the remaining steps still run. */
  steps: ShutdownStep[];
  signals?: NodeJS.Signals[];
  exit?: (code: number) => void;
}

/**
 * Installs SIGTERM/SIGINT handlers that run an ordered shutdown once. Order matters: stop
 * accepting work before closing the dependencies that in-flight work still needs.
 * Returns the trigger so tests (and fatal-error paths) can start the same sequence.
 */
export function installGracefulShutdown(
  options: GracefulShutdownOptions,
): (reason: string) => Promise<void> {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let started = false;

  const shutdown = async (reason: string): Promise<void> => {
    if (started) return;
    started = true;
    options.onStart?.();
    options.log.info({ reason }, 'shutdown started');

    const forceExit = setTimeout(() => {
      options.log.error({ timeoutMs: options.timeoutMs }, 'shutdown timed out, forcing exit');
      exit(1);
    }, options.timeoutMs);
    forceExit.unref();

    let failed = false;
    for (const step of options.steps) {
      try {
        await step.run();
      } catch (err) {
        failed = true;
        options.log.error({ err, step: step.name }, 'shutdown step failed');
      }
    }
    clearTimeout(forceExit);
    options.log.info({ failed }, 'shutdown complete');
    exit(failed ? 1 : 0);
  };

  for (const signal of options.signals ?? ['SIGTERM', 'SIGINT']) {
    process.once(signal, (s: NodeJS.Signals) => void shutdown(s));
  }
  return shutdown;
}
