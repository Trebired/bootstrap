function formatError(error: unknown): string {
  if (error && typeof error === "object") {
    const err = error as { message?: unknown; stack?: unknown };
    if (err.stack) return String(err.stack);
    if (err.message) return String(err.message);
  }

  return String(error);
}

export { formatError };
