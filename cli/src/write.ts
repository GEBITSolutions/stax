import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GeneratedFile } from "./templates.ts";

/**
 * Writes all files below `root`. Without `force`, nothing is written when any
 * target already exists.
 */
export async function writeProject(root: string, files: GeneratedFile[], force: boolean): Promise<void> {
  if (!force) {
    const existing = files.filter((file) => existsSync(join(root, file.path))).map((file) => file.path);
    if (existing.length > 0) {
      throw new Error(`refusing to overwrite existing files (use --force): ${existing.join(", ")}`);
    }
  }
  for (const file of files) {
    const target = join(root, file.path);
    await mkdir(dirname(target), { recursive: true });
    // "wx" still guards against a file appearing between the check and the write.
    await writeFile(target, file.content, { flag: force ? "w" : "wx" });
  }
}
