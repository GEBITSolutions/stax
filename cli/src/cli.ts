#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { relative, resolve } from "node:path";
import { input } from "@inquirer/prompts";
import { Command } from "commander";
import { renderProject, validateEnvironment, validateProject } from "./templates.ts";
import { collectConfigFiles, isDeployConfigText, validateConfigText } from "./validate.ts";
import { writeProject } from "./write.ts";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

interface InitFlags {
  project?: string;
  environment?: string;
  force: boolean;
}

interface ValidateConfigFlags {
  recursive: boolean;
  strict: boolean;
}

/**
 * Flag values win; missing values are prompted for on a terminal and are an
 * error otherwise, so scripted runs never hang on a prompt.
 */
async function resolveValue(
  flagValue: string | undefined,
  flag: string,
  message: string,
  validate: (value: string) => string | undefined,
): Promise<string> {
  if (flagValue !== undefined) {
    const error = validate(flagValue);
    if (error) throw new Error(error);
    return flagValue;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`missing required option ${flag} (no terminal to prompt on)`);
  }
  return input({ message, validate: (value) => validate(value) ?? true });
}

const program = new Command()
  .name("stax")
  .description("Scaffold and validate projects for the stax stack framework")
  .version(version);

program
  .command("init")
  .description("Generate the deploy workflow and default deploy config in a repository")
  .argument("[directory]", "repository root to write into", ".")
  .option("-p, --project <name>", "project name (resource naming and state layout)")
  .option("-e, --environment <name>", "default GitHub Environment for the deploy form")
  .option("-f, --force", "overwrite existing files", false)
  .action(async (directory: string, flags: InitFlags) => {
    const project = await resolveValue(flags.project, "--project", "Project name:", validateProject);
    const environment = await resolveValue(
      flags.environment,
      "--environment",
      "Default GitHub Environment:",
      validateEnvironment,
    );
    const root = resolve(directory);
    const files = renderProject({ project, environment });
    await writeProject(root, files, flags.force);
    for (const file of files) console.log(`created ${file.path}`);
    console.log(`
Next steps:
  1. Create the GitHub Environment "${environment}" with the variables and secrets your stacks need.
  2. Add stacks to configs/default.yaml.
  3. Run the Deploy workflow with dry-run enabled.`);
  });

program
  .command("validate")
  .description("Validate project files against the stax framework")
  .command("config")
  .description(
    "Validate deploy configs: one file, or the deploy configs among the .yaml/.yml files in a directory (default: configs)",
  )
  .argument("[path]", "deploy config file or directory", "configs")
  .option("-r, --recursive", "include subdirectories", false)
  .option("--strict", "fail on warnings too", false)
  .action((target: string, flags: ValidateConfigFlags) => {
    if (!existsSync(target)) throw new Error(`${target} does not exist`);
    // A named file is always validated; directory scans skip other YAML (e.g. Helm values) next to the configs.
    const scanning = statSync(target).isDirectory();
    const files = collectConfigFiles(target, flags.recursive);
    if (files.length === 0) {
      throw new Error(`no .yaml/.yml files in ${target}${flags.recursive ? "" : " (use -r to include subdirectories)"}`);
    }

    let checked = 0;
    let errors = 0;
    let warnings = 0;
    for (const file of files) {
      const fromCwd = relative(process.cwd(), file);
      const shown = fromCwd && !fromCwd.startsWith("..") ? fromCwd : file;
      const text = readFileSync(file, "utf8");
      if (scanning && !isDeployConfigText(text)) {
        console.log(`${shown}: skipped (no stacks, externalRepos or globals)`);
        continue;
      }
      checked += 1;
      const findings = validateConfigText(text);
      if (findings.length === 0) {
        console.log(`${shown}: ok`);
        continue;
      }
      console.log(shown);
      for (const finding of findings) {
        if (finding.severity === "error") errors += 1;
        else warnings += 1;
        console.log(`  ${`${finding.line}:${finding.column}`.padEnd(8)}${finding.severity.padEnd(9)}${finding.message}`);
      }
    }
    if (checked === 0) throw new Error(`no deploy configs in ${target}`);

    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
    const skipped = files.length - checked;
    console.log(
      `\n${plural(checked, "file")} checked${skipped > 0 ? `, ${skipped} skipped` : ""}: ${plural(errors, "error")}, ${plural(warnings, "warning")}`,
    );
    if (errors > 0 || (flags.strict && warnings > 0)) process.exitCode = 1;
  });

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof Error && error.name === "ExitPromptError") process.exit(130);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`stax: ${message}`);
  process.exit(1);
}
