import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DESCRIPTION_LIMIT, KEEP_MARKER, SECTION_END, SECTION_START,
  buildPrompt, composeRelease, hasKeepMarker, isValidNote, parseSection, splitUnreleased,
  stripSection, updateChangelog, updateDescription,
} from './release-notes.mjs';

const note = '**Breaking change:** No\n\n- Added a thing. ([#5](https://example.test/pull/5))';

test('keep marker counts only on a line of its own', () => {
  assert.equal(hasKeepMarker(`text\n${KEEP_MARKER}\nmore`), true);
  assert.equal(hasKeepMarker(`text\r\n  ${KEEP_MARKER}  \r\nmore`), true);
  assert.equal(hasKeepMarker(`put \`${KEEP_MARKER}\` on a line of its own`), false);
  assert.equal(hasKeepMarker(null), false);
});

test('the generated hint does not freeze later regeneration', () => {
  const first = updateDescription({ body: 'Author text.', note, headSha: 'aaaaaaa1' });
  assert.equal(hasKeepMarker(first.body), false);
  const second = updateDescription({ body: first.body, note: note.replace('thing', 'other thing'), headSha: 'bbbbbbb2' });
  assert.equal(second.body.split(SECTION_START).length, 2, 'exactly one section');
  assert.match(second.body, /other thing/);
  assert.match(second.body, /bbbbbbb/);
  assert.match(second.body, /^Author text\./);
});

test('a kept section is not overwritten', () => {
  const body = `Intro\n${SECTION_START}\nmine\n${KEEP_MARKER}\n${SECTION_END}\n`;
  assert.deepEqual(Object.keys(updateDescription({ body, note, headSha: 'c' })), ['skip']);
});

test('an empty description gets only the section', () => {
  const { body } = updateDescription({ body: '', note, headSha: 'ddddddd' });
  assert.ok(body.startsWith(SECTION_START));
});

test('the description limit is respected', () => {
  const outcome = updateDescription({ body: 'a'.repeat(DESCRIPTION_LIMIT - 100), note, headSha: 'e' });
  assert.ok(outcome.skip);
  assert.equal(outcome.body, undefined);
});

test('replacement text is inserted literally', () => {
  const tricky = '**Breaking change:** No\n\n- Uses $& and $1 in a command.';
  const first = updateDescription({ body: 'x', note, headSha: 'f' });
  const { body } = updateDescription({ body: first.body, note: tricky, headSha: 'f' });
  assert.match(body, /\$& and \$1/);
});

test('note format is validated', () => {
  assert.equal(isValidNote(note), true);
  assert.equal(isValidNote('**Breaking change:** Yes. Rename the input.'), true);
  assert.equal(isValidNote('Here are the notes:\n**Breaking change:** No'), false);
  assert.equal(isValidNote(undefined), false);
});

test('prompt excludes the previous section and marks truncation', () => {
  const pr = {
    title: 'Add a thing', url: 'https://example.test/pull/5',
    body: `Why.\n${SECTION_START}\nold note\n${SECTION_END}`,
    closingIssuesReferences: { totalCount: 3, nodes: [{ number: 7, title: 'Need thing', url: 'https://example.test/issues/7', body: 'Details' }] },
  };
  const prompt = buildPrompt({ instructions: 'Rules', pr, prNumber: 5, commits: '- feat: thing', diff: 'x'.repeat(50), maxDiffChars: 10 });
  assert.doesNotMatch(prompt, /old note/);
  assert.match(prompt, /Why\./);
  assert.match(prompt, /#7: Need thing/);
  assert.match(prompt, /2 more closed issues are not listed/);
  assert.match(prompt, /truncated from 50 characters/);
  assert.equal(stripSection(pr.body), 'Why.');
});

test('CLI update writes a new description or skips with a notice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const script = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
  const env = {
    ...process.env, BODY_FILE: join(dir, 'body.md'), RESULT_FILE: join(dir, 'result.json'),
    OUT_FILE: join(dir, 'out.md'), HEAD_SHA: '1234567890',
  };
  writeFileSync(env.BODY_FILE, 'Author text.');
  writeFileSync(env.RESULT_FILE, JSON.stringify({ is_error: false, result: note }));
  execFileSync(process.execPath, [script, 'update'], { env });
  assert.match(readFileSync(env.OUT_FILE, 'utf8'), /Added a thing/);

  const kept = join(dir, 'kept-out.md');
  writeFileSync(env.BODY_FILE, `${SECTION_START}\n${KEEP_MARKER}\n${SECTION_END}`);
  const output = execFileSync(process.execPath, [script, 'update'], { env: { ...env, OUT_FILE: kept } }).toString();
  assert.match(output, /::notice::/);
  assert.equal(existsSync(kept), false);
});

test('CLI update fails on a malformed agent result', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
  const script = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
  const env = {
    ...process.env, BODY_FILE: join(dir, 'body.md'), RESULT_FILE: join(dir, 'result.json'),
    OUT_FILE: join(dir, 'out.md'), HEAD_SHA: '1234567',
  };
  writeFileSync(env.BODY_FILE, '');
  writeFileSync(env.RESULT_FILE, JSON.stringify({ is_error: false, result: 'Sure! Here are notes.' }));
  assert.throws(() => execFileSync(process.execPath, [script, 'update'], { env, stdio: 'pipe' }));
});

// --- Release composition -----------------------------------------------------

const section = (text) => `Intro.\n\n${SECTION_START}\n## Release notes\n\n${text}\n\n<sub>hint \`${KEEP_MARKER}\`</sub>\n${SECTION_END}\n`;

