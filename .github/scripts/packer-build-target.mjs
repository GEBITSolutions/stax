/**
 * Packer build-target contract shared by the Azure and Hetzner workflows.
 *
 * The template owns the source block. This module owns the injected var-file,
 * Hetzner label retention, manifest parsing, and the normalized output names.
 * Workflows load it from the trusted actions checkout
 * (trusted-actions/.github/scripts/packer-build-target.mjs).
 */

import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

export const BUILD_TARGETS = ['azure', 'hetzner', 'aws'];
export const GALLERY_FIELDS = [
  'image_resource_group_name',
  'gallery_name',
  'image_definition_name',
  'image_version',
  'target_regions',
];
export const NORMALIZED_OUTPUTS = ['image_id', 'image_ref', 'build_target', 'version', 'labels', 'git_sha'];
export const RESERVED_LABELS = ['managed_by', 'stax_stack_id', 'stax_env', 'stax_git_sha', 'stax_build_target'];
export const SCAN_HOOK_MARKER = '.stax/scan/run.sh';
export const SCAN_TOOLS = ['trivy', 'lynis', 'goss'];
export const STAX_VARIABLES = ['stax_build_target', 'stax_stack_id', 'stax_env', 'stax_git_sha', 'stax_image_version', 'stax_scan_enabled'];

const LABEL_KEY = /^[A-Za-z](?:[A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?$/;
const LABEL_VALUE = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,61}[A-Za-z0-9])?$/;
const SNAPSHOT_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
const SHA = /^[0-9a-f]{40}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function sameValue(left, right) {
  return stable(left) === stable(right);
}

export function resolveBuildTarget(stack) {
  if (!stack || typeof stack !== 'object' || Array.isArray(stack)) {
    throw new Error('Packer stack data must be an object.');
  }
  if (!Object.hasOwn(stack, 'build_target')) return 'azure';
  if (!BUILD_TARGETS.includes(stack.build_target)) {
    throw new Error('build_target must be one of: azure, hetzner, aws.');
  }
  return stack.build_target;
}

export function galleryFieldsFromStack(stack) {
  const aliases = {};
  for (const field of GALLERY_FIELDS) {
    if (stack[field] !== undefined) aliases[field] = stack[field];
  }
  const block = stack.azure && typeof stack.azure === 'object' && !Array.isArray(stack.azure) ? stack.azure : {};
  const conflicts = GALLERY_FIELDS.filter(
    (field) => aliases[field] !== undefined && block[field] !== undefined && !sameValue(aliases[field], block[field]),
  );
  if (conflicts.length > 0) {
    throw new Error(`azure.${conflicts.join(', azure.')} conflicts with the deprecated top-level alias of the same name.`);
  }
  return { fields: { ...aliases, ...block }, usedAliases: Object.keys(aliases) };
}

function assertLabel(kind, value) {
  const pattern = kind === 'key' ? LABEL_KEY : LABEL_VALUE;
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`Hetzner label ${kind} "${value}" must be 1-63 characters of letters, digits, "_", "." and "-", starting and ending with a letter or digit${kind === 'key' ? ', and starting with a letter' : ''}.`);
  }
}

export function hetznerLabels({ stackId, environment, gitSha, userLabels = {} }) {
  for (const [key, value] of Object.entries(userLabels)) {
    assertLabel('key', key);
    assertLabel('value', value);
  }
  const managed = {
    stax_stack_id: stackId,
    stax_env: environment,
    stax_git_sha: gitSha,
    stax_build_target: 'hetzner',
    managed_by: 'stax',
  };
  for (const [key, value] of Object.entries(managed)) assertLabel('value', value);
  return { ...userLabels, ...managed };
}

