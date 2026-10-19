import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDeploymentContext } from './deployment-config.mjs';

const azure = {
  project: 'widget',
  customer_id: 'acme',
  stage: 'dev',
  cloud: 'Azure',
  default_location: 'northeurope',
  public_cloud_flag: true,
  resource_group_name: 'rg-widget',
  dns_zone_name: 'example.org',
  dns_zone_resource_group_name: 'rg-dns',
  state_storage_account_name: 'ST-Acme_Widget',
  state_container_name: 'terraform',
  state_resource_group_name: 'rg-state',
};

function resolve(deployment = azure, options = {}) {
  return resolveDeploymentContext({ documents: [{ sourceFile: 'configs/service.yaml', deployment }], ...options });
}

test('exports all deployment fields as strings, normalizing cloud and Azure storage names', () => {
  assert.deepEqual(resolve(), {
    PROJECT: 'widget',
    CUSTOMER_ID: 'acme',
    STAGE: 'dev',
    CLOUD: 'azure',
    DEFAULT_LOCATION: 'northeurope',
    RESOURCE_GROUP_NAME: 'rg-widget',
    PUBLIC_CLOUD_FLAG: 'true',
    DNS_ZONE_NAME: 'example.org',
    DNS_ZONE_RESOURCE_GROUP_NAME: 'rg-dns',
    STATE_STORAGE_ACCOUNT_NAME: 'stacmewidget',
    STATE_CONTAINER_NAME: 'terraform',
    STATE_RESOURCE_GROUP_NAME: 'rg-state',
    STATE_BUCKET_NAME: '',
    STATE_REGION: '',
  });
});

test('merges selected mappings in order before falling back to GitHub variables', () => {
  const context = resolveDeploymentContext({
    documents: [
      {
        sourceFile: 'configs/first.yaml',
        deployment: { ...azure, stage: 'selected-first', project: 'first', state_container_name: 'first', dns_zone_name: 'first.example.org' },
      },
      {
        sourceFile: 'configs/second.yaml',
        deployment: { stage: 'selected-second', project: '', state_container_name: null, public_cloud_flag: false },
      },
    ],
    variables: { project: 'from-var', PROJECT: 'uppercase-var', STAGE: 'var-stage', STATE_CONTAINER_NAME: 'var-container', PUBLIC_CLOUD_FLAG: 'true' },
  });
  assert.equal(context.PROJECT, 'first');
  assert.equal(context.STAGE, 'selected-second');
  assert.equal(context.STATE_CONTAINER_NAME, 'first');
  assert.equal(context.DNS_ZONE_NAME, 'first.example.org');
  assert.equal(context.PUBLIC_CLOUD_FLAG, 'false');
  assert.equal(resolve({ ...azure, project: '' }, { variables: { project: 'lowercase-var', PROJECT: 'uppercase-var' } }).PROJECT, 'lowercase-var');
  assert.equal(resolve({ ...azure, project: '' }, { variables: { PROJECT: 'uppercase-var' } }).PROJECT, 'uppercase-var');
  assert.equal(resolve({ ...azure, state_container_name: null }, { variables: { STATE_CONTAINER_NAME: 'from-var' } }).STATE_CONTAINER_NAME, 'from-var');
});

test('allows absent deployment mappings with complete GitHub variables, without inventing defaults', () => {
  const variables = Object.fromEntries(Object.entries(azure).map(([key, value]) => [key.toUpperCase(), String(value)]));
  const context = resolveDeploymentContext({ documents: [{ sourceFile: 'empty.yaml' }, { sourceFile: 'null.yaml', deployment: null }], variables });
  assert.equal(context.PROJECT, 'widget');
  assert.equal(context.CLOUD, 'azure');
  assert.equal(context.STATE_STORAGE_ACCOUNT_NAME, 'stacmewidget');
  assert.throws(() => resolveDeploymentContext({ documents: [] }), /deployment\.project.*GitHub variable PROJECT/);
});

test('preserves explicit false and requires all common fields even when cloud validation is skipped', () => {
  assert.equal(resolve({ ...azure, public_cloud_flag: false }).PUBLIC_CLOUD_FLAG, 'false');
  assert.equal(resolve({ ...azure, public_cloud_flag: null }, { variables: { PUBLIC_CLOUD_FLAG: 'false' } }).PUBLIC_CLOUD_FLAG, 'false');
  const pages = resolve({ project: 'docs', customer_id: 'acme', stage: 'dev', cloud: 'AWS', default_location: 'eu-west-1', public_cloud_flag: false }, { skipCloudValidation: true });
  assert.equal(pages.PUBLIC_CLOUD_FLAG, 'false');
  assert.equal(pages.STATE_BUCKET_NAME, '');
  assert.equal(pages.STATE_STORAGE_ACCOUNT_NAME, '');
  for (const field of ['project', 'customer_id', 'stage', 'cloud', 'default_location', 'public_cloud_flag']) {
    assert.throws(() => resolve({ ...azure, [field]: null }, { skipCloudValidation: true }), new RegExp(`deployment\\.${field}.*GitHub variable ${field.toUpperCase()}`));
  }
});

