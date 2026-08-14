import type { NormalizedBootstrapLogger } from "#63np0sf1s6f9";

const BOOTSTRAP_RUNTIME_LOG_GROUP = "runtime";

async function timeBootstrapStep<T>(
  logger: NormalizedBootstrapLogger,
  label: string,
  run: () => Promise<T>,
  metadata: Record<string, unknown> = {},
): Promise<T> {
  const startedAt = performance.now();
  logger.info(BOOTSTRAP_RUNTIME_LOG_GROUP, `${label} start`, metadata);
  try {
    const value = await run();
    logger.info(BOOTSTRAP_RUNTIME_LOG_GROUP, `${label} complete`, {
        ...metadata,
        took_ms: elapsedMs(startedAt),
    });
    return value;
  } catch (error) {
    logger.fail(BOOTSTRAP_RUNTIME_LOG_GROUP, `${label} failed`, {
        ...metadata,
        error: error instanceof Error ? error.message : String(error),
        took_ms: elapsedMs(startedAt),
    });
    throw error;
  }
}

function timeBootstrapSyncStep<T>(
  logger: NormalizedBootstrapLogger,
  label: string,
  run: () => T,
  metadata: Record<string, unknown> = {},
): T {
  const startedAt = performance.now();
  logger.info(BOOTSTRAP_RUNTIME_LOG_GROUP, `${label} start`, metadata);
  try {
    const value = run();
    logger.info(BOOTSTRAP_RUNTIME_LOG_GROUP, `${label} complete`, {
        ...metadata,
        took_ms: elapsedMs(startedAt),
    });
    return value;
  } catch (error) {
    logger.fail(BOOTSTRAP_RUNTIME_LOG_GROUP, `${label} failed`, {
        ...metadata,
        error: error instanceof Error ? error.message : String(error),
        took_ms: elapsedMs(startedAt),
    });
    throw error;
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export {
  timeBootstrapStep,
  timeBootstrapSyncStep,
};
