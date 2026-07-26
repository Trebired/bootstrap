import { buildPackageLogGroup, PACKAGE_NAME } from "./package-metadata.js";

const BOOTSTRAP_LOG_GROUP = buildPackageLogGroup();
const BOOTSTRAP_PACKAGE_NAME = PACKAGE_NAME;
const DEFAULT_LAST_SUFFIX = "a";
const IMPORT_REVISION_PARAM = "bootstrap_v";

const VERBOSE_ENV_KEYS = Object.freeze([
  "BOOTSTRAP_VERBOSE",
]);

export {
  BOOTSTRAP_LOG_GROUP,
  BOOTSTRAP_PACKAGE_NAME,
  DEFAULT_LAST_SUFFIX,
  IMPORT_REVISION_PARAM,
  VERBOSE_ENV_KEYS,
};
