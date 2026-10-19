import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  DEPLOY_CONFIG_PATH,
  DEPLOY_WORKFLOW_PATH,
  renderProject,
  validateEnvironment,
  validateProject,
} from "../src/templates.ts";

const CLI = join(import.meta.dirname, "../src/cli.ts");

function runInit(args: string[]) {
  // stdin from /dev/null: no terminal, so the CLI must not prompt.
  return spawnSync(process.execPath, [CLI, "init", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("renderProject", () => {
  const files = renderProject({ project: "demo", environment: "dev.example.com" });
  const byPath: Record<string, string> = Object.fromEntries(files.map((file) => [file.path, file.content]));

  it("produces YAML the framework can parse", () => {
    const workflow = parse(byPath[DEPLOY_WORKFLOW_PATH]!);
    expect(workflow.jobs.setup.with.project).toBe("demo");
    expect(workflow.on.workflow_dispatch.inputs.environment.default).toBe("dev.example.com");
    expect(parse(byPath[DEPLOY_CONFIG_PATH]!)).toEqual({ stacks: [] });
  });
});

describe("value validation", () => {
  it.each(["a", "shop", "shop-2"])("accepts project %j", (value) => {
    expect(validateProject(value)).toBeUndefined();
  });

  it.each(["", "1shop", "Shop", "sh_op", 'sh"op', "sh op"])("rejects project %j", (value) => {
    expect(validateProject(value)).toMatch(/invalid project/);
  });

  it.each(["dev", "dev.shop.example.com", "Prod_2-eu"])("accepts environment %j", (value) => {
    expect(validateEnvironment(value)).toBeUndefined();
  });

  it.each(["", "dev env", 'dev"', "dev\nx: y"])("rejects environment %j", (value) => {
    expect(validateEnvironment(value)).toMatch(/invalid environment/);
  });
});

describe("stax init", () => {
  it("writes the scaffold from flags without prompting", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    const result = runInit([dir, "--project", "demo", "--environment", "dev"]);

    expect(result.status).toBe(0);
    expect(readFileSync(join(dir, DEPLOY_WORKFLOW_PATH), "utf8")).toContain('project: "demo"');
    expect(existsSync(join(dir, DEPLOY_CONFIG_PATH))).toBe(true);
  });

  it("fails instead of prompting when a value is missing and there is no terminal", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    const result = runInit([dir, "--project", "demo"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing required option --environment");
    expect(existsSync(join(dir, DEPLOY_WORKFLOW_PATH))).toBe(false);
  });

  it("rejects invalid flag values before writing", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    const result = runInit([dir, "--project", "Demo", "--environment", "dev"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('invalid project "Demo"');
    expect(existsSync(join(dir, DEPLOY_WORKFLOW_PATH))).toBe(false);
  });

  it("writes nothing when any target exists, and overwrites with --force", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    mkdirSync(join(dir, "configs"));
    writeFileSync(join(dir, DEPLOY_CONFIG_PATH), "stacks: [mine]\n");

    const refused = runInit([dir, "-p", "demo", "-e", "dev"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain(`refusing to overwrite existing files (use --force): ${DEPLOY_CONFIG_PATH}`);
    expect(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8")).toBe("stacks: [mine]\n");
    expect(existsSync(join(dir, DEPLOY_WORKFLOW_PATH))).toBe(false);

    const forced = runInit([dir, "-p", "demo", "-e", "dev", "--force"]);
    expect(forced.status).toBe(0);
    expect(parse(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8"))).toEqual({ stacks: [] });
  });
});
