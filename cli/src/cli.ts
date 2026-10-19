#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { input, select } from "@inquirer/prompts";
import { Command } from "commander";
import { addStackToConfig, listConfigs, slugify } from "./add.ts";
import { schema, STACK_TYPES, requiredStackFields, stackFieldProblem } from "./schema.ts";
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

interface AddFlags {
  config?: string;
  name?: string;
  type?: string;
  yes: boolean;
}

interface Question {
  /** Value given on the command line; validated, never prompted for. */
  given: string | undefined;
  message: string;
  /** Error shown when there is no value and no terminal to prompt on. */
  missing: string;
  validate: (value: string) => string | undefined;
  /** Offered as a list instead of free text. */
  choices?: string[];
  fallback?: string;
  /** Take `fallback` without prompting (--yes). */
  acceptFallback?: boolean;
}

/**
 * Command-line values win; missing values are prompted for on a terminal and are an
 * error otherwise, so scripted runs never hang on a prompt.
 */
async function resolveValue(question: Question): Promise<string> {
  const { given, validate, fallback } = question;
  if (given !== undefined) {
    const error = validate(given);
    if (error) throw new Error(error);
    return given;
  }
  if (question.acceptFallback && fallback !== undefined) return fallback;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${question.missing} (no terminal to prompt on)`);
  }
  if (question.choices) return select({ message: question.message, choices: question.choices, default: fallback });
  return input({ message: question.message, default: fallback, validate: (value) => validate(value) ?? true });
}

const program = new Command()
  .name("stax")
  .description("Scaffold, extend and validate projects for the stax stack framework")
  .version(version);

program
  .command("init")
  .description("Generate the deploy workflow and default deploy config in a repository")
  .argument("[directory]", "repository root to write into", ".")
  .option("-p, --project <name>", "project name (resource naming and state layout)")
  .option("-e, --environment <name>", "default GitHub Environment for the deploy form")
  .option("-f, --force", "overwrite existing files", false)
  .action(async (directory: string, flags: InitFlags) => {
    const project = await resolveValue({
      given: flags.project,
      message: "Project name:",
      missing: "missing required option --project",
      validate: validateProject,
    });
    const environment = await resolveValue({
      given: flags.environment,
      message: "Default GitHub Environment:",
      missing: "missing required option --environment",
      validate: validateEnvironment,
    });
    const root = resolve(directory);
    const files = renderProject({ project, environment });
    await writeProject(root, files, flags.force);
    for (const file of files) console.log(`created ${file.path}`);
    console.log(`
Next steps:
  1. Create the GitHub Environment "${environment}" with the variables and secrets your stacks need.
  2. Add stacks with: stax add
  3. Run the Deploy workflow with dry-run enabled.`);
  });

program
  .command("add")
  .description("Add a stack to a deploy config; the other fields its type supports are added as commented examples")
  .argument("[directory]", "repository root containing configs/", ".")
  .option("-c, --config <name>", "deploy config: configs/<name>.yaml")
  .option("-n, --name <name>", "stack name; the id is derived from it")
  .option("-t, --type <type>", "stack type")
  .option("-y, --yes", "accept the example values of required fields instead of prompting", false)
  .action(async (directory: string, flags: AddFlags) => {
    const configsDir = join(directory, "configs");
    const configs = listConfigs(resolve(configsDir));
    if (configs.length === 0) throw new Error(`no deploy configs (.yaml) in ${configsDir}; run stax init first`);
    const names = configs.map((config) => config.name);
    const configName = await resolveValue({
      given: flags.config,
      message: "Deploy config:",
      missing: "missing required option --config",
      validate: (value) =>
        names.includes(value) ? undefined : `unknown deploy config "${value}"; ${configsDir} has: ${names.join(", ")}`,
      choices: names,
      fallback: names.includes("default") ? "default" : names.length === 1 ? names[0] : undefined,
      acceptFallback: flags.yes,
    });
    const name = await resolveValue({
      given: flags.name,
      message: "Stack name:",
      missing: "missing required option --name",
      validate: (value) => (slugify(value) === "" ? "the stack name needs at least one letter or digit" : undefined),
    });
    const type = await resolveValue({
      given: flags.type,
      message: "Stack type:",
      missing: "missing required option --type",
      validate: (value) =>
        STACK_TYPES.includes(value) ? undefined : `unknown stack type "${value}"; expected one of: ${STACK_TYPES.join(", ")}`,
      choices: STACK_TYPES,
    });

    const values: Record<string, string> = {};
    for (const field of requiredStackFields(type)) {
      const definition = schema.$defs.stack.properties[field];
      const example = field === "folder" ? slugify(name) : definition?.examples?.[0];
      const fallback = typeof example === "string" ? example : undefined;
      values[field] = await resolveValue({
        given: undefined,
        message: definition?.description ? `${field} (${definition.description.replace(/\.$/, "")}):` : `${field}:`,
        missing: `missing ${field} for the ${type} stack; pass --yes to accept "${fallback}"`,
        validate: (value) => {
          const problem = stackFieldProblem(field, value);
          return problem && `${field}: ${problem}`;
        },
        choices: definition?.enum,
        fallback,
        acceptFallback: flags.yes,
      });
    }

    const config = configs.find((candidate) => candidate.name === configName);
    if (!config) throw new Error(`unknown deploy config "${configName}"`);
    const { id, text } = addStackToConfig(readFileSync(config.path, "utf8"), { name, type, values });
    writeFileSync(config.path, text);
    console.log(`added stack "${id}" (${type}) to ${join(configsDir, `${configName}.yaml`)}
Uncomment the example fields you need, then check the file with: stax validate config`);
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
