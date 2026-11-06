// Release notes kept in a marked section of the pull-request description.
// Pure functions are exported for tests; the CLI at the bottom is what
// a-wf-release-notes.yml runs.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECTION_START = '<!-- release-notes:start -->';
export const SECTION_END = '<!-- release-notes:end -->';
export const KEEP_MARKER = '<!-- release-notes:keep -->';
export const DESCRIPTION_LIMIT = 65536;
export const NOTE_LIMIT = 20000;

const sectionPattern = /<!-- release-notes:start -->[\s\S]*?<!-- release-notes:end -->/;

// The keep marker counts only on a line of its own; the generated hint
// mentions it inline, which must not freeze regeneration.
export function hasKeepMarker(body) {
  return /^[ \t]*<!-- release-notes:keep -->[ \t]*$/m.test((body ?? '').replace(/\r/g, ''));
}

export function stripSection(body) {
  return (body ?? '').replace(sectionPattern, '').trim();
}

export function isValidNote(note) {
  return /^\*\*Breaking change:\*\* (No|Yes)/.test((note ?? '').trim());
}

export function buildPrompt({ instructions, pr, prNumber, commits, diff, maxDiffChars = 120000 }) {
  const issues = pr.closingIssuesReferences?.nodes ?? [];
  const total = pr.closingIssuesReferences?.totalCount ?? issues.length;
  const truncated = diff.length > maxDiffChars
    ? `\n(The diff was truncated from ${diff.length} characters.)`
    : '';
  const issueText = issues.length === 0
    ? '(none)'
    : issues
      .map((issue) => `### #${issue.number}: ${issue.title}\nURL: ${issue.url}\n${(issue.body ?? '').slice(0, 2000)}`)
      .join('\n\n') + (total > issues.length ? `\n\n(${total - issues.length} more closed issues are not listed.)` : '');
  return [
    instructions.trim(),
    '# Input',
    `Pull request #${prNumber}: ${pr.title}\nURL: ${pr.url}`,
    `## Description\n${stripSection(pr.body).slice(0, 4000) || '(empty)'}`,
    `## Closed issues\n${issueText}`,
    `## Commits\n${commits.trim() || '(none)'}`,
    `## Diff${truncated}\n\`\`\`diff\n${diff.slice(0, maxDiffChars)}\n\`\`\``,
  ].join('\n\n') + '\n';
}

export function renderSection(note, headSha) {
  return [
    SECTION_START,
    '## Release notes',
    '',
    note.trim().slice(0, NOTE_LIMIT),
    '',
    `<sub>Written by an agent for ${headSha.slice(0, 7)}; regenerated on every push. Edit freely; to keep your version, put \`${KEEP_MARKER}\` on a line of its own in this section.</sub>`,
    SECTION_END,
  ].join('\n');
}

// Returns { body } with the updated description, or { skip } with a reason.
export function updateDescription({ body, note, headSha }) {
  const current = body ?? '';
  if (hasKeepMarker(current)) {
    return { skip: 'The release note is marked keep.' };
  }
  const section = renderSection(note, headSha);
  const updated = sectionPattern.test(current)
    ? current.replace(sectionPattern, () => section)
    : `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${section}`;
  if (updated.length + 1 > DESCRIPTION_LIMIT) {
    return { skip: `The description would exceed GitHub's ${DESCRIPTION_LIMIT}-character limit.` };
  }
  return { body: `${updated}\n` };
}

// --- Release composition (a-wf-release-prepare.yml) ---------------------

