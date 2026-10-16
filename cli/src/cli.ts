#!/usr/bin/env node
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { input } from "@inquirer/prompts";
import { Command } from "commander";
import { renderProject, validateEnvironment, validateProject } from "./templates.ts";
import { writeProject } from "./write.ts";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

interface InitFlags {
  project?: string;
  environment?: string;
  force: boolean;
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
  .description("Scaffold projects for the stax stack framework")
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

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof Error && error.name === "ExitPromptError") process.exit(130);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`stax: ${message}`);
  process.exit(1);
}
