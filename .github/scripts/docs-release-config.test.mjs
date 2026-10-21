import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureDocsDeployment } from './docs-release-config.mjs';
import { resolvePagesConfig } from './github-pages-config.mjs';

const docs = { id: 'stax-docs', type: 'github-pages-site-deploy', site_source_type: 'zensical' };
const base = { layers: [[docs]], eventName: 'push', sha: 'triggering-sha' };
const resolve = (data, eventName = 'push') => resolvePagesConfig({
  data, env: { dry_run: false }, repository: 'example/docs', sha: base.sha,
  eventName, runId: '1', runAttempt: '1',
});

test('release documentation resolves to the prepared commit rather than the workflow source', () => {
  const [layer] = configureDocsDeployment({ ...base, releaseVersion: '1.3.0', sourceRef: 'prepared-release-sha' });
  assert.equal(resolve(layer[0])['source-version'], 'prepared-release-sha');
  assert.equal(resolve(layer[0])['docs-version'], '1.3.0');
});

test('manual deployment uses the published release tag, never its mutable target branch', () => {
  const [layer] = configureDocsDeployment({
    ...base, eventName: 'workflow_dispatch', latestRelease: { tag_name: '1.2.0', target_commitish: 'main' },
  });
  assert.equal(resolve(layer[0])['source-version'], '1.2.0');
  assert.throws(() => configureDocsDeployment({ ...base, eventName: 'workflow_dispatch' }), /requires a release/);
});

test('pull requests cannot select a published release or override the preview source', () => {
  for (const eventName of ['pull_request', 'pull_request_target']) {
    const [layer] = configureDocsDeployment({ ...base, eventName, releaseVersion: '1.2.0', sourceRef: 'untrusted-ref' });
    const result = resolve(layer[0], eventName);
    assert.equal(result['docs-version'], 'preview');
    assert.equal(result['source-version'], base.sha);
    assert.equal(result.publish, 'false');
  }
});

test('rejects incomplete or unsafe release identities instead of deploying an unversioned site', () => {
  for (const releaseVersion of ['preview', 'latest', '../1.2.0', '1.2.0\n']) {
    assert.throws(() => configureDocsDeployment({ ...base, releaseVersion }), /Preview|docs_version/);
  }
  assert.throws(() => configureDocsDeployment({ ...base, sourceRef: 'unlabelled-source' }), /requires a release/);
  for (const layers of [[], [[docs, docs]], [[{ ...docs, site_source_type: 'prebuilt' }]]]) {
    assert.throws(() => configureDocsDeployment({ ...base, layers, releaseVersion: '1.2.0' }), /exactly one|must use/);
  }
});
