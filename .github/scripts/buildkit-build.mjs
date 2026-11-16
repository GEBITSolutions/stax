import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const lines = value => (value || '').split('\n').map(line => line.trim()).filter(Boolean);

export function buildArguments({ address, context, platforms = [], tags, labels, secrets, noCache = false, dryRun = false }) {
  if (!address) throw new Error('BuildKit address is required');
  const names = lines(tags);
  if (!names.length) throw new Error('At least one image tag is required');
  const args = ['--addr', address, 'build', '--frontend', 'dockerfile.v0', '--local', `context=${context}`, '--local', `dockerfile=${context}`, '--opt', `platform=${(platforms.length ? platforms : ['linux/amd64']).join(',')}`];
  for (const label of lines(labels)) args.push('--opt', `label:${label}`);
  for (const secret of lines(secrets)) {
    const index = secret.indexOf('=');
    if (index < 1 || index === secret.length - 1) throw new Error('Invalid secret file mapping');
    args.push('--secret', `id=${secret.slice(0, index)},src=${secret.slice(index + 1)}`);
  }
  if (noCache) args.push('--no-cache');
  if (!dryRun) args.push('--output', `type=image,"name=${names.join(',')}",push=true`);
  return args;
}

function main(env) {
  const args = buildArguments({
    address: env.BUILDKIT_ADDRESS, context: env.BUILD_CONTEXT,
    platforms: JSON.parse(env.BUILD_PLATFORMS || '[]'), tags: env.BUILD_TAGS,
    labels: env.BUILD_LABELS, secrets: env.BUILD_SECRET_FILES,
    noCache: env.BUILD_NO_CACHE === 'true', dryRun: env.BUILD_DRY_RUN === 'true',
  });
  const dir = mkdtempSync(join(tmpdir(), 'stax-buildkit-'));
  try {
    const auths = {};
    if (env.REGISTRY_USERNAME && env.REGISTRY_PASSWORD) {
      const registry = env.REGISTRY_HOST.replace(/^https?:\/\//, '').split('/')[0];
      auths[registry] = { auth: Buffer.from(`${env.REGISTRY_USERNAME}:${env.REGISTRY_PASSWORD}`).toString('base64') };
    }
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ auths }), { mode: 0o600 });
    const childEnv = { ...env, DOCKER_CONFIG: dir };
    delete childEnv.REGISTRY_USERNAME;
    delete childEnv.REGISTRY_PASSWORD;
    const child = spawnSync('buildctl', args, { stdio: 'inherit', env: childEnv });
    if (child.error) throw child.error;
    if (child.status !== 0) process.exitCode = child.status || 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.env); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
