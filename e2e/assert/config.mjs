// Checks the setup outputs of the config-resolution E2E (e2e-config.yml).
// Each run is passed as RUN_<NAME>_CONFIG (layer JSON), RUN_<NAME>_ENV (pipeline
// globals JSON) and RUN_<NAME>_LOCATION (default location).
import assert from 'node:assert/strict';

function run(name) {
  return {
    layers: JSON.parse(process.env[`RUN_${name}_CONFIG`]),
    env: JSON.parse(process.env[`RUN_${name}_ENV`]),
    location: process.env[`RUN_${name}_LOCATION`],
  };
}

const ids = layers => layers.map(layer => layer.map(stack => stack.id).sort());
const stack = (layers, id) => layers.flat().find(candidate => candidate.id === id);
const layerOf = (layers, id) => layers.findIndex(layer => layer.some(candidate => candidate.id === id));

// base + overlay, no filter
const all = run('ALL');
assert.equal(all.location, 'northeurope', 'the later config file wins for deployment values');
assert.deepEqual(
  { project: all.env.project, customer_id: all.env.customer_id, stage: all.env.stage, environment: all.env.environment, dry_run: all.env.dry_run },
  { project: 'stax-e2e', customer_id: 'e2e', stage: 'e2e', environment: 'e2e', dry_run: 'true' },
);
assert.equal(layerOf(all.layers, 'e2e-network'), 0);
assert.equal(layerOf(all.layers, 'e2e-cluster'), 1, 'explicit depends_on across config files');
assert.equal(layerOf(all.layers, 'e2e-app'), 2, 'implicit dependency through stack.e2e-cluster.var.endpoint');
assert.ok(stack(all.layers, 'e2e-app').depends_on.includes('e2e-cluster'));
assert.ok(stack(all.layers, 'e2e-cluster')['output-var'].includes('endpoint'), 'referenced output is registered on the producer');
assert.equal(stack(all.layers, 'e2e-network').config_globals.app_name, 'stax-e2e');
assert.equal(stack(all.layers, 'e2e-cluster').config_globals.app_name, 'stax-e2e-overlay', 'globals stay per config file');
assert.equal(stack(all.layers, 'e2e-prod-only'), undefined, 'false stack conditions exclude stacks even without a filter');
const allIds = all.layers.flat().map(candidate => candidate.id);
assert.equal(new Set(allIds).size, allIds.length, 'no stack is scheduled twice');

// overlay + base, filter group-core: e2e-prod-only is in the group but its if condition is false
const group = run('GROUP');
assert.equal(group.location, 'westeurope', 'reversed file order reverses deployment precedence');
assert.deepEqual(ids(group.layers), [['e2e-network']]);

// overlay + base, filter >e2e-app: the stack and everything it depends on
const upstream = run('UPSTREAM');
assert.deepEqual(ids(upstream.layers), [['e2e-network'], ['e2e-cluster'], ['e2e-app']]);

console.log('Config resolution checks passed');
