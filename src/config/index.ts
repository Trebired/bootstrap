export {
  defineConfig,
  mergeConfigOptions,
  normalizeConfig,
} from "./normalize.js";
export {
  BOOTSTRAP_PROJECT_CONFIG_PATH,
  findConfig,
  findConfigSync,
  loadCachedConfigSync,
  loadConfig,
  loadConfigSync,
  resetConfigCacheForTests,
} from "./load.js";

export type {
  BootstrapConfig,
  BootstrapConfigurableOptions,
  LoadBootstrapConfigOptions,
  LoadedBootstrapConfig,
  NormalizedBootstrapConfig,
} from "./types.js";
