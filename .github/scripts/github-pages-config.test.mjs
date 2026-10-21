import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSiteUrl, resolvePagesConfig } from './github-pages-config.mjs';

const base = {
  data: { id: 'docs', type: 'github-pages-site-deploy', site_source_type: 'zensical' },
  env: { dry_run: false },
  repository: 'example/application',
  sha: '0123456789abcdef',
  eventName: 'push',
  runId: '42',
  runAttempt: '1',
};

test('publishes only with an explicit non-dry-run value, never on pull requests', () => {
  for (const dry_run of [true, 'true']) {
    assert.equal(resolvePagesConfig({ ...base, env: { dry_run } }).publish, 'false');
  }
  assert.equal(resolvePagesConfig({ ...base, env: {} }).publish, 'false');
  for (const dry_run of [false, 'false']) {
    assert.equal(resolvePagesConfig({ ...base, env: { dry_run } }).publish, 'true');
    for (const eventName of ['pull_request', 'pull_request_target']) {
      assert.equal(resolvePagesConfig({ ...base, eventName, env: { dry_run } }).publish, 'false');
    }
  }
  assert.throws(() => resolvePagesConfig({ ...base, env: { dry_run: 'maybe' } }), /dry_run/);
});

test('rejects destroy rather than publishing or deleting a repository-wide site', () => {
  for (const destroy of [true, 'true']) {
    assert.throws(() => resolvePagesConfig({ ...base, env: { destroy } }), /Destroy is not supported/);
    assert.throws(() => resolvePagesConfig({ ...base, data: { ...base.data, destroy } }), /Destroy is not supported/);
  }
});

test('resolves aliases and pinned external revisions without changing the destination repository', () => {
  const result = resolvePagesConfig({
    ...base,
    data: { ...base.data, source_repo: 'documentation' },
    externalRepos: { documentation: [{ repoURL: 'https://github.com/example/docs.git', targetRevision: 'v2', token: 'DOCS_TOKEN' }] },
  });
  assert.equal(result['source-repository'], 'example/docs');
  assert.equal(result['source-version'], 'v2');
  assert.equal(result['token-secret'], 'DOCS_TOKEN');
  assert.equal(result['site-url'], 'https://example.github.io/application/');
  assert.throws(() => resolvePagesConfig({ ...base, data: { ...base.data, source_repo: 'unknown' } }), /Unknown source_repo alias/);
  assert.throws(() => resolvePagesConfig({ ...base, data: { ...base.data, source_repo: 'example/docs' } }), /requires source_version/);
});

test('accepts existing GitHub URL forms and prefers the configured same-owner app identity', () => {
  for (const repoURL of ['github.com/example/docs.git', 'git@github.com:example/docs.git', 'https://github.com/example/docs/']) {
    const result = resolvePagesConfig({
      ...base,
      data: { ...base.data, source_repo: 'documentation' },
      externalRepos: { documentation: [{ repoURL, targetRevision: 'v2', token: 'DOCS_TOKEN', use_app_token: true }] },
    });
    assert.equal(result['source-repository'], 'example/docs');
    assert.equal(result['source-version'], 'v2');
    assert.equal(result['token-secret'], '');
  }
});

test('keeps the caller SHA for same-repository source and honors explicit source versions', () => {
  assert.equal(resolvePagesConfig(base)['source-version'], base.sha);
  assert.equal(resolvePagesConfig({ ...base, data: { ...base.data, source_version: 'release' } })['source-version'], 'release');
});

test('uses the root URL for organization sites and normalizes custom canonical URLs', () => {
  assert.equal(resolvePagesConfig({ ...base, repository: 'Example/example.github.io' })['site-url'], 'https://example.github.io/');
  assert.equal(resolvePagesConfig({ ...base, data: { ...base.data, site_url: 'https://docs.example.org/guide' } })['site-url'], 'https://docs.example.org/guide/');
  for (const value of ['javascript:alert(1)', 'https://user:password@example.org/', 'https://example.org/?query=1', 'https://example.org/#fragment']) {
    assert.throws(() => normalizeSiteUrl(value), /site_url/);
  }
});

test('rejects unsupported build targets instead of treating them as prebuilt content', () => {
  assert.throws(() => resolvePagesConfig({ ...base, data: { ...base.data, site_source_type: 'typo' } }), /Unsupported site_source_type/);
});

test('keeps archive versions confined to safe release paths in the destination repository', () => {
  for (const docs_version of ['latest', '../1.0.0', '1.0.0/extra', '1.0.0\n', 42, {}]) {
    assert.throws(() => resolvePagesConfig({ ...base, data: { ...base.data, docs_version } }), /docs_version/);
  }
  assert.throws(() => resolvePagesConfig({
    ...base,
    data: { ...base.data, docs_version: '1.0.0', source_repo: 'example/other', source_version: 'main' },
  }), /destination repository/);
  assert.throws(() => resolvePagesConfig({
    ...base,
    data: { ...base.data, docs_version: '1.0.0', site_source_type: 'prebuilt' },
  }), /requires Zensical/);
});

test('preview versions cannot be published even with publication explicitly enabled', () => {
  const options = { ...base, data: { ...base.data, docs_version: 'preview' } };
  assert.throws(() => resolvePagesConfig(options), /Preview documentation cannot be published/);
  assert.equal(resolvePagesConfig({ ...options, eventName: 'pull_request' }).publish, 'false');
});
