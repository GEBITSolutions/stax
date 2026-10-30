const CREDENTIAL_AWARE_STACK_TYPES = new Set(['terraform', 'opentofu', 'packer']);

export function validateEnvironment({ core, env = process.env }) {
  const skipCloudValidation = env.SKIP_AZURE_CREDENTIALS_VALIDATION === 'true';
  const oidcEnabled = env.OIDC_ENABLED === 'true';
  const cloud = env.CLOUD;
  const stacks = JSON.parse(env.LAYER_DEPLOYMENTS_JSON || '[]').flat();
  const mappedForEveryStack = name => stacks.length > 0 && stacks.every(stack => CREDENTIAL_AWARE_STACK_TYPES.has(stack.type) && stack.credentials?.[name] !== undefined);
  const staticAwsMapped = mappedForEveryStack('AWS_ACCESS_KEY_ID') && mappedForEveryStack('AWS_SECRET_ACCESS_KEY');
  const awsOidc = oidcEnabled && !staticAwsMapped;
  const requiredVars = skipCloudValidation || cloud === 'aws'
    ? [] : ['ARM_CLIENT_ID', 'ARM_TENANT_ID', 'ARM_SUBSCRIPTION_ID'];
  const requiredSecrets = skipCloudValidation ? [] : cloud === 'aws'
    ? (awsOidc ? ['AWS_ROLE_ARN'] : ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].filter(name => !mappedForEveryStack(name)))
    : (oidcEnabled ? [] : ['ARM_CLIENT_SECRET']);

  const missingVars = requiredVars.filter(name => !env[name]);
  const missingSecrets = requiredSecrets.filter(name => !env[name]);
  if (missingVars.length > 0) {
    core.setFailed(`Required environment variables are missing: ${missingVars.join(', ')}`);
  }
  if (missingSecrets.length > 0) {
    core.setFailed(`Required environment secrets are missing: ${missingSecrets.join(', ')}`);
  }
  if (cloud === 'aws' && awsOidc && (env.DEPLOYMENT_AWS_ENDPOINT_URL || env.DEPLOYMENT_AWS_ENDPOINT_URL_STS)) {
    core.setFailed('OIDC_ENABLED cannot be combined with aws_endpoint_url / aws_endpoint_url_sts. Use static AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY secrets for S3-compatible endpoints.');
  }
  if (cloud === 'aws' && env.STATE_USE_LOCKFILE === 'false') {
    core.warning('state_use_lockfile is false: Terraform state is not locked, so concurrent deployments of a stack can corrupt its state.');
  }
}
