async function invokeCleanupFunction(
  fn: (...args: unknown[]) => unknown,
  thisArg: unknown,
  args: unknown[],
): Promise<void> {
  if (fn.length <= args.length) {
    await Promise.resolve(fn.apply(thisArg, args));
    return;
  }

  await invokeCallbackCleanupFunction(fn, thisArg, args);
}

async function invokeCallbackCleanupFunction(
  fn: (...args: unknown[]) => unknown,
  thisArg: unknown,
  args: unknown[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (error?: unknown) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };

      try {
        const result = fn.apply(thisArg, [...args, settle]);
        if (isThenable(result)) Promise.resolve(result).then(() => settle(), settle);
      } catch (error) {
        settle(error);
      }
  });
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value && typeof(value as { then?: unknown }).then === "function");
}

export {
  invokeCleanupFunction,
};
