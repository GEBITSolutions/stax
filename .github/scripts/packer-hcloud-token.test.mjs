import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Run the actual pre-checkout github-script body, with GitHub Core and HTTP replaced
// by deterministic fakes. A separate helper cannot be loaded before checkout.
const workflow = readFileSync(new URL('../workflows/a-wf-deploy-stack-packer.yml', import.meta.url), 'utf8');
const step = workflow.split('    - name: Resolve Hetzner token before preflight\n')[1]
  .split('    - name: Validate request before checkout\n')[0];
const script = step.split('        script: |\n')[1].split('\n')
  .map((line) => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const resolve = new AsyncFunction('core', 'fetch', 'process', script);

function run({
  data = { build_target: 'hetzner', hetzner: { token: 'secret_backend.secret.hcloud_token' }, secret_backend: 'vault' },
  pipeline = { dry_run: false }, secrets = {}, legacy = '', keystore = true, oidc = true,
  vaultValue = 'vault-token', authStatus = 200, vaultStatus = 200,
} = {}) {
  const vars = {
    DATA_JSON: JSON.stringify(data), PIPELINE_ENV_JSON: JSON.stringify(pipeline),
    SECRETS_JSON: JSON.stringify(secrets), LEGACY_HCLOUD_TOKEN: legacy,
    ENVIRONMENT: 'Prod_01', KEY_VAULT_URL: 'https://test.vault.azure.net/',
    KEYSTORE_CLIENT_ID: keystore ? 'keystore-id' : '', KEYSTORE_TENANT_ID: 'keystore-tenant',
    KEYSTORE_CLIENT_SECRET: 'keystore-secret', KEYSTORE_OIDC_ENABLED: oidc ? 'true' : 'false',
    ARM_CLIENT_ID: 'arm-id', ARM_TENANT_ID: 'arm-tenant',
    ARM_CLIENT_SECRET: 'arm-secret', ARM_OIDC_ENABLED: oidc ? 'true' : 'false',
  };
  const outputs = {}, masked = [], requests = [], assertions = [];
  const core = {
    setOutput: (key, value) => { outputs[key] = value; },
    setSecret: (value) => { masked.push(value); },
    exportVariable: (key, value) => { vars[key] = value; },
    getIDToken: async (audience) => { assertions.push(audience); return 'oidc-assertion'; },
  };
  const fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) return new Response(JSON.stringify({ access_token: 'azure-access-token' }), { status: authStatus });
    return new Response(JSON.stringify({ value: vaultValue }), { status: vaultStatus });
  };
  return { execute: () => resolve(core, fetch, { env: vars }), vars, outputs, masked, requests, assertions };
}

test('dry run uses placeholder without touching OIDC, vault or legacy secret', async () => {
  const execution = run({ legacy: 'legacy', pipeline: { dry_run: true } });
  await execution.execute();
  assert.equal(execution.vars.HCLOUD_TOKEN, 'dry-run-not-a-token');
  assert.equal(execution.vars.HCLOUD_TOKEN_AVAILABLE, 'true');
  assert.equal(execution.outputs.source, 'dry-run');
  assert.deepEqual(execution.requests, []);
  assert.deepEqual(execution.assertions, []);
});

test('non-Hetzner does not resolve a token', async () => {
  const execution = run({ data: { build_target: 'azure' } });
  await execution.execute();
  assert.equal(execution.outputs.source, 'unused');
  assert.equal(execution.vars.HCLOUD_TOKEN, '');
  assert.equal(execution.vars.HCLOUD_TOKEN_AVAILABLE, 'false');
  assert.deepEqual(execution.requests, []);
});

test('unset reference retains legacy GitHub Environment token and availability gate', async () => {
  const execution = run({ data: { build_target: 'hetzner', hetzner: {} }, legacy: 'legacy-token' });
  await execution.execute();
  assert.equal(execution.vars.HCLOUD_TOKEN, 'legacy-token');
  assert.equal(execution.vars.HCLOUD_TOKEN_AVAILABLE, 'true');
  assert.equal(execution.outputs.source, 'github-secret');
  assert.ok(execution.masked.includes('legacy-token'));
  assert.deepEqual(execution.requests, []);
  const missing = run({ data: { build_target: 'hetzner' } });
  await missing.execute();
  assert.equal(missing.vars.HCLOUD_TOKEN_AVAILABLE, 'false');
});