export function resolveHetzner(stack, { gitSha, environment }) {
  const block = stack.hetzner;
  if (!block || typeof block !== 'object' || Array.isArray(block)) {
    throw new Error('build_target hetzner requires a hetzner object with location and server_type.');
  }
  const { location, server_type: serverType, snapshot_name: snapshotName, snapshot_labels: snapshotLabels, keep_last: keepLast } = block;
  if (typeof location !== 'string' || !/^[a-z]{2,4}[0-9]?$/.test(location)) {
    throw new Error('hetzner.location must be a Hetzner location such as fsn1.');
  }
  if (typeof serverType !== 'string' || !/^[a-z][a-z0-9]{1,31}$/.test(serverType)) {
    throw new Error('hetzner.server_type must be a Hetzner server type such as cax11.');
  }
  const name = snapshotName === undefined ? stack.id : snapshotName;
  if (typeof name !== 'string' || !SNAPSHOT_NAME.test(name)) {
    throw new Error('hetzner.snapshot_name must be 1-63 letters, digits, ".", "_" or "-", starting with a letter or digit. Set it when the stack id is not a valid snapshot name.');
  }
  if (snapshotLabels !== undefined && (typeof snapshotLabels !== 'object' || snapshotLabels === null || Array.isArray(snapshotLabels))) {
    throw new Error('hetzner.snapshot_labels must be a mapping of strings.');
  }
  const keep = keepLast === undefined ? 3 : keepLast;
  if (!Number.isInteger(keep) || keep < 0 || keep > 100) {
    throw new Error('hetzner.keep_last must be an integer from 0 to 100.');
  }
  if (!SHA.test(gitSha ?? '')) throw new Error('A full lowercase source SHA is required to label a Hetzner snapshot.');
  if (typeof environment !== 'string' || environment === '') throw new Error('A pipeline environment name is required to label a Hetzner snapshot.');
  const labels = hetznerLabels({
    stackId: stack.id,
    environment,
    gitSha,
    userLabels: snapshotLabels ?? {},
  });
  return {
    fields: { location, server_type: serverType, snapshot_name: name, snapshot_labels: labels },
    keepLast: keep,
    selector: {
      managed_by: 'stax',
      stax_stack_id: stack.id,
      stax_env: environment,
      stax_build_target: 'hetzner',
    },
    labels,
  };
}

export function imageVersion({ buildTarget, galleryVersion, gitSha }) {
  if (buildTarget === 'azure') {
    if (typeof galleryVersion !== 'string' || !SEMVER.test(galleryVersion)) {
      throw new Error('Azure image_version must be a numeric Major.Minor.Patch version.');
    }
    return galleryVersion;
  }
  if (!SHA.test(gitSha ?? '')) throw new Error('A full lowercase source SHA is required to derive the Hetzner image version.');
  return `0.0.0+${gitSha}`;
}

export function staxVariables({ buildTarget, stackId, environment, gitSha, version, scanEnabled = false }) {
  const vars = {
    stax_build_target: buildTarget,
    stax_stack_id: stackId,
    stax_env: environment,
    stax_git_sha: gitSha,
    stax_image_version: version,
  };
  if (scanEnabled) vars.stax_scan_enabled = true;
  return vars;
}

export function declaredPackerVariables(templatePath) {
  const names = new Set();
  const files = [];
  const walk = (path) => {
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry === '.packer' || entry === 'packer_cache') continue;
        walk(join(path, entry));
      }
      return;
    }
    if (/\.(pkr\.)?hcl$/.test(path)) files.push(path);
  };
  walk(templatePath);
  const pattern = /variable\s+"([A-Za-z_][A-Za-z0-9_]*)"\s*\{/g;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}