test('requires only the selected cloud state fields for non-Pages deployments', () => {
  const aws = { project: 'api', customer_id: 'acme', stage: 'prod', cloud: 'AWS', default_location: 'eu-west-1', public_cloud_flag: 'false', state_bucket_name: 'state-bucket', state_region: 'eu-west-1' };
  assert.equal(resolve(aws).CLOUD, 'aws');
  assert.equal(resolve(aws).STATE_STORAGE_ACCOUNT_NAME, '');
  for (const field of ['state_bucket_name', 'state_region']) {
    assert.throws(() => resolve({ ...aws, [field]: '' }), new RegExp(`deployment\\.${field}.*GitHub variable ${field.toUpperCase()}`));
  }
  for (const field of ['resource_group_name', 'dns_zone_name', 'dns_zone_resource_group_name', 'state_storage_account_name', 'state_container_name', 'state_resource_group_name']) {
    assert.throws(() => resolve({ ...azure, [field]: '' }), new RegExp(`deployment\\.${field}.*GitHub variable ${field.toUpperCase()}`));
  }
  assert.equal(resolve({ ...azure, state_container_name: '' }, { variables: { STATE_CONTAINER_NAME: 'shared-state' } }).STATE_CONTAINER_NAME, 'shared-state');
  assert.equal(resolve({ ...azure, state_container_name: '' }, { skipCloudValidation: true }).STATE_CONTAINER_NAME, '');
});

test('rejects invalid mappings, keys, values, clouds and unsafe workflow environment strings', () => {
  for (const deployment of [[], 'wrong', false, 7]) {
    assert.throws(() => resolve(deployment), /deployment must be a mapping/);
  }
  assert.throws(() => resolve({ ...azure, surprise: 'value' }), /unknown deployment key 'surprise'/);
  for (const value of [1, false, [], {}]) {
    assert.throws(() => resolve({ ...azure, stage: value }), /deployment\.stage must be a string/);
  }
  for (const value of [1, 'TRUE', 'yes', '0', {}]) {
    assert.throws(() => resolve({ ...azure, public_cloud_flag: value }), /public_cloud_flag must be a boolean or/);
  }
  assert.throws(() => resolve({ ...azure, cloud: 'gcp' }), /cloud.*azure.*aws/);
  assert.throws(() => resolve({ ...azure, stage: 'dev\ninjected=1' }), /stage must not contain newlines/);
  assert.throws(() => resolve({ ...azure, stage: '\n' }), /stage must not contain newlines/);
  assert.throws(() => resolve({ ...azure, project: null }, { variables: { project: '\n', PROJECT: 'valid' } }), /GitHub variable PROJECT.*newlines/);
  assert.throws(() => resolve({ ...azure, project: null }, { variables: { PROJECT: 'bad\rname' } }), /GitHub variable PROJECT.*newlines/);
  assert.throws(() => resolve({ ...azure, project: null }, { variables: { PROJECT: 3 } }), /GitHub variable PROJECT.*string/);
  assert.throws(() => resolve({ ...azure, public_cloud_flag: null }, { variables: { PUBLIC_CLOUD_FLAG: 'invalid' } }), /GitHub variable PUBLIC_CLOUD_FLAG.*boolean/);
});

test('enforces normalized Azure account length without truncating or deriving a fallback', () => {
  for (const name of ['A!', 'a'.repeat(25), '---']) {
    assert.throws(() => resolve({ ...azure, state_storage_account_name: name }), /STATE_STORAGE_ACCOUNT_NAME.*3-24/);
  }
  assert.throws(() => resolve({ ...azure, state_storage_account_name: '---' }, { skipCloudValidation: true }), /STATE_STORAGE_ACCOUNT_NAME.*3-24/);
  assert.equal(resolve({ ...azure, state_storage_account_name: 'A'.repeat(24) }).STATE_STORAGE_ACCOUNT_NAME, 'a'.repeat(24));
  assert.equal(resolve({ ...azure, state_storage_account_name: 'A-2c!' }).STATE_STORAGE_ACCOUNT_NAME, 'a2c');
});
