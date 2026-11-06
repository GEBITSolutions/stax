// Release notes kept in a marked section of the pull-request description.
// Pure functions are exported for tests; the CLI at the bottom is what
// a-wf-release-notes.yml runs.
import { readFileSync, writeFileSync } from 'node:fs';
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
  console.error(`Unknown command: ${command ?? '(none)'}`);
  process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
