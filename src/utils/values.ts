function toString(value: unknown): string {
  return String(value == null ? "" : value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanStringList(values: Iterable<unknown> | null | undefined): string[] {
  if (!values) return [];

  const out: string[] = [];
  for (const value of values) {
    const item = toString(value);
    if (item) out.push(item);
  }

  return out;
}

export { cleanStringList, isRecord, toString };
