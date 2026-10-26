import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const tarball = resolve(process.argv[2]);
const developmentRef = process.argv[3];
const root = mkdtempSync(join(tmpdir(), "stax-package-smoke-"));

function run(command, args, cwd, expectedStatus = 0) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.status, expectedStatus, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function exercise(label, cwd, invoke, version, frameworkRef) {
  assert.equal(invoke(["--version"]), version);
  invoke(["--help"]);
  // Unsupported generation must fail before creating any scaffold, including with --force.
  invoke(["init", "--force", ...(version === "0.0.0-development" ? [] : ["--framework-ref", "main"])], 1);
  assert.equal(existsSync(join(cwd, ".github")), false);
  assert.equal(existsSync(join(cwd, "configs")), false);
  invoke(["init", ...(version === "0.0.0-development" ? ["--framework-ref", frameworkRef] : [])]);
  const workflow = parse(readFileSync(join(cwd, ".github/workflows/deploy.yml"), "utf8"));
  for (const [job, workflowName] of [["setup", "a-wf-setup-ci.yml"], ["deploy-levels", "a-wf-deploy-levels.yml"]]) {
    assert.equal(workflow.jobs[job].uses, `GEBITSolutions/stax/.github/workflows/${workflowName}@${frameworkRef}`);
    assert.equal(workflow.jobs[job].with["actions-version"], frameworkRef);
  }
  const configPath = join(cwd, "configs/default.yaml");
  const config = readFileSync(configPath, "utf8");
  assert.equal(config.split("\n")[0], `# yaml-language-server: $schema=https://raw.githubusercontent.com/GEBITSolutions/stax/${encodeURIComponent(frameworkRef)}/schema/deploy-config.schema.json`);

  // An editor directive cannot change the installed CLI's schema or require network access.
  const offlineDirective = "# yaml-language-server: $schema=http://127.0.0.1:1/unavailable-schema.json";
  writeFileSync(configPath, config.replace(/^.*\n/, `${offlineDirective}\n`));
  invoke(["add", "--name", "Network Hub", "--type", "opentofu", "--yes"]);
  invoke(["add", "--name", "Docs", "--type", "github-pages-site-deploy", "--yes"]);
  assert.equal(readFileSync(configPath, "utf8").split("\n")[0], offlineDirective);
  invoke(["validate", "config", "--strict"]);

  const invalid = join(cwd, "configs/invalid.yaml");
  writeFileSync(invalid, `${offlineDirective}\nstacks:\n  - id: broken\n    type: opentofu\n`);
  const validation = invoke(["validate", "config", invalid], 1);
  assert.match(validation, /folder/);
  console.log(`${label}: CLI ${version}; framework ${frameworkRef}; init/add/validate and bundled-schema rejection passed`);
}

try {
  const prefix = join(root, "global");
  mkdirSync(prefix);
  run("npm", ["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", tarball], root);
  const installed = join(prefix, "lib/node_modules/@gebit/stax-cli");
  const { version } = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const frameworkRef = version === "0.0.0-development" ? developmentRef : version;
  assert.ok(frameworkRef, "Development package smoke requires an explicit framework ref argument");
  assert.equal(
    readFileSync(join(installed, "schema/deploy-config.schema.json"), "utf8"),
    readFileSync(fileURLToPath(new URL("../../schema/deploy-config.schema.json", import.meta.url)), "utf8"),
  );
  const globalProject = join(root, "global-project");
  mkdirSync(globalProject);
  exercise("global install", globalProject, (args, status) => run(join(prefix, "bin/stax"), args, globalProject, status), version, frameworkRef);

  const localProject = join(root, "local-project");
  mkdirSync(localProject);
  writeFileSync(join(localProject, "package.json"), JSON.stringify({
    name: "stax-smoke-consumer", version: "9.9.9", private: true, scripts: { stax: "stax" },
  }));
  run("npm", ["install", "--save-dev", "--save-exact", "--ignore-scripts", "--no-audit", "--no-fund", tarball], localProject);
  exercise("project-local install", localProject, (args, status) => run("npm", ["run", "--silent", "stax", "--", ...args], localProject, status), version, frameworkRef);
} finally {
  rmSync(root, { recursive: true, force: true });
}
