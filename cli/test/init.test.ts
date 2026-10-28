import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DEPLOY_CONFIG_PATH, DEPLOY_WORKFLOW_PATH, renderProject, validateEnvironment, validateProject } from "../src/templates.ts";
import { packageVersion } from "../src/version.ts";

const CLI = join(import.meta.dirname, "../src/cli.ts");

const DEVELOPMENT_REF = "feature/cli-tests";

function runInit(args: string[], includeFrameworkRef = true) {
  // stdin from /dev/null: no terminal, so the CLI must not prompt.
  const refFlag = includeFrameworkRef && packageVersion === "0.0.0-development" ? ["--framework-ref", DEVELOPMENT_REF] : [];
  return spawnSync(process.execPath, [CLI, "init", ...args, ...refFlag], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
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
    const expectedRef = packageVersion === "0.0.0-development" ? DEVELOPMENT_REF : packageVersion;
    expect(workflow.jobs.setup.uses).toBe(`GEBITSolutions/stax/.github/workflows/a-wf-setup-ci.yml@${expectedRef}`);
    expect(workflow.jobs["deploy-levels"].uses).toBe(`GEBITSolutions/stax/.github/workflows/a-wf-deploy-levels.yml@${expectedRef}`);
    expect(workflow.jobs.setup.with["actions-version"]).toBe(expectedRef);
    expect(workflow.jobs["deploy-levels"].with["actions-version"]).toBe(expectedRef);
    // Cross-org: named secrets, not secrets: inherit (inherit does not cross organizations).
    expect(workflow.jobs.setup.secrets).toMatchObject({
      AWS_ACCESS_KEY_ID: "${{ secrets.AWS_ACCESS_KEY_ID }}",
      ARM_CLIENT_ID: "${{ secrets.ARM_CLIENT_ID }}",
    });
    expect(workflow.jobs.setup.secrets).not.toBe("inherit");
    expect(workflow.jobs["deploy-levels"].secrets).toMatchObject({
      HCLOUD_TOKEN: "${{ secrets.HCLOUD_TOKEN }}",
      AWS_ACCESS_KEY_ID: "${{ secrets.AWS_ACCESS_KEY_ID }}",
    });
    expect(workflow.jobs["deploy-levels"].secrets).not.toBe("inherit");
    expect(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8").split("\n", 1)[0]).toBe(
      `# yaml-language-server: $schema=https://raw.githubusercontent.com/GEBITSolutions/stax/${encodeURIComponent(expectedRef)}/schema/deploy-config.schema.json`,
    );
  });

  it("needs no project or environment input: it neither prompts nor writes deployment values or a default Environment", () => {
    const dir = mkdtempSync(join(tmpdir(), "stax-"));
    const result = runInit([dir]);

    expect(result.status).toBe(0);
    expect(parse(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8"))).toEqual({ stacks: [] });
    const environmentInput = parse(readFileSync(join(dir, DEPLOY_WORKFLOW_PATH), "utf8")).on.workflow_dispatch.inputs.environment;
    expect(environmentInput).toEqual({ description: "GitHub Environment to deploy to", type: "environment", required: true });
  });

  it.each(["feature/cli-tests", "2.4.1-rc.2", "true", "12345"])("renders all workflow and schema locations at explicit ref %s", (ref) => {
    const files = renderProject({}, ref);
    const workflow = parse(files.find((file) => file.path === DEPLOY_WORKFLOW_PATH)!.content);
    const config = files.find((file) => file.path === DEPLOY_CONFIG_PATH)!.content;

    expect(workflow.jobs.setup.uses).toBe(`GEBITSolutions/stax/.github/workflows/a-wf-setup-ci.yml@${ref}`);
    expect(workflow.jobs["deploy-levels"].uses).toBe(`GEBITSolutions/stax/.github/workflows/a-wf-deploy-levels.yml@${ref}`);
    expect(workflow.jobs.setup.with["actions-version"]).toBe(ref);
    expect(workflow.jobs["deploy-levels"].with["actions-version"]).toBe(ref);
    expect(config.split("\n", 1)[0]).toBe(
      `# yaml-language-server: $schema=https://raw.githubusercontent.com/GEBITSolutions/stax/${encodeURIComponent(ref)}/schema/deploy-config.schema.json`,
    );
  });

  it.skipIf(packageVersion !== "0.0.0-development")("requires a development framework ref before creating or overwriting files", () => {
    const parent = mkdtempSync(join(tmpdir(), "stax-"));
    const fresh = join(parent, "fresh");
    const missing = runInit([fresh], false);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("--framework-ref");
    expect(existsSync(fresh)).toBe(false);

    const dir = join(parent, "existing");
    mkdirSync(join(dir, "configs"), { recursive: true });
    writeFileSync(join(dir, DEPLOY_CONFIG_PATH), "stacks: [mine]\n");
    const forced = runInit([dir, "--force"], false);
    expect(forced.status).toBe(1);
    expect(forced.stderr).toContain("--framework-ref");
    expect(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8")).toBe("stacks: [mine]\n");
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
    expect(parse(readFileSync(join(dir, DEPLOY_CONFIG_PATH), "utf8")).deployment.project).toBe("demo");
  });
});