const RELATIVE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const TRIVY_SEVERITY = /^[A-Z]+(,[A-Z]+)*$/;
const TRIVY_SCANNERS = new Set(['vuln', 'misconfig', 'secret', 'license']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Resolve optional packer.scan. Omit or null means disabled. When present at
 * least one of trivy, lynis, goss must be configured. Defaults fill in for
 * empty tool objects so `trivy: {}` enables HIGH,CRITICAL vuln scans.
 */
export function resolveScan(stack) {
  if (!stack || typeof stack !== 'object' || Array.isArray(stack)) {
    throw new Error('Packer stack data must be an object.');
  }
  if (!Object.hasOwn(stack, 'scan') || stack.scan === undefined || stack.scan === null) {
    return { enabled: false, config: null };
  }
  if (!isPlainObject(stack.scan)) {
    throw new Error('scan must be an object with trivy, lynis and/or goss.');
  }
  const unknown = Object.keys(stack.scan).filter((key) => !SCAN_TOOLS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`scan has unknown tool(s): ${unknown.join(', ')}. Supported: trivy, lynis, goss.`);
  }
  if (Object.keys(stack.scan).length === 0) {
    throw new Error('scan requires at least one of trivy, lynis, or goss.');
  }

  const config = {};
  if (Object.hasOwn(stack.scan, 'trivy')) {
    const trivy = stack.scan.trivy;
    if (!isPlainObject(trivy)) throw new Error('scan.trivy must be an object.');
    const severity = trivy.severity === undefined ? 'HIGH,CRITICAL' : trivy.severity;
    if (typeof severity !== 'string' || !TRIVY_SEVERITY.test(severity)) {
      throw new Error('scan.trivy.severity must be a comma-separated list of uppercase severities such as HIGH,CRITICAL.');
    }
    const scanners = trivy.scanners === undefined ? ['vuln'] : trivy.scanners;
    if (!Array.isArray(scanners) || scanners.length === 0 || scanners.some((item) => !TRIVY_SCANNERS.has(item))) {
      throw new Error('scan.trivy.scanners must be a nonempty list from vuln, misconfig, secret, license.');
    }
    config.trivy = { severity, scanners: [...scanners] };
  }
  if (Object.hasOwn(stack.scan, 'lynis')) {
    const lynis = stack.scan.lynis;
    if (!isPlainObject(lynis)) throw new Error('scan.lynis must be an object.');
    const min = lynis.min_hardening_index === undefined ? 50 : lynis.min_hardening_index;
    if (!Number.isInteger(min) || min < 0 || min > 100) {
      throw new Error('scan.lynis.min_hardening_index must be an integer from 0 to 100.');
    }
    config.lynis = { min_hardening_index: min };
  }
  if (Object.hasOwn(stack.scan, 'goss')) {
    const goss = stack.scan.goss;
    if (!isPlainObject(goss)) throw new Error('scan.goss must be an object.');
    if (typeof goss.spec !== 'string' || !RELATIVE_PATH.test(goss.spec)) {
      throw new Error('scan.goss.spec must be a repository-relative POSIX path without "..".');
    }
    config.goss = { spec: goss.spec };
  }
  return { enabled: true, config };
}

/**
 * Templates that enable scan must declare stax_scan_enabled and invoke the
 * STAX scan entrypoint so a failing hook aborts packer build before publish.
 */
export function assertScanTemplateContract(templatePath) {
  const declared = declaredPackerVariables(templatePath);
  if (!declared.has('stax_scan_enabled')) {
    throw new Error('scan is configured, but the Packer template does not declare variable "stax_scan_enabled".');
  }
  const files = [];
  const walk = (path) => {
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (entry === '.packer' || entry === 'packer_cache' || entry === '.stax') continue;
        walk(join(path, entry));
      }
      return;
    }
    if (/\.(pkr\.)?hcl$/.test(path)) files.push(path);
  };
  walk(templatePath);
  const found = files.some((file) => readFileSync(file, 'utf8').includes(SCAN_HOOK_MARKER));
  if (!found) {
    throw new Error(`scan is configured, but the Packer template never references ${SCAN_HOOK_MARKER}. Add a shell provisioner that runs it when stax_scan_enabled is true.`);
  }
}

