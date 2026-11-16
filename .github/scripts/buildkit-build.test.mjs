import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildArguments } from './buildkit-build.mjs';

test('maps tags, labels, platforms and secret files to buildctl without shell interpolation', () => {
  const args = buildArguments({ address: 'unix:///tmp/buildkit.sock', context: 'app dir', platforms: ['linux/amd64'], tags: 'registry.example/app:sha\nregistry.example/app:latest', labels: 'org.example.title=My app', secrets: 'token=/tmp/token', noCache: true, dryRun: false });
  assert.deepEqual(args, ['--addr', 'unix:///tmp/buildkit.sock', 'build', '--frontend', 'dockerfile.v0', '--local', 'context=app dir', '--local', 'dockerfile=app dir', '--opt', 'platform=linux/amd64', '--opt', 'label:org.example.title=My app', '--secret', 'id=token,src=/tmp/token', '--no-cache', '--output', 'type=image,"name=registry.example/app:sha,registry.example/app:latest",push=true']);
});

test('dry run builds without publishing images', () => {
  const args = buildArguments({ address: 'unix:///tmp/buildkit.sock', context: '.', platforms: [], tags: 'registry.example/app:sha', labels: '', secrets: '', dryRun: true });
  assert.equal(args.includes('--output'), false);
  assert.ok(args.includes('platform=linux/amd64'));
});

test('rejects missing address, tags, and malformed secret mappings', () => {
  assert.throws(() => buildArguments({ context: '.', tags: 'x' }), /address/i);
  assert.throws(() => buildArguments({ address: 'unix:///x', context: '.', tags: '' }), /tag/i);
  assert.throws(() => buildArguments({ address: 'unix:///x', context: '.', tags: 'x', secrets: 'invalid' }), /secret/i);
});

test('executes buildctl with a temporary registry config and removes it on failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buildkit-test-'));
  try {
    const bin = join(dir, 'buildctl');
    const output = join(dir, 'observed.json');
    writeFileSync(bin, '#!/usr/bin/env node\nconst fs = require("node:fs"); fs.writeFileSync(process.env.TEST_OUTPUT, JSON.stringify({args: process.argv.slice(2), config: JSON.parse(fs.readFileSync(process.env.DOCKER_CONFIG + "/config.json")), credentialEnv: process.env.REGISTRY_PASSWORD || ""})); process.exit(7);\n', { mode: 0o755 });
    const script = fileURLToPath(new URL('./buildkit-build.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [script], { env: { ...process.env, TMPDIR: dir, PATH: `${dir}:${process.env.PATH}`, TEST_OUTPUT: output, BUILDKIT_ADDRESS: 'unix:///tmp/buildkit.sock', BUILD_CONTEXT: '.', BUILD_TAGS: 'registry.example/app:sha', BUILD_DRY_RUN: 'false', REGISTRY_HOST: 'registry.example', REGISTRY_USERNAME: 'user', REGISTRY_PASSWORD: 'test-password' }, encoding: 'utf8' });
    assert.equal(child.status, 7);
    const observed = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(observed.config.auths['registry.example'].auth, Buffer.from('user:test-password').toString('base64'));
    assert.equal(observed.credentialEnv, '');
    assert.equal(readdirSync(dir).some(name => name.startsWith('stax-buildkit-')), false);
    assert.doesNotMatch(child.stdout + child.stderr, /test-password/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