// Returns { breaking, changes } from a description's section, or null when the
// description has none. `breaking` is the required action for a breaking change,
// otherwise null; `changes` keeps the bullets as written, including wrapped lines.
export function parseSection(body) {
  const match = (body ?? '').replace(/\r/g, '').match(sectionPattern);
  if (!match) return null;
  const lines = match[0].split('\n')
    .filter((line) => !/^(<!--|<sub>|## Release notes)/.test(line.trim()));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const end = lines.findIndex((line) => !line.trim());
  const head = lines.slice(0, end === -1 ? lines.length : end).map((line) => line.trim()).join(' ');
  const changes = end === -1 ? [] : lines.slice(end);
  while (changes.length && !changes[0].trim()) changes.shift();
  const breaking = /^\*\*Breaking change:\*\* Yes/.test(head)
    ? head.replace(/^\*\*Breaking change:\*\* Yes[\s.:-]*/, '').trim()
    : null;
  return { breaking, changes: changes.join('\n') };
}

// Splits a hand-written "## Unreleased" section off a changelog.
export function splitUnreleased(changelog) {
  const text = (changelog ?? '').replace(/\r/g, '').replace(/# RELEASE-NOTES\s*/g, '');
  const match = text.match(/^## Unreleased[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (!match) return { unreleased: '', rest: text.trim() };
  return { unreleased: match[1].trim(), rest: text.replace(match[0], '').trim() };
}

const legacyCategories = [
  ['feature', '### 🚀 New Features'],
  ['bugfixes', '### 🐞 Bugfixes'],
  ['performance', '### ⚡ Performance'],
  ['maintenance', '### 🔧 Maintenance'],
  ['docs', '### 📝 Documentation'],
];

// prs: [{ number, title, url, body }] merged since the previous release.
// jsonNotes: legacy release-ready/release-notes/pr-*.json objects (transition).
// unreleased: a hand-written "## Unreleased" section body (transition).
export function composeRelease({ version, prs = [], jsonNotes = [], unreleased = '' }) {
  const sorted = [...prs].sort((a, b) => a.number - b.number);
  const jsonPrs = new Set(jsonNotes.map((note) => note.pr));
  const breaking = [];
  const changes = [];
  const missing = [];
  for (const pr of sorted) {
    const note = parseSection(pr.body);
    if (!note) {
      if (!jsonPrs.has(pr.number)) missing.push(`- ${pr.title} ([#${pr.number}](${pr.url}))`);
      continue;
    }
    if (note.breaking) breaking.push(`- ${note.breaking} ([#${pr.number}](${pr.url}))`);
    if (note.changes) changes.push(note.changes);
  }
  for (const note of jsonNotes) {
    for (const entry of note.breaking ?? []) breaking.push(`- ${entry} (#${note.pr})`);
  }

  const numbers = [...new Set([...sorted.map((pr) => pr.number), ...jsonPrs])].sort((a, b) => a - b);
  const parts = [];
  if (numbers.length) parts.push(`Merged PRs: ${numbers.join(', ')}`);
  if (breaking.length) parts.push(['### 💥 Breaking Changes', '', ...breaking].join('\n'));
  if (changes.length) parts.push(['### Changes', '', ...changes].join('\n'));
  for (const [key, heading] of legacyCategories) {
    const entries = jsonNotes.flatMap((note) => (note[key] ?? []).map((entry) => `- ${entry} (#${note.pr})`));
    if (entries.length) parts.push([heading, '', ...entries].join('\n'));
  }
  if (unreleased.trim()) parts.push(unreleased.trim());
  if (missing.length) parts.push(['### Merged without release notes', '', ...missing].join('\n'));
  if (!breaking.length && !changes.length && !jsonNotes.length && !unreleased.trim()) {
    parts.push(`_No release notes recorded for ${version}._`);
  }
  const body = parts.join('\n\n');
  return { section: `## Release ${version}\n\n${body}`, body };
}

export function updateChangelog(changelog, section) {
  const { rest } = splitUnreleased(changelog);
  return `${section}\n${rest ? `\n${rest}\n` : ''}`;
}

function main([command]) {
  const env = process.env;
  if (command === 'check-keep') {
    process.stdout.write(hasKeepMarker(readFileSync(env.BODY_FILE, 'utf8')) ? 'true' : 'false');
    return;
  }
  if (command === 'prompt') {
    writeFileSync(env.OUT_FILE, buildPrompt({
      instructions: readFileSync(env.INSTRUCTIONS_FILE, 'utf8'),
      pr: JSON.parse(readFileSync(env.PR_FILE, 'utf8')),
      prNumber: env.PR_NUMBER,
      commits: readFileSync(env.COMMITS_FILE, 'utf8'),
      diff: readFileSync(env.DIFF_FILE, 'utf8'),
      maxDiffChars: Number(env.MAX_DIFF_CHARS || 120000),
    }));
    return;
  }
  if (command === 'update') {
    const result = JSON.parse(readFileSync(env.RESULT_FILE, 'utf8'));
    if (result.is_error !== false || !isValidNote(result.result)) {
      console.error('::error::The agent did not return a release note in the expected format.');
      console.error(String(result.result ?? JSON.stringify(result)).slice(0, 2000));
      process.exitCode = 1;
      return;
    }
    const outcome = updateDescription({
      body: readFileSync(env.BODY_FILE, 'utf8'),
      note: result.result,
      headSha: env.HEAD_SHA,
    });
    if (outcome.skip) {
      console.log(`::notice::${outcome.skip} Not updating the description.`);
      return;
    }
    writeFileSync(env.OUT_FILE, outcome.body);
    return;
  }
  if (command === 'compose') {
    const changelog = existsSync(env.CHANGELOG_FILE) ? readFileSync(env.CHANGELOG_FILE, 'utf8') : '';
    const jsonNotes = existsSync(env.NOTES_DIR)
      ? readdirSync(env.NOTES_DIR).filter((name) => /^pr-\d+\.json$/.test(name)).sort()
        .map((name) => JSON.parse(readFileSync(join(env.NOTES_DIR, name), 'utf8')))
      : [];
    const { section, body } = composeRelease({
      version: env.VERSION,
      prs: JSON.parse(readFileSync(env.PRS_FILE, 'utf8')),
      jsonNotes,
      unreleased: splitUnreleased(changelog).unreleased,
    });
    writeFileSync(env.OUT_CHANGELOG, updateChangelog(changelog, section));
    writeFileSync(env.OUT_BODY, `${body}\n`);
    return;
  }
  console.error(`Unknown command: ${command ?? '(none)'}`);
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
