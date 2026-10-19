import { randomInt } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isMap, isScalar, isSeq, parseDocument, stringify } from "yaml";
import { isRecord } from "./guards.ts";
import { requiredStackFields, schema } from "./schema.ts";
import { validateConfigText } from "./validate.ts";

export interface DeployConfigFile {
  /** Name the Deploy workflow takes: the file name without .yaml. */
  name: string;
  path: string;
}

export interface NewStack {
  /** Display name; the id is derived from it. */
  name: string;
  type: string;
  /** Values for the fields the schema requires for `type`. */
  values: Record<string, string>;
}

/** Item prefix for a new stacks list; matches the config written by stax init. */
const DEFAULT_ITEM_PREFIX = "  - ";

/** The generated deploy workflow reads configs/<name>.yaml, so only .yaml files are selectable. */
export function listConfigs(configsDir: string): DeployConfigFile[] {
  if (!existsSync(configsDir)) return [];
  return readdirSync(configsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => ({ name: entry.name.slice(0, -".yaml".length), path: join(configsDir, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Lowercase letters and digits joined by single dashes; accents are dropped, everything else separates. */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `<slug>-<6 random digits>`, redrawn while the id is taken. */
export function generateStackId(slug: string, taken: ReadonlySet<string>, random: () => number = () => randomInt(1_000_000)): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = `${slug}-${String(random()).padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
  throw new Error(`no free stack id for "${slug}" after 100 attempts`);
}

/**
 * The stack as YAML lines without list prefix: id, name, type and the required fields, then every other
 * field the schema offers for the type as a commented example with its description.
 */
export function renderStackLines(id: string, stack: NewStack): string[] {
  const active = stringify({ id, name: stack.name, type: stack.type, ...stack.values }).trimEnd().split("\n");
  const skipped = new Set(["id", "name", "type", ...Object.keys(stack.values)]);
  const examples = Object.entries(schema.$defs.stack.properties)
    .filter(([field, definition]) => {
      const types = definition["x-stax-types"];
      return !skipped.has(field) && (types === "all" || (types?.includes(stack.type) ?? false));
    })
    .map(([field, definition]) => ({
      lines: stringify({ [field]: definition.examples?.[0] }).trimEnd().split("\n").map((line) => `# ${line}`),
      description: definition.description,
    }));
  const width = Math.max(...examples.map(({ lines }) => lines[0]?.length ?? 0));
  const commented = examples.flatMap(({ lines: [first = "", ...rest], description }) => [
    description ? `${first.padEnd(width)}  # ${description}` : first,
    ...rest,
  ]);
  return [...active, ...commented];
}

/** Start of the line after the one containing `pos`; `pos` itself when it already starts a line. */
function lineStartAfter(text: string, pos: number): number {
  if (pos === 0 || text[pos - 1] === "\n") return pos;
  const newline = text.indexOf("\n", pos);
  return newline === -1 ? text.length : newline + 1;
}

interface InsertionPoint {
  /** The config text, with an empty flow list or a missing stacks key already rewritten. */
  text: string;
  at: number;
  prefix: string;
  takenIds: Set<string>;
}

/** Where a new stack goes: after the last stack, keeping the rest of the file byte for byte. */
function findInsertionPoint(text: string): InsertionPoint {
  const doc = parseDocument(text);
  const [error] = doc.errors;
  if (error) throw new Error(`invalid YAML: ${error.message.split("\n")[0]} (see stax validate config)`);
  const data: unknown = doc.toJS();
  const stacks = isRecord(data) && Array.isArray(data.stacks) ? data.stacks : [];
  const takenIds = new Set(stacks.flatMap((stack) => (isRecord(stack) && typeof stack.id === "string" ? [stack.id] : [])));

  const root = doc.contents;
  if (root !== null && !isMap(root)) throw new Error("not a deploy config: the document must be a mapping");
  const pair = root?.items.find((item) => isScalar(item.key) && item.key.value === "stacks");
  if (!pair || !isScalar(pair.key)) {
    const updated = `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}stacks:\n`;
    return { text: updated, at: updated.length, prefix: DEFAULT_ITEM_PREFIX, takenIds };
  }

  // Parsed nodes always carry source ranges.
  const keyEnd = pair.key.range![1];
  const value = pair.value;
  if (value === null || (isScalar(value) && value.value === null)) {
    return { text, at: lineStartAfter(text, keyEnd), prefix: DEFAULT_ITEM_PREFIX, takenIds };
  }
  if (!isSeq(value)) throw new Error("stacks must be a list");

  const [start, end] = value.range!;
  if (value.flow) {
    if (value.items.length > 0) throw new Error("stacks is a [...] list with entries; rewrite it as a block list first");
    let cut = start;
    while (cut > 0 && text[cut - 1] === " ") cut -= 1;
    const updated = text.slice(0, cut) + text.slice(end);
    return { text: updated, at: lineStartAfter(updated, cut), prefix: DEFAULT_ITEM_PREFIX, takenIds };
  }

  const last = value.items.at(-1);
  if (!last || !("range" in last) || !last.range) throw new Error("stacks list without entries");
  const itemStart = last.range[0];
  const linePrefix = text.slice(text.lastIndexOf("\n", itemStart - 1) + 1, itemStart);
  const prefix = /^ *- +$/.test(linePrefix) ? linePrefix : DEFAULT_ITEM_PREFIX;
  // Comment lines indented into the last stack (e.g. its commented example fields) stay with it.
  let at = lineStartAfter(text, last.range[1]);
  while (at < text.length) {
    const newline = text.indexOf("\n", at);
    const next = newline === -1 ? text.length : newline + 1;
    const indent = /^( *)#/.exec(text.slice(at, next));
    if ((indent?.[1]?.length ?? -1) < prefix.length) break;
    at = next;
  }
  return { text, at, prefix, takenIds };
}

/**
 * Appends a stack to a deploy config. Fails when the new stack has a validation error, so a written
 * config never gains one.
 */
export function addStackToConfig(text: string, stack: NewStack, random?: () => number): { id: string; text: string } {
  const slug = slugify(stack.name);
  if (slug === "") throw new Error(`stack name "${stack.name}" needs at least one letter or digit`);
  const missing = requiredStackFields(stack.type).filter((field) => !(field in stack.values));
  if (missing.length > 0) throw new Error(`a ${stack.type} stack needs ${missing.join(", ")}`);

  const point = findInsertionPoint(text);
  const id = generateStackId(slug, point.takenIds, random);
  const indent = " ".repeat(point.prefix.length);
  const block = renderStackLines(id, stack)
    .map((line, index) => `${index === 0 ? point.prefix : indent}${line}\n`)
    .join("");
  const lead = point.at === point.text.length && point.text !== "" && !point.text.endsWith("\n") ? "\n" : "";
  const before = point.text.slice(0, point.at) + lead;
  const updated = before + block + point.text.slice(point.at);

  const firstLine = before.split("\n").length;
  const lastLine = firstLine + block.split("\n").length - 2;
  const introduced = validateConfigText(updated).filter(
    (finding) => finding.severity === "error" && finding.line >= firstLine && finding.line <= lastLine,
  );
  if (introduced.length > 0) {
    throw new Error(
      `the new stack would be invalid:\n${introduced.map((finding) => `  ${finding.message}`).join("\n")}`,
    );
  }
  return { id, text: updated };
}
