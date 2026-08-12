import { result, type ResultLike } from "@package/result";

import { BOOTSTRAP_LOG_GROUP } from "#go3m4pwdqt48";
import { formatMeta, resolveArgsForFunction } from "#0co91ca40kwl";
import type {
  BootstrapHandler,
  NormalizedBootstrapLogger,
} from "#63np0sf1s6f9";
import { formatError } from "#7vfj5fhk8sp9";

type BootstrapModuleInvocationResult = ResultLike<
{
  exportShape: BootstrapHandler["exportShape"];
  invoked: boolean;
  tag: string;
},
{
  error?: string;
  exportShape: BootstrapHandler["exportShape"];
  missing?: string[];
  paramsSource: string;
  tag: string;
}
>;

type CallableBootstrapHandler = (...values: unknown[]) => unknown;

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

  const defaultExport =
  mod && typeof mod === "object" ? (mod as any).default : null;

  if (
    defaultExport &&
      typeof defaultExport === "object" &&
      hasOwnFn(defaultExport, "attach")
  ) {
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
}): Promise<BootstrapModuleInvocationResult> {
  const fn = resolveCallableHandler(args.handler);

  if (typeof fn !== "function") {
    return skipNonCallableModule({
        handler: args.handler,
        logger: args.logger,
        paramsSource: args.paramsSource,
        tag: args.tag,
        verbose: args.verbose,
    });
  }

  const resolved = resolveArgsForFunction(args.dependencies, fn, args.paramsOverride);
  if (resolved.ok !== true) {
    return skipMissingArgsModule({
        dependencies: args.dependencies,
        handler: args.handler,
        logger: args.logger,
        paramsSource: args.paramsSource,
        resolved,
        tag: args.tag,
        verbose: args.verbose,
    });
  }

  return invokeResolvedModuleHandler({
      fn,
      handler: args.handler,
      logger: args.logger,
      paramsSource: args.paramsSource,
      resolved,
      tag: args.tag,
      verbose: args.verbose,
  });
}

async function invokeResolvedModuleHandler(args: {
    fn: CallableBootstrapHandler;
    handler: BootstrapHandler;
    logger: NormalizedBootstrapLogger;
    paramsSource: string;
    resolved: Extract<ReturnType<typeof resolveArgsForFunction>, {ok:true}>;
    tag: string;
    verbose: boolean;
}): Promise<BootstrapModuleInvocationResult> {
  try {
    await runModuleHandler(args.fn, args.resolved.args);
    logSuccessfulInvocation({
        handler: args.handler,
        logger: args.logger,
        resolvedMeta: args.resolved.meta,
        tag: args.tag,
        verbose: args.verbose,
    });
    return createInvocationResult("ok", args.handler, args.paramsSource, args.tag);
  } catch (error) {
    args.logger.error(
      BOOTSTRAP_LOG_GROUP,
      `exec-failed :: ${args.tag}: ${formatError(error)}`,
    );
    return createInvocationResult("error", args.handler, args.paramsSource, args.tag, {
        error: formatError(error),
    });
  }
}

function createInvocationResult(
  kind: "error" | "noop" | "ok",
  handler: BootstrapHandler,
  paramsSource: string,
  tag: string,
  extraDetails: {
    error?: string;
    missing?: string[];
  } = {},
): BootstrapModuleInvocationResult {
  const details = {
    ...extraDetails,
    exportShape: handler.exportShape,
    paramsSource,
    tag,
  };
  const data = {
    exportShape: handler.exportShape,
    invoked: kind === "ok",
    tag,
  };

  if (kind === "ok") {
    return result.ok("bootstrap-module-invoked", { data, details });
  }

  if (kind === "noop") {
    return result.noop("module-skipped", { data, details });
  }

  return result.internal("module-exec-failed", { data, details });
}

async function runModuleHandler(
  fn: CallableBootstrapHandler,
  args: unknown[],
): Promise<void> {
  await Promise.resolve(fn(...args));
}

function resolveCallableHandler(
  handler: BootstrapHandler,
): CallableBootstrapHandler | null {
  return handler.exportShape === "attach"
  ? (handler.mod as any).attach
  : (handler.mod as CallableBootstrapHandler);
}

function logSuccessfulInvocation(args: {
    handler: BootstrapHandler;
    logger: NormalizedBootstrapLogger;
    resolvedMeta: Parameters<typeof formatMeta>[0];
    tag: string;
    verbose: boolean;
}): void {
  if (!args.verbose) {
    return;
  }

  const mode = args.handler.exportShape === "attach" ? "attach" : "fn";
  args.logger.info(
    BOOTSTRAP_LOG_GROUP,
    `${mode}(${formatMeta(args.resolvedMeta)}) :: ${args.tag}`,
  );
}

function skipNonCallableModule(args: {
    handler: BootstrapHandler;
    logger: NormalizedBootstrapLogger;
    paramsSource: string;
    tag: string;
    verbose: boolean;
}): BootstrapModuleInvocationResult {
  if (args.verbose) {
    args.logger.warn(
      BOOTSTRAP_LOG_GROUP,
      `skip (module-not-function) :: ${args.tag}`,
    );
  }

  return createInvocationResult(
    "noop",
    args.handler,
    args.paramsSource,
    args.tag,
  );
}

function skipMissingArgsModule(args: {
    dependencies: Record<string, unknown>;
    handler: BootstrapHandler;
    logger: NormalizedBootstrapLogger;
    paramsSource: string;
    resolved: {
      missing: string[];
      used: string[];
    };
    tag: string;
    verbose: boolean;
}): BootstrapModuleInvocationResult {
  if (args.verbose) {
    const missing = args.resolved.missing.join(",");
    const dependencyKeys = Object.keys(args.dependencies || {}).join(",");
    const usedParams = args.resolved.used.join(",") || "-";
    const messageParts = [
      `skip (${args.handler.exportShape}-missing-args:${missing}) :: ${args.tag}`,
      `dependencyKeys=${dependencyKeys}`,
      `paramsSource=${args.paramsSource}`,
      `params=${usedParams}`,
    ];
    args.logger.warn(
      BOOTSTRAP_LOG_GROUP,
      messageParts.join(" | "),
    );
  }

  return createInvocationResult(
    "noop",
    args.handler,
    args.paramsSource,
    args.tag,
    {
      missing: args.resolved.missing,
    },
  );
}

export { hasOwnFn, invokeModuleHandler, resolveModuleHandler };