test('GitHub reference uses selected secret only, even when effective backend is vault', async () => {
  const execution = run({ data: { build_target: 'hetzner', hetzner: { token: 'gh.secret.other_token' }, secret_backend: 'vault' }, secrets: { OTHER_TOKEN: 'github-token' } });
  await execution.execute();
  assert.equal(execution.vars.HCLOUD_TOKEN, 'github-token');
  assert.equal(execution.outputs.source, 'resolved-ref');
  assert.ok(execution.masked.includes('github-token'));
  assert.deepEqual(execution.requests, []);
  const missing = run({ data: { build_target: 'hetzner', hetzner: { token: 'gh.secret.other_token' }, secret_backend: 'vault' }, legacy: 'legacy-token' });
  await assert.rejects(missing.execute(), /GitHub secret OTHER_TOKEN is missing or empty/);
  assert.equal(missing.vars.HCLOUD_TOKEN, undefined);
  assert.deepEqual(missing.requests, []);
});

test('secret_backend gh reads GitHub only and rejects empty despite a legacy token', async () => {
  const data = { build_target: 'hetzner', hetzner: { token: 'secret_backend.secret.hcloud_token' }, secret_backend: 'gh' };
  const found = run({ data, secrets: { HCLOUD_TOKEN: 'explicit-token' } });
  await found.execute();
  assert.equal(found.vars.HCLOUD_TOKEN, 'explicit-token');
  assert.deepEqual(found.requests, []);
  const missing = run({ data, secrets: { HCLOUD_TOKEN: '' }, legacy: 'legacy-token' });
  await assert.rejects(missing.execute(), /GitHub secret HCLOUD_TOKEN is missing or empty/);
  assert.equal(missing.vars.HCLOUD_TOKEN, undefined);
});

test('vault reference uses environment-prefixed converted key and Keystore OIDC', async () => {
  const execution = run({ secrets: { HCLOUD_TOKEN: 'not-this-token' }, legacy: 'legacy-token' });
  await execution.execute();
  assert.equal(execution.vars.HCLOUD_TOKEN, 'vault-token');
  assert.equal(execution.vars.HCLOUD_TOKEN_AVAILABLE, 'true');
  assert.equal(execution.outputs.source, 'resolved-ref');
  assert.deepEqual(execution.assertions, ['api://AzureADTokenExchange']);
  assert.ok(execution.requests[0].url.includes('/keystore-tenant/oauth2/v2.0/token'));
  assert.equal(execution.requests[0].options.body.get('client_id'), 'keystore-id');
  assert.equal(execution.requests[0].options.body.get('client_assertion'), 'oidc-assertion');
  assert.equal(execution.requests[1].url, 'https://test.vault.azure.net/secrets/prod-01---hcloud-token?api-version=7.4');
  assert.equal(execution.requests[1].options.headers.Authorization, 'Bearer azure-access-token');
  assert.ok(execution.masked.includes('oidc-assertion'));
  assert.ok(execution.masked.includes('azure-access-token'));
  assert.ok(execution.masked.includes('vault-token'));
});

test('ARM service-principal client secret path when Keystore SP is unset', async () => {
  const execution = run({ keystore: false, oidc: false });
  await execution.execute();
  assert.deepEqual(execution.assertions, []);
  assert.ok(execution.requests[0].url.includes('/arm-tenant/oauth2/v2.0/token'));
  assert.equal(execution.requests[0].options.body.get('client_id'), 'arm-id');
  assert.equal(execution.requests[0].options.body.get('client_secret'), 'arm-secret');
  assert.equal(execution.vars.HCLOUD_TOKEN, 'vault-token');
});

test('missing vault secret, absent vault URL or failed auth never fall back to GitHub', async () => {
  const empty = run({ vaultValue: '', legacy: 'legacy-token', secrets: { HCLOUD_TOKEN: 'github-token' } });
  await assert.rejects(empty.execute(), /Key Vault secret prod-01---hcloud-token is missing or empty/);
  assert.equal(empty.vars.HCLOUD_TOKEN, undefined);
  const missing = run({ vaultStatus: 404, legacy: 'legacy-token' });
  await assert.rejects(missing.execute(), /Key Vault secret prod-01---hcloud-token is missing or unavailable \(HTTP 404\)/);
  const noVault = run({ legacy: 'legacy-token' });
  noVault.vars.KEY_VAULT_URL = '';
  await assert.rejects(noVault.execute(), /REPO_KEYSTORE_KEY_VAULT_URL is not set/);
  assert.deepEqual(noVault.requests, []);
  const badAuth = run({ authStatus: 401, legacy: 'legacy-token' });
  await assert.rejects(badAuth.execute(), /Key Vault authentication failed \(HTTP 401\)/);
  assert.equal(badAuth.requests.length, 1);
});