function defaultScanScriptsRoot() {
  return join(dirname(fileURLToPath(import.meta.url)), 'packer-scan');
}

/**
 * Write .stax/scan/{run.sh,config.json} into the Packer project. Guest-side
 * tools read config.json; Packer provisioners must execute run.sh.
 */
export function materializeScan({ packerDirectory, scan, scriptsRoot = defaultScanScriptsRoot() }) {
  if (!scan?.enabled) {
    // Keep a no-op entrypoint so templates that always reference the hook still
    // pass `packer validate` when scan is off or after a previous materialize.
    const targetDir = join(packerDirectory, '.stax', 'scan');
    mkdirSync(targetDir, { recursive: true });
    const runTarget = join(targetDir, 'run.sh');
    writeFileSync(
      runTarget,
      "#!/usr/bin/env bash\nset -euo pipefail\necho \"STAX scan hooks disabled.\"\nexit 0\n",
    );
    chmodSync(runTarget, 0o755);
    return { written: false, directory: targetDir };
  }
  const runSource = join(scriptsRoot, 'run.sh');
  if (!statSync(runSource).isFile()) {
    throw new Error(`Packer scan helper missing at ${runSource}.`);
  }
  let gossSpecText;
  if (scan.config.goss) {
    const specPath = join(packerDirectory, scan.config.goss.spec);
    try {
      if (!statSync(specPath).isFile()) throw new Error('not a file');
      gossSpecText = readFileSync(specPath, 'utf8');
    } catch {
      throw new Error(`scan.goss.spec "${scan.config.goss.spec}" does not exist under packer_directory.`);
    }
  }
  const targetDir = join(packerDirectory, '.stax', 'scan');
  mkdirSync(targetDir, { recursive: true });
  const guestConfig = structuredClone(scan.config);
  const configJson = JSON.stringify(guestConfig, null, 2);
  // Single-file guest entrypoint: Packer shell "script" uploads only one file.
  const parts = ['#!/usr/bin/env bash', 'set -euo pipefail', `STAX_EMBEDDED_CONFIG=$(cat <<'STAX_JSON_EOF'`, configJson, 'STAX_JSON_EOF', ')'];
  if (gossSpecText !== undefined) {
    parts.push(`STAX_EMBEDDED_GOSS_SPEC=$(cat <<'STAX_GOSS_EOF'`, gossSpecText.replace(/STAX_GOSS_EOF/g, 'STAX_GOSS_E_OF'), 'STAX_GOSS_EOF', ')');
  }
  parts.push(`# --- stax scan runtime ---`, readFileSync(runSource, 'utf8').replace(/^#!\/usr\/bin\/env bash\n/, ''));
  const runTarget = join(targetDir, 'run.sh');
  writeFileSync(runTarget, `${parts.join('\n')}\n`);
  chmodSync(runTarget, 0o755);
  writeFileSync(join(targetDir, 'config.json'), `${configJson}\n`);
  return { written: true, directory: targetDir };
}

/**
 * Merge publisher fields into an existing var-file.
 * Existing input keys win when equal and fail when different, so a legacy
 * Gallery var-file is left untouched. stax_* keys are added only when the
 * template declares them, because Packer rejects unknown var-file keys.
 */
export function assembleVarFile({ existing, targetFields, stax, declared }) {
  const next = { ...existing };
  const added = [];
  for (const [key, value] of Object.entries(targetFields)) {
    if (Object.hasOwn(next, key)) {
      if (!sameValue(next[key], value)) {
        throw new Error(`Packer variable "${key}" from stack inputs conflicts with the ${key} build-target field.`);
      }
      continue;
    }
    next[key] = value;
    added.push(key);
  }
  for (const key of STAX_VARIABLES) {
    if (!declared.has(key)) continue;
    const value = stax[key];
    if (value === undefined || value === '') continue;
    if (Object.hasOwn(next, key)) {
      if (!sameValue(next[key], value)) throw new Error(`Packer variable "${key}" conflicts with the value STAX injects.`);
      continue;
    }
    next[key] = value;
    added.push(key);
  }
  return { vars: next, added, changed: !sameValue(existing, next) };
}

export function azureImageRef({ resourceGroup, gallery, definition, version }) {
  for (const [name, value] of Object.entries({ resourceGroup, gallery, definition, version })) {
    if (typeof value !== 'string' || value === '' || /[/:\\]/.test(value)) {
      throw new Error(`Cannot build an Azure image_ref; "${name}" must be a single path segment.`);
    }
  }
  return `azure:gallery:${resourceGroup}/${gallery}/${definition}/${version}`;
}

export function hetznerImageRef(snapshotId) {
  if (!/^[0-9]+$/.test(String(snapshotId))) throw new Error('Hetzner image_ref requires a numeric snapshot id.');
  return `hcloud:snapshot:${snapshotId}`;
}

export function manifestSnapshotId(manifest) {
  const builds = manifest?.builds;
  if (!Array.isArray(builds) || builds.length === 0) {
    throw new Error('manifest.json has no builds. The template must include a manifest post-processor.');
  }
  const raw = String(builds.at(-1)?.artifact_id ?? '');
  const id = raw.includes(':') ? raw.slice(raw.lastIndexOf(':') + 1) : raw;
  if (!/^[0-9]+$/.test(id)) {
    throw new Error(`manifest artifact_id "${raw}" is not a Hetzner snapshot id.`);
  }
  return id;
}

function createdThenId(left, right) {
  const created = Date.parse(left.created) - Date.parse(right.created);
  if (Number.isFinite(created) && created !== 0) return created;
  return Number(left.id) - Number(right.id);
}

/**
 * Oldest matching snapshots beyond keepLast. Protected ids (the snapshot just
 * built) are never deleted, so keep_last 0 on apply still retains that snapshot.
 * keep_last 0 with nothing protected deletes every match (destroy).
 */
export function snapshotsToDelete({ images, selector, keepLast, protectIds = [] }) {
  if (!Number.isInteger(keepLast) || keepLast < 0) throw new Error('keep_last must be a non-negative integer.');
  const matching = (Array.isArray(images) ? images : [])
    .filter((image) => image && image.type === 'snapshot' && image.labels && Object.entries(selector).every(([key, value]) => image.labels[key] === value))
    .sort(createdThenId);
  const protect = new Set(protectIds.map(String));
  const protectedCount = matching.filter((image) => protect.has(String(image.id))).length;
  const keepCount = Math.max(keepLast, protectedCount);
  const excess = matching.length - keepCount;
  if (excess <= 0) return [];
  return matching.filter((image) => !protect.has(String(image.id))).slice(0, excess).map((image) => String(image.id));
}

export function transferVariableMap(stackId, requested, outputs) {
  const prefix = String(stackId).replaceAll('-', '_');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
    throw new Error('Stack id cannot be converted to a valid output variable prefix.');
  }
  const want = new Set(Array.isArray(requested) ? requested : []);
  const variables = {};
  for (const name of NORMALIZED_OUTPUTS) {
    if (!want.has(name)) continue;
    const value = outputs?.[name];
    if (typeof value !== 'string' || value.length === 0) continue;
    variables[`${prefix.toUpperCase()}__${name.toUpperCase()}`] = value;
  }
  return variables;
}

export function costNote(serverType, keepLast) {
  const price = serverType === 'cax11'
    ? `Server type \`${serverType}\` is about €0.01 per hour, so a 10–20 minute build is a few cents.`
    : `The temporary \`${serverType}\` server is billed for the build hour.`;
  return `${price} Snapshots are about €0.017 per GB-month. Retention keeps the newest ${keepLast} labelled snapshot${keepLast === 1 ? '' : 's'} for this stack and environment.`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function arg(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) throw new Error(`missing ${name}`);
  return argv[index + 1];
}

function commandAssemble(argv) {
  const varsFile = arg(argv, '--vars-file');
  const template = arg(argv, '--template');
  const stack = readJson(arg(argv, '--stack-file'));
  const environment = arg(argv, '--environment');
  const gitSha = arg(argv, '--git-sha');
  const buildTarget = resolveBuildTarget(stack);
  if (buildTarget === 'aws') throw new Error('build_target aws is reserved and not implemented.');
  const existing = readJson(varsFile);
  const declared = declaredPackerVariables(template);
  let targetFields = {};
  let version = '';
  if (buildTarget === 'azure') {
    const { fields } = galleryFieldsFromStack(stack);
    targetFields = fields;
    const galleryVersion = fields.image_version ?? existing.image_version;
    if (typeof galleryVersion === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(galleryVersion)) version = galleryVersion;
  } else {
    const resolved = resolveHetzner(stack, { gitSha, environment });
    for (const key of ['location', 'server_type', 'snapshot_name', 'snapshot_labels']) {
      if (!declared.has(key)) throw new Error(`The Packer template must declare variable "${key}".`);
    }
    targetFields = resolved.fields;
    if (declared.has('keep_last')) targetFields.keep_last = resolved.keepLast;
    version = imageVersion({ buildTarget, gitSha });
  }
  const scan = resolveScan(stack);
  if (scan.enabled) assertScanTemplateContract(template);
  const stax = staxVariables({
    buildTarget,
    stackId: stack.id,
    environment,
    gitSha,
    version,
    scanEnabled: scan.enabled,
  });
  const assembled = assembleVarFile({ existing, targetFields, stax, declared });
  if (assembled.changed) writeFileSync(varsFile, `${JSON.stringify(assembled.vars, null, 2)}\n`);
  process.stdout.write(`changed=${assembled.changed} added=${assembled.added.join(',')} scan=${scan.enabled}\n`);
}

function commandManifest(argv) {
  process.stdout.write(`${manifestSnapshotId(readJson(arg(argv, '--manifest')))}\n`);
}

function commandRetention(argv) {
  const plan = snapshotsToDelete({
    images: readJson(arg(argv, '--images')),
    selector: readJson(arg(argv, '--selector')),
    keepLast: Number(arg(argv, '--keep-last')),
    protectIds: argv.includes('--protect') ? [arg(argv, '--protect')] : [],
  });
  process.stdout.write(`${JSON.stringify(plan)}\n`);
}

function commandTransfer(argv) {
  const variables = transferVariableMap(arg(argv, '--stack-id'), readJson(arg(argv, '--requested')), readJson(arg(argv, '--outputs')));
  process.stdout.write(`${JSON.stringify(variables)}\n`);
}

function commandCost(argv) {
  process.stdout.write(`${costNote(arg(argv, '--server-type'), Number(arg(argv, '--keep-last')))}\n`);
}


function commandMaterializeScan(argv) {
  const packerDirectory = arg(argv, '--packer-directory');
  const stack = readJson(arg(argv, '--stack-file'));
  const scriptsRoot = argv.includes('--scripts-root') ? arg(argv, '--scripts-root') : defaultScanScriptsRoot();
  const scan = resolveScan(stack);
  if (scan.enabled) assertScanTemplateContract(arg(argv, '--template'));
  const result = materializeScan({ packerDirectory, scan, scriptsRoot });
  process.stdout.write(`written=${result.written} enabled=${scan.enabled}\n`);
}

const commands = {
  'assemble-vars': commandAssemble,
  'materialize-scan': commandMaterializeScan,
  'manifest-id': commandManifest,
  'retention-plan': commandRetention,
  'transfer-variables': commandTransfer,
  'cost-note': commandCost,
};

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const run = commands[process.argv[2]];
    if (!run) throw new Error(`unknown command ${process.argv[2] ?? ''}`);
    run(process.argv.slice(3));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
