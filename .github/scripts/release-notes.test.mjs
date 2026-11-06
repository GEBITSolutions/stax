import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DESCRIPTION_LIMIT, KEEP_MARKER, SECTION_END, SECTION_START,
  buildPrompt, hasKeepMarker, isValidNote, stripSection, updateDescription,
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
