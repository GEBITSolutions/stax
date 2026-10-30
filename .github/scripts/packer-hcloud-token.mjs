export async function resolveHcloudToken({ core, env = process.env, fetch = globalThis.fetch }) {
  const data = JSON.parse(env.DATA_JSON);
  const pipeline = JSON.parse(env.PIPELINE_ENV_JSON);
  const target = data.build_target ?? 'azure';
  if (target !== 'hetzner') {
    core.exportVariable('HCLOUD_TOKEN', '');
    core.exportVariable('HCLOUD_TOKEN_AVAILABLE', 'false');
    core.setOutput('source', 'unused');
    return;
  }

  const dryRun = pipeline.dry_run === undefined || pipeline.dry_run === true || pipeline.dry_run === 'true';
  const publish = (value, source) => {
    if (value) {
      core.setSecret(value);
      core.exportVariable('HCLOUD_TOKEN', value);
    }
    core.exportVariable('HCLOUD_TOKEN_AVAILABLE', value ? 'true' : 'false');
    core.setOutput('source', source);
  };
  if (dryRun) {
    publish('dry-run-not-a-token', 'dry-run');
    return;
  }

  const reference = data.hetzner?.token;
  if (reference === undefined) {
    publish(env.LEGACY_HCLOUD_TOKEN, 'github-secret');
    return;
  }
  const match = /^(secret_backend|gh)\.secret\.([A-Za-z0-9_]+)$/.exec(reference);
  if (!match) throw new Error('hetzner.token must be a secret_backend.secret.KEY or gh.secret.KEY reference');
  const [, namespace, key] = match;
  const backend = namespace === 'gh' ? 'gh' : (data.secret_backend ?? 'gh');
  if (backend !== 'gh' && backend !== 'vault') throw new Error('Invalid effective secret_backend');
  if (backend === 'gh') {
    const name = key.toUpperCase();
    const value = JSON.parse(env.SECRETS_JSON || '{}')[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`GitHub secret ${name} is missing or empty for hetzner.token`);
    }
    publish(value, 'resolved-ref');
    return;
  }

  if (!env.KEY_VAULT_URL) throw new Error('secret_backend is vault but REPO_KEYSTORE_KEY_VAULT_URL is not set');
  const vault = new URL(env.KEY_VAULT_URL);
  if (vault.protocol !== 'https:' || vault.username || vault.password || vault.pathname !== '/') {
    throw new Error('REPO_KEYSTORE_KEY_VAULT_URL must be an HTTPS vault origin');
  }
  const keystore = !!env.KEYSTORE_CLIENT_ID;
  const clientId = keystore ? env.KEYSTORE_CLIENT_ID : env.ARM_CLIENT_ID;
  const tenantId = keystore ? env.KEYSTORE_TENANT_ID : env.ARM_TENANT_ID;
  const oidc = (keystore ? env.KEYSTORE_OIDC_ENABLED : env.ARM_OIDC_ENABLED) === 'true';
  const clientSecret = keystore ? env.KEYSTORE_CLIENT_SECRET : env.ARM_CLIENT_SECRET;
  if (!clientId || !tenantId || (!oidc && !clientSecret)) {
    throw new Error('Key Vault service principal credentials are incomplete for hetzner.token');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    scope: 'https://vault.azure.net/.default',
    grant_type: 'client_credentials',
  });
  if (oidc) {
    const assertion = await core.getIDToken('api://AzureADTokenExchange');
    core.setSecret(assertion);
    body.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer');
    body.set('client_assertion', assertion);
  } else {
    body.set('client_secret', clientSecret);
  }
  const tokenResponse = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenResponse.ok) throw new Error(`Key Vault authentication failed (HTTP ${tokenResponse.status})`);
  const accessToken = (await tokenResponse.json()).access_token;
  if (!accessToken) throw new Error('Key Vault authentication did not return an access token');
  core.setSecret(accessToken);

  // Same convertKey rule as gh-convert-stack-inputs: env---key, lowercase, _ and . to -.
  const secretName = `${env.ENVIRONMENT}---${key}`.toLowerCase().replace(/[_.]/g, '-');
  const secretUrl = new URL(`secrets/${encodeURIComponent(secretName)}?api-version=7.4`, vault);
  const response = await fetch(secretUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Key Vault secret ${secretName} is missing or unavailable (HTTP ${response.status})`);
  const value = (await response.json()).value;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Key Vault secret ${secretName} is missing or empty`);
  }
  publish(value, 'resolved-ref');
}
