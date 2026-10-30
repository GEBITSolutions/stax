import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveHcloudToken } from './packer-hcloud-token.mjs';

function run({
  data = { build_target: 'hetzner', credentials: { HCLOUD_TOKEN: 'gh.secret.HCLOUD_TOKEN' } },
  pipeline = { dry_run: false }, legacy = '', resolved = ['HCLOUD_TOKEN'], token = 'resolved-token',
} = {}) {
  const vars = {
    DATA_JSON: JSON.stringify(data), PIPELINE_ENV_JSON: JSON.stringify(pipeline),
    LEGACY_HCLOUD_TOKEN: legacy,
    RESOLVED_CREDENTIALS_JSON: JSON.stringify(resolved), HCLOUD_TOKEN: token,
  };
  const outputs = {}, masked = [];
  const core = {
    setOutput: (key, value) => { outputs[key] = value; },
    setSecret: (value) => { masked.push(value); },
    exportVariable: (key, value) => { vars[key] = value; },
  };
  return { execute: () => resolveHcloudToken({ core, env: vars }), vars, outputs, masked };
}

test('dry run uses placeholder without relying on a resolved token', async () => {
  const execution = run({ pipeline: { dry_run: true }, resolved: [], token: '' });
  await execution.execute();
  assert.equal(execution.vars.HCLOUD_TOKEN, 'dry-run-not-a-token');
  assert.equal(execution.vars.HCLOUD_TOKEN_AVAILABLE, 'true');
  assert.equal(execution.outputs.source, 'dry-run');
});

test('non-Hetzner clears a previously exported token', async () => {
  const execution = run({ data: { build_target: 'azure' } });
  await execution.execute();
  assert.equal(execution.outputs.source, 'unused');
  assert.equal(execution.vars.HCLOUD_TOKEN, '');
  assert.equal(execution.vars.HCLOUD_TOKEN_AVAILABLE, 'false');
});

test('unmapped credentials retain legacy GitHub Environment token and availability gate', async () => {
  const found = run({ data: { build_target: 'hetzner', hetzner: {} }, legacy: 'legacy-token', resolved: [] });
  await found.execute();
  assert.equal(found.vars.HCLOUD_TOKEN, 'legacy-token');
  assert.equal(found.vars.HCLOUD_TOKEN_AVAILABLE, 'true');
  assert.equal(found.outputs.source, 'github-secret');
  assert.ok(found.masked.includes('legacy-token'));
  const missing = run({ data: { build_target: 'hetzner' }, legacy: '', resolved: [] });
  await missing.execute();
  assert.equal(missing.vars.HCLOUD_TOKEN_AVAILABLE, 'false');
});

test('mapped credentials use only the exported action result, whether mapped by credentials or alias', async () => {
  for (const data of [
    { build_target: 'hetzner', credentials: { HCLOUD_TOKEN: 'secret_backend.secret.token' } },
    { build_target: 'hetzner', hetzner: { token: 'gh.secret.TOKEN' } },
  ]) {
    const execution = run({ data, legacy: 'legacy-token', token: 'action-token' });
    await execution.execute();
    assert.equal(execution.vars.HCLOUD_TOKEN, 'action-token');
    assert.equal(execution.vars.HCLOUD_TOKEN_AVAILABLE, 'true');
    assert.equal(execution.outputs.source, 'resolved-ref');
    assert.ok(execution.masked.includes('action-token'));
  }
});

test('mapped credential unavailable from action never silently falls back to legacy token', async () => {
  const unresolved = run({ legacy: 'legacy-token', resolved: [] });
  await assert.rejects(unresolved.execute(), /Credential HCLOUD_TOKEN: mapped secret was not resolved/);
  const empty = run({ legacy: 'legacy-token', token: '' });
  await assert.rejects(empty.execute(), /Credential HCLOUD_TOKEN: mapped secret was not resolved/);
  assert.notEqual(empty.vars.HCLOUD_TOKEN, 'legacy-token');
});