test('parseSection reads breaking statements and keeps wrapped bullets', () => {
  assert.equal(parseSection('no section'), null);
  assert.deepEqual(parseSection(section('**Breaking change:** No\n\n- Add a thing. ([#1](u))')),
    { breaking: null, changes: '- Add a thing. ([#1](u))' });
  const wrapped = parseSection(section('**Breaking change:** Yes. Rename `foo`\nto `bar`.\r\n\r\n- Rename input,\n  also in docs. ([#2](u))\n\n  Second paragraph.'));
  assert.equal(wrapped.breaking, 'Rename `foo` to `bar`.');
  assert.equal(wrapped.changes, '- Rename input,\n  also in docs. ([#2](u))\n\n  Second paragraph.');
});

test('splitUnreleased separates a hand-written section and the sentinel', () => {
  const log = '# RELEASE-NOTES\n\n## Unreleased\n\n### 🚀 New Features\n  - Old note.\n\n## Release 1.5.0\n\nMerged PRs: 37\n';
  const { unreleased, rest } = splitUnreleased(log);
  assert.equal(unreleased, '### 🚀 New Features\n  - Old note.');
  assert.equal(rest, '## Release 1.5.0\n\nMerged PRs: 37');
  assert.deepEqual(splitUnreleased('## Release 1.0.0\n\nx'), { unreleased: '', rest: '## Release 1.0.0\n\nx' });
  assert.equal(splitUnreleased('## Unreleased\n\n- only\n').unreleased, '- only');
});

test('composeRelease orders breaking changes first and lists missing notes', () => {
  const prs = [
    { number: 9, title: 'docs: tidy', url: 'u9', body: 'none' },
    { number: 7, title: 'feat: rename', url: 'u7', body: section('**Breaking change:** Yes. Rename `foo` to `bar`.\n\n- Rename input `foo`. ([#7](u7))') },
    { number: 8, title: 'feat: add', url: 'u8', body: section('**Breaking change:** No\n\n- Add thing. ([#8](u8))') },
    { number: 5, title: 'legacy', url: 'u5', body: '' },
  ];
  const jsonNotes = [{ pr: 5, feature: ['Legacy feature'], bugfixes: [], breaking: ['Legacy break'] }];
  const { section: out, body } = composeRelease({ version: '1.9.0', prs, jsonNotes, unreleased: '### 🚀 New Features\n  - Hand note.' });
  assert.ok(out.startsWith('## Release 1.9.0\n\nMerged PRs: 5, 7, 8, 9'));
  assert.ok(!body.includes('## Release'));
  const order = ['### 💥 Breaking Changes', 'Rename `foo` to `bar`. ([#7](u7))', 'Legacy break (#5)', '### Changes',
    '- Rename input `foo`.', '- Add thing.', '- Legacy feature (#5)', '- Hand note.', '### Merged without release notes', '- docs: tidy ([#9](u9))'];
  let at = -1;
  for (const piece of order) {
    const next = out.indexOf(piece);
    assert.ok(next > at, `${piece} in order`);
    at = next;
  }
  assert.ok(!out.includes('- legacy ('), 'a PR with JSON notes is not listed as missing');
});

test('composeRelease states when nothing was recorded', () => {
  assert.match(composeRelease({ version: '2.0.0' }).body, /No release notes recorded for 2\.0\.0/);
  const onlyMissing = composeRelease({ version: '2.0.1', prs: [{ number: 3, title: 't', url: 'u', body: '' }] });
  assert.match(onlyMissing.body, /No release notes recorded/);
  assert.match(onlyMissing.body, /Merged without release notes/);
});

test('updateChangelog replaces Unreleased with the release section', () => {
  const log = '# RELEASE-NOTES\n\n## Unreleased\n\n- x\n\n## Release 1.5.0\n\nold\n';
  assert.equal(updateChangelog(log, '## Release 1.6.0\n\nnew'), '## Release 1.6.0\n\nnew\n\n## Release 1.5.0\n\nold\n');
  assert.equal(updateChangelog('', '## Release 0.1.0\n\nfirst'), '## Release 0.1.0\n\nfirst\n');
});

test('CLI compose writes changelog and release body from real inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-compose-'));
  const script = fileURLToPath(new URL('./release-notes.mjs', import.meta.url));
  const changelogPath = fileURLToPath(new URL('../../CHANGELOG.md', import.meta.url));
  const env = {
    ...process.env, VERSION: '9.9.9', PRS_FILE: join(dir, 'prs.json'), NOTES_DIR: join(dir, 'none'),
    CHANGELOG_FILE: changelogPath, OUT_CHANGELOG: join(dir, 'CHANGELOG.md'), OUT_BODY: join(dir, 'RELEASE_NOTES.md'),
  };
  writeFileSync(env.PRS_FILE, JSON.stringify([{ number: 64, title: 't', url: 'u', body: section('**Breaking change:** No\n\n- Add notes. ([#64](u))') }]));
  execFileSync(process.execPath, [script, 'compose'], { env });
  const out = readFileSync(env.OUT_CHANGELOG, 'utf8');
  assert.ok(out.startsWith('## Release 9.9.9\n'));
  assert.ok(!out.includes('## Unreleased'));
  assert.ok(out.includes('## Release 1.5.0'), 'older releases kept');
  assert.equal(out.split('## Release 9.9.9').length, 2);
  assert.ok(readFileSync(env.OUT_BODY, 'utf8').includes('- Add notes.'));
});
