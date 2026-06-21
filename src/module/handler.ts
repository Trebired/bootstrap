import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { formatMeta, resolveArgsForFunction } from "#0co91ca40kwl";
import type { BootstrapHandler, NormalizedBootstrapLogger } from "#63np0sf1s6f9";
import { formatError } from "#7vfj5fhk8sp9";

function hasOwnFn(obj: unknown, key: PropertyKey): boolean {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(obj as object, key);
    return Boolean(descriptor && typeof descriptor.value === "function");
  } catch {
    return false;
  }
}

function resolveModuleHandler(mod: unknown): BootstrapHandler | null {
  if (mod && typeof mod === "object" && hasOwnFn(mod, "attach")) {
    return {
      exportShape: "attach",
      mod: { attach: (mod as any).attach },
      runtimeFn: (mod as any).attach,
    };
  }

  const defaultExport = mod && typeof mod === "object" ? (mod as any).default : null;

  if (defaultExport && typeof defaultExport === "object" && hasOwnFn(defaultExport, "attach")) {
    return {
      exportShape: "attach",
      mod: { attach: defaultExport.attach },
      runtimeFn: defaultExport.attach,
    };
  }

  if (typeof defaultExport === "function") {
    return {
      exportShape: "function",
      mod: defaultExport,
      runtimeFn: defaultExport,
    };
  }

  return null;
}

async function invokeModuleHandler(args: {
  handler: BootstrapHandler;
  dependencies: Record<string, unknown>;
  tag: string;
  paramsOverride: string[] | null;
  paramsSource: string;
  verbose: boolean;
  logger: NormalizedBootstrapLogger;
}): Promise<boolean> {
  const { handler, dependencies, tag, paramsOverride, paramsSource, verbose, logger } = args;
  const fn = handler.exportShape === "attach" ? (handler.mod as any).attach : handler.mod;

  if (typeof fn !== "function") {
    if (verbose) logger.warn(BOOTSTRAP_LOG_GROUP, `skip (module-not-function) :: ${tag}`);
    return false;
  }

  const resolved = resolveArgsForFunction(dependencies, fn, paramsOverride);
  if (resolved.ok !== true) {
    if (verbose) {
      logger.warn(
        BOOTSTRAP_LOG_GROUP,
        `skip (${handler.exportShape}-missing-args:${resolved.missing.join(",")}) :: ${tag} | dependencyKeys=${Object.keys(dependencies || {}).join(",")} | paramsSource=${paramsSource} | params=${Array.isArray(resolved.used) ? resolved.used.join(",") : "-"}`,
      );
    }

    return false;
  }

  try {
    await Promise.resolve((fn as (...values: unknown[]) => unknown)(...resolved.args));
    if (verbose) {
      const mode = handler.exportShape === "attach" ? "attach" : "fn";
      logger.info(BOOTSTRAP_LOG_GROUP, `${mode}(${formatMeta(resolved.meta)}) :: ${tag}`);
    }
    return true;
  } catch (error) {
    logger.error(BOOTSTRAP_LOG_GROUP, `exec-failed :: ${tag}: ${formatError(error)}`);
    return false;
  }
}

export { hasOwnFn, invokeModuleHandler, resolveModuleHandler };
