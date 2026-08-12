function normalizeMatchValue(value: string): string {
  return String(value || "").trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function matchesRule(args: {
    name: string;
    relativePath: string;
    rules: Set<string>;
}): boolean {
  const { name, relativePath, rules } = args;
  if (!rules.size) return false;

  const normalizedName = normalizeMatchValue(name);
  const normalizedRelativePath = normalizeMatchValue(relativePath);
  return rules.has(normalizedName) || rules.has(normalizedRelativePath);
}

export { matchesRule, normalizeMatchValue };
