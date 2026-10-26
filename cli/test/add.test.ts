import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addStackToConfig, generateStackId, renderStackLines, slugify, type NewStack } from "../src/add.ts";
import { requiredStackFields, schema, STACK_TYPES } from "../src/schema.ts";
import { DEPLOY_CONFIG_PATH, renderProject } from "../src/templates.ts";
import { validateConfigText } from "../src/validate.ts";

const CLI = join(import.meta.dirname, "../src/cli.ts");
const fixed = () => 42;

/** A stack of `type` whose required fields hold the values `stax add --yes` would use. */
function defaultStack(name: string, type: string): NewStack {
  const values = Object.fromEntries(
    requiredStackFields(type).map((field) => [
      field,
      field === "folder" ? slugify(name) : String(schema.$defs.stack.properties[field]?.examples?.[0]),
    ]),
  );
  return { name, type, values };
}

/** The new stack exactly as `prefix` would list it. */
function block(stack: NewStack, prefix = "  - "): string {
  return renderStackLines("net-000042", stack)
    .map((line, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}\n`)
    .join("");
}

describe("stack ids", () => {
  it.each([
    ["Network Hub", "network-hub"],
    ["  API -- Gateway v2 ", "api-gateway-v2"],
    ["Überblick Netz", "uberblick-netz"],
    ["!!!", ""],
  ])("slugifies %j to %j", (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it("appends six zero-padded random digits and redraws taken ids", () => {
    const draws = [7, 7, 123456];
    expect(generateStackId("net", new Set(["net-000007"]), () => draws.shift() ?? 0)).toBe("net-123456");
  });
});

describe("addStackToConfig", () => {
  const stack = defaultStack("Net", "docker-build-push");

  it.each([
    {
      name: "an empty [] list, as written by stax init",
      original: "stacks: []  # none yet\n# Example:\n#  - id: x\n",
      head: "stacks:  # none yet\n",
      tail: "# Example:\n#  - id: x\n",
    },
    {
      name: "a stacks key without value",
      original: "globals: {}\nstacks:\n# trailing\n",
      head: "globals: {}\nstacks:\n",
      tail: "# trailing\n",
    },
  ])("turns $name into a block list and keeps the rest", ({ original, head, tail }) => {
    expect(addStackToConfig(original, stack, fixed).text).toBe(head + block(stack) + tail);
  });

  it("appends after the last stack, keeping its commented fields with it and later comments after the new stack", () => {
    const head = "stacks:\n  - id: a\n    type: docker-build-push\n    # no_cache: false\n";
    const tail = "\n# Example at the top level\nglobals: {}\n";
    expect(addStackToConfig(head + tail, stack, fixed).text).toBe(head + block(stack) + tail);
  });

  it("follows the list style of the existing stacks", () => {
    const original = "stacks:\n- id: a\n  type: docker-build-push\n";
    expect(addStackToConfig(original, stack, fixed).text).toBe(original + block(stack, "- "));
  });

  it("adds a stacks key to a config without one, also without a final newline", () => {
    expect(addStackToConfig("globals: {}", stack, fixed).text).toBe(`globals: {}\nstacks:\n${block(stack)}`);
    expect(addStackToConfig("", stack, fixed).text).toBe(`stacks:\n${block(stack)}`);
  });

  it("does not reuse an id in the file", () => {
    const original = "stacks:\n  - id: net-000042\n    type: docker-build-push\n";
    const draws = [42, 43];
    expect(addStackToConfig(original, stack, () => draws.shift() ?? 0).id).toBe("net-000043");
  });

  it.each(STACK_TYPES)("writes a valid %s stack whose commented fields stay valid when uncommented", (type) => {
    const { text } = addStackToConfig("stacks: []\n", defaultStack("My Stack", type));
    expect(validateConfigText(text)).toEqual([]);

    const uncommented = text.replace(/^( *)# /gm, "$1");
    expect(uncommented).not.toBe(text);
    const findings = validateConfigText(uncommented);
    expect(findings.filter((finding) => finding.severity === "error")).toEqual([]);
    expect(findings.map((finding) => finding.message)).not.toContainEqual(expect.stringContaining("unknown field"));
  });

  it("refuses a stack that would make the config invalid", () => {
    const pages = defaultStack("Docs", "github-pages-site-deploy");
    const { text } = addStackToConfig("stacks: []\n", pages);
    expect(() => addStackToConfig(text, defaultStack("More Docs", "github-pages-site-deploy"))).toThrow(
      "more than one github-pages-site-deploy stack",
    );
    expect(() => addStackToConfig("stacks: []\n", { name: "Img", type: "packer", values: {} })).toThrow(
      "a packer stack needs packer_directory, packer_version",
    );
    expect(() => addStackToConfig("stacks: [{ id: a, type: rpmbuild }]\n", pages)).toThrow("rewrite it as a block list");
  });
});

describe("stax add", () => {
  function initProject(): string {
    const root = mkdtempSync(join(tmpdir(), "stax-add-"));
    const config = renderProject({ project: "demo", environment: "dev" }, "feature/cli-tests").find((file) => file.path === DEPLOY_CONFIG_PATH);
    mkdirSync(join(root, "configs"));
    writeFileSync(join(root, DEPLOY_CONFIG_PATH), config!.content);
    return root;
  }

  function run(cwd: string, args: string[]) {
    return spawnSync(process.execPath, [CLI, "add", ...args], { cwd, encoding: "utf8" });
  }

  it("adds a stack with --yes, deriving the id and folder from the name", () => {
    const cwd = initProject();
    const result = run(cwd, ["-n", "Network Hub", "-t", "opentofu", "--yes"]);
    expect(result.stderr).toBe("");
    expect(result.stdout).toMatch(/^added stack "network-hub-\d{6}" \(opentofu\) to configs\/default\.yaml\n/);
    const text = readFileSync(join(cwd, DEPLOY_CONFIG_PATH), "utf8");
    expect(text).toMatch(/ {2}- id: network-hub-\d{6}\n {4}name: Network Hub\n {4}type: opentofu\n {4}folder: network-hub\n {4}# if: /);
    expect(validateConfigText(text)).toEqual([]);
  });

  it("fails instead of prompting without a terminal", () => {
    const cwd = initProject();
    const original = readFileSync(join(cwd, DEPLOY_CONFIG_PATH), "utf8");

    expect(run(cwd, ["-c", "default", "-t", "opentofu"]).stderr).toContain("stax: missing required option --name (no terminal to prompt on)");
    const packer = run(cwd, ["-c", "default", "-n", "Image", "-t", "packer"]);
    expect(packer.status).toBe(1);
    expect(packer.stderr).toContain('stax: missing packer_directory for the packer stack; pass --yes to accept "packer/ubuntu"');
    expect(run(cwd, ["-c", "prod", "-n", "x", "-t", "opentofu"]).stderr).toContain('unknown deploy config "prod"; configs has: default');
    expect(run(cwd, ["-n", "x", "-t", "tofu", "-y"]).stderr).toContain('unknown stack type "tofu"');
    expect(readFileSync(join(cwd, DEPLOY_CONFIG_PATH), "utf8")).toBe(original);
  });

  it("requires an existing deploy config", () => {
    const result = run(mkdtempSync(join(tmpdir(), "stax-add-")), ["-n", "x", "-t", "opentofu", "-y"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("stax: no deploy configs (.yaml) in configs; run stax init first");
  });
});
