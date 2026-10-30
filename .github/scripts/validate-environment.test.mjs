import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from './validate-environment.mjs';

const credentials = {
  AWS_ACCESS_KEY_ID: 'secret_backend.secret.wasabi_access_key_id',
  AWS_SECRET_ACCESS_KEY: 'secret_backend.secret.wasabi_secret_access_key',
};
function validate(env, stacks = []) {
  const failures = [];
  const warnings = [];
  validateEnvironment({
    core: { setFailed: message => failures.push(message), warning: message => warnings.push(message) },
    env: { CLOUD: 'aws', LAYER_DEPLOYMENTS_JSON: JSON.stringify([stacks]), ...env },
  });
  return { failures, warnings };
}

test('mapped state keys need neither GitHub AWS secrets nor an AWS role with Azure OIDC enabled', () => {
  assert.deepEqual(validate({ OIDC_ENABLED: 'true', DEPLOYMENT_AWS_ENDPOINT_URL_STS: 'https://sts.wasabisys.com' }, [{ credentials }]), { failures: [], warnings: [] });
});

test('legacy static AWS requirements remain when no credentials are mapped', () => {
  const missing = validate({}, [{ id: 'legacy' }]);
  assert.match(missing.failures.join('\n'), /AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY/);
  assert.deepEqual(validate({ AWS_ACCESS_KEY_ID: 'legacy-id', AWS_SECRET_ACCESS_KEY: 'legacy-secret' }, [{ id: 'legacy' }]).failures, []);
});

test('a partial map needs only the remaining legacy static credential', () => {
  const stack = { credentials: { AWS_ACCESS_KEY_ID: credentials.AWS_ACCESS_KEY_ID } };
  const missing = validate({}, [stack]).failures.join('\n');
  assert.match(missing, /AWS_SECRET_ACCESS_KEY/);
  assert.doesNotMatch(missing, /AWS_ACCESS_KEY_ID/);
  assert.deepEqual(validate({ AWS_SECRET_ACCESS_KEY: 'legacy-secret' }, [stack]).failures, []);
});

test('a mapped stack cannot hide legacy credential requirements for a sibling', () => {
  assert.match(validate({}, [{ credentials }, { id: 'legacy' }]).failures.join('\n'), /AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY/);
});

test('legacy AWS OIDC still requires a role and rejects custom STS endpoints', () => {
  const missing = validate({ OIDC_ENABLED: 'true', DEPLOYMENT_AWS_ENDPOINT_URL_STS: 'https://sts.wasabisys.com' }, [{ id: 'legacy' }]);
  assert.match(missing.failures.join('\n'), /AWS_ROLE_ARN/);
  assert.match(missing.failures.join('\n'), /OIDC_ENABLED cannot be combined/);
  assert.deepEqual(validate({ OIDC_ENABLED: 'true', AWS_ROLE_ARN: 'arn:aws:iam::123:role/ci' }, [{ id: 'legacy' }]).failures, []);
});

test('Azure identity requirements and the unlocked-state warning remain unchanged', () => {
  assert.match(validate({ CLOUD: 'azure', OIDC_ENABLED: 'true' }).failures.join('\n'), /ARM_CLIENT_ID, ARM_TENANT_ID, ARM_SUBSCRIPTION_ID/);
  assert.deepEqual(validate({ CLOUD: 'azure', OIDC_ENABLED: 'true', ARM_CLIENT_ID: 'client', ARM_TENANT_ID: 'tenant', ARM_SUBSCRIPTION_ID: 'subscription' }).failures, []);
  assert.equal(validate({ STATE_USE_LOCKFILE: 'false' }, [{ credentials }]).warnings.length, 1);
});
