import { VERBOSE_ENV_KEYS } from "#go3m4pwdqt48";

function isTruthyEnvValue(value: unknown): boolean {
  return ["1", "true", "on", "yes"].includes(String(value || "").trim().toLowerCase());
}

function envVerbose(env: Record<string, unknown> = process.env): boolean {
  for (const key of VERBOSE_ENV_KEYS) {
    if (isTruthyEnvValue(env[key])) return true;
  }

  return false;
}

export { envVerbose, isTruthyEnvValue };
