import path from "node:path";
import { pathToFileURL } from "node:url";

import { IMPORT_REVISION_PARAM } from "../constants.js";

let moduleImportRevision = 0;

function nextImportRevision(): number {
  moduleImportRevision += 1;
  return moduleImportRevision;
}

function buildImportHref(fileAbs: string, importRevision: number): string {
  const href = pathToFileURL(path.resolve(fileAbs));
  href.searchParams.set(IMPORT_REVISION_PARAM, String(importRevision || 0));
  return href.href;
}

async function loadModuleFile(fileAbs: string, importRevision: number): Promise<unknown> {
  return import(buildImportHref(fileAbs, importRevision));
}

export { buildImportHref, loadModuleFile, nextImportRevision };
