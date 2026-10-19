import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEPLOY_CONFIG_PATH, DEPLOY_WORKFLOW_PATH, validateEnvironment, validateProject } from "../src/templates.ts";

const CLI = join(import.meta.dirname, "../src/cli.ts");

function runInit(args: string[]) {
  // stdin from /dev/null: no terminal, so the CLI must not prompt.
  return spawnSync(process.execPath, [CLI, "init", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

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
  it("writes the scaffold from flags without prompting; only the given project becomes a live deployment value", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    const result = runInit([dir, "--project", "demo", "--environment", "dev"]);

    expect(result.status).toBe(0);
    expect(parse(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8"))).toEqual({
      deployment: { project: "demo" },
      stacks: [],
    });
    const workflow = parse(readFileSync(join(dir, DEPLOY_WORKFLOW_PATH), "utf8"));
    expect(workflow.jobs.setup.with).not.toHaveProperty("project");
    expect(workflow.on.workflow_dispatch.inputs.environment.default).toBe("dev");
  });

  it("needs no input: without flags it neither prompts nor writes deployment values or a default Environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    const result = runInit([dir]);

    expect(result.status).toBe(0);
    expect(parse(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8"))).toEqual({ stacks: [] });
    const environmentInput = parse(readFileSync(join(dir, DEPLOY_WORKFLOW_PATH), "utf8")).on.workflow_dispatch.inputs.environment;
    expect(environmentInput).toEqual({ description: "GitHub Environment to deploy to", type: "environment", required: true });
  });

  it("lists every required deployment value with its GitHub variable in the config", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    runInit([dir]);
    const config = readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8");
    const listed = [...config.matchAll(/^ {2}# ([a-z_]+): \S+ +# required[^;]*; GitHub variable ([A-Z_]+)$/gm)].map(([, field, variable]) => [field, variable]);
    const required = [
      "project", "customer_id", "stage", "cloud", "default_location", "public_cloud_flag",
      "resource_group_name", "dns_zone_name", "dns_zone_resource_group_name",
      "state_storage_account_name", "state_container_name", "state_resource_group_name",
      "state_bucket_name", "state_region",
    ];

    expect(listed).toEqual(required.map((field) => [field, field.toUpperCase()]));
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
    expect(parse(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8")).deployment.project).toBe("demo");
  });
});
