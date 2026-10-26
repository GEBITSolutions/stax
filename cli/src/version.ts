import { createRequire } from "node:module";

export const { version: packageVersion } = createRequire(import.meta.url)("../package.json") as { version: string };

const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** A development checkout has no release tag; choosing a framework ref must be explicit. */
export function resolveFrameworkRef(version: string, frameworkRef?: string): string {
  if (version !== "0.0.0-development") {
    if (!RELEASE_VERSION.test(version)) throw new Error(`invalid CLI release version "${version}"`);
    if (frameworkRef !== undefined) throw new Error("--framework-ref is only available in development builds");
    return version;
  }
  if (frameworkRef === undefined) {
    throw new Error("Development CLI has no matching framework release. Run init with --framework-ref <tag-or-commit-sha>.");
  }
  // Keep refs safe in workflow scalars and reject Git's ambiguous/invalid path forms.
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/+\-]*$/.test(frameworkRef) ||
    frameworkRef.includes("..") ||
    frameworkRef.split("/").some((part) => part === "" || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))
  ) {
    throw new Error(`invalid framework ref "${frameworkRef}": use a tag, commit SHA or branch name`);
  }
  return frameworkRef;
}
