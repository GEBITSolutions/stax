export async function resolveHcloudToken({ core, env = process.env }) {
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

  const mapped = data.hetzner?.token !== undefined || data.credentials?.HCLOUD_TOKEN !== undefined;
  if (!mapped) {
    publish(env.LEGACY_HCLOUD_TOKEN, 'github-secret');
    return;
  }

  const resolved = JSON.parse(env.RESOLVED_CREDENTIALS_JSON || '[]');
  if (!Array.isArray(resolved) || !resolved.includes('HCLOUD_TOKEN') || !env.HCLOUD_TOKEN) {
    throw new Error('Credential HCLOUD_TOKEN: mapped secret was not resolved');
  }
  publish(env.HCLOUD_TOKEN, 'resolved-ref');
}
