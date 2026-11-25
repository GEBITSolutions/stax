// Source-only checks for a caller's Ansible deploy configs (a-wf-ansible-source-checks.yml).
// Usage: node ansible-source-checks.mjs <caller checkout> <stax checkout>; checks <caller>/configs/ansible/*.yaml.
// Needs yq and node on PATH; contacts no hosts and reads no secrets.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Parses a GITHUB_OUTPUT file: name=value lines and name<<delimiter blocks. */
export function githubOutputs(text) {
  const lines = text.split('\n');
  const result = {};
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const heredoc = line.indexOf('<<');
    if (heredoc > 0) {
      const delimiter = line.slice(heredoc + 2);
      const end = lines.indexOf(delimiter, index + 1);
      if (end < 0) throw new Error('Unterminated GitHub action output');
      result[line.slice(0, heredoc)] = lines.slice(index + 1, end).join('\n');
      index = end;
    } else if (line.includes('=')) {
      const equals = line.indexOf('=');
      result[line.slice(0, equals)] = line.slice(equals + 1);
    }
  }
  return result;
}

/**
 * Compiles every actions/github-script body with the argument names actions/github-script@v8
 * binds, so a syntax error or a top-level `await` outside the async wrapper fails before a run.
 */
export function compileGithubScripts(workflows) {
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const { file, workflow } of workflows) {
    for (const job of Object.values(workflow?.jobs ?? {})) {
      for (const step of job?.steps ?? []) {
        if (!String(step?.uses ?? '').startsWith('actions/github-script@')) continue;
        try {
          new AsyncFunction('require', '__original_require__', 'github', 'octokit', 'context', 'core', 'exec', 'glob', 'io', String(step.with?.script ?? ''));
        } catch (error) {
          throw new Error(`GitHub script does not compile: ${file}, step "${step.name ?? 'unnamed'}": ${error.message}`);
        }
      }
    }
  }
}

/** The deploy-configs document a-wf-setup-ci.yml builds from one parsed config file. */
export function deployConfigDocument(sourceFile, config) {
  const externalRepos = config.externalRepos ?? {};
  return {
    deployment: config.deployment ?? {},
    stacks: (config.stacks ?? []).map((stack) => ({ ...stack, config_globals: config.globals ?? null })),
    externalRepos: Array.isArray(externalRepos) ? {} : externalRepos,
    sourceFile,
  };
}

/** Each Ansible stack alone (`<id>`) and with its dependencies (`>id`), as a-wf-setup-ci.yml stack_filter. */
export function selectionCases(configs) {
  return configs.flatMap(({ sourceFile, config }) =>
    (config.stacks ?? [])
      .filter((stack) => stack?.type === 'ansible')
      .flatMap(({ id }) => [
        { sourceFile, config, filter: id, id },
        { sourceFile, config, filter: `>${id}`, id },
      ]),
  );
}

/** Throws unless the selected levels run the requested stack last and contain Ansible stacks only. */
export function checkSelection({ sourceFile, filter, id }, layers) {
  const ids = layers.map((layer) => layer.map((stack) => stack.id));
  const label = `${sourceFile} stack_filter "${filter}" => ${JSON.stringify(ids)}`;
  const last = ids.at(-1) ?? [];
  if (!last.includes(id)) throw new Error(`${label}: "${id}" is not in the last level`);
  if (!filter.startsWith('>') && (ids.length !== 1 || last.length !== 1)) throw new Error(`${label}: expected only "${id}"`);
  const foreign = layers.flat().find((stack) => stack.type !== 'ansible');
  if (foreign) throw new Error(`${label}: "${foreign.id}" is not an Ansible stack`);
  return label;
}

/** Runs the committed gh-create-deploy-config bundle like a-wf-setup-ci.yml does and returns its levels. */
export function runParser(actionScript, { sourceFile, config, filter }) {
  const temp = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'ansible-source-'));
  try {
    const output = join(temp, 'github-output');
    writeFileSync(output, '');
    const parser = spawnSync(process.execPath, [actionScript], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        RUNNER_TEMP: temp,
        GITHUB_OUTPUT: output,
        'INPUT_DEPLOY-DEPTH': '14',
        'INPUT_DEPLOY-CONFIGS': JSON.stringify([deployConfigDocument(sourceFile, config)]),
        'INPUT_STACK-FILTER': filter,
        'INPUT_GLOBAL-VARS': JSON.stringify({ environment: 'source-checks', dry_run: 'true', destroy: 'false' }),
      },
    });
    if (parser.status !== 0) throw new Error(`gh-create-deploy-config rejected ${sourceFile} stack_filter "${filter}":\n${parser.stdout}${parser.stderr}`);
    const layers = githubOutputs(readFileSync(output, 'utf8'))['layer-deployments'];
    if (layers === undefined) throw new Error(`gh-create-deploy-config set no layer-deployments for ${sourceFile} stack_filter "${filter}"`);
    return JSON.parse(layers);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** Playbooks per inventory, for syntax checks that need no host. */
export function ansibleTargets(configs) {
  const targets = new Map();
  for (const { config } of configs) {
    for (const stack of config.stacks ?? []) {
      if (stack?.type !== 'ansible') continue;
      const playbooks = targets.get(stack.ansible_inventory) ?? new Set();
      playbooks.add(stack.ansible_playbook);
      targets.set(stack.ansible_inventory, playbooks);
    }
  }
  return [...targets].map(([inventory, playbooks]) => ({ inventory, playbooks: [...playbooks].sort() }));
}

function yamlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readYaml(file) {
  const result = spawnSync('yq', ['-o=json', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`yq cannot parse ${file}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function main([caller, stax]) {
  const configDirectory = 'configs/ansible';
  const workflowDirectory = join(caller, '.github/workflows');
  compileGithubScripts(yamlFiles(workflowDirectory).map((file) => ({ file, workflow: readYaml(join(workflowDirectory, file)) })));
  console.log('PASS caller GitHub scripts compile with the actions/github-script bindings');

  const configs = yamlFiles(join(caller, configDirectory)).map((name) => {
    const sourceFile = `${configDirectory}/${name}`;
    return { sourceFile, config: readYaml(join(caller, sourceFile)) };
  });
  const cases = selectionCases(configs);
  if (cases.length === 0) throw new Error(`No Ansible stacks in ${configDirectory}`);
  const actionScript = join(stax, '.github/actions/gh-create-deploy-config/dist/index.js');
  for (const selection of cases) console.log(`PASS ${checkSelection(selection, runParser(actionScript, selection))}`);

  writeFileSync(process.env.GITHUB_OUTPUT ?? '/dev/null', `targets=${JSON.stringify(ansibleTargets(configs))}\n`, { flag: 'a' });
  console.log('Source-only checks; no Environment secrets, SSH, host contact or apply');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
