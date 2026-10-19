function enabled(value) {
  return value === true || value === 'true';
}

export function normalizeSiteUrl(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('site_url must be an HTTP(S) URL without credentials, query, or fragment');
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}

export function resolvePagesConfig({ data, env, externalRepos = {}, repository, sha, eventName, runId, runAttempt, stackRepository = '', stackVersion = '' }) {
  if (data.type !== 'github-pages-site-deploy') {
    throw new Error('Expected stack type github-pages-site-deploy');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(data.id ?? '')) {
    throw new Error('Pages stack id must contain only letters, numbers, dots, underscores, and hyphens');
  }
  if (enabled(env.destroy) || enabled(data.destroy)) {
    throw new Error('Destroy is not supported for github-pages-site-deploy; manage repository Pages settings separately');
  }
  const sourceType = data.site_source_type ?? 'mkdocs';
  if (!['mkdocs', 'zensical', 'prebuilt'].includes(sourceType)) {
    throw new Error(`Unsupported site_source_type: ${sourceType}`);
  }

  const requestedSource = stackRepository || data.source_repo || repository;
  let sourceRepository = requestedSource;
  let sourceRevision = '';
  let tokenSecret = '';
  if (!requestedSource.includes('/')) {
    const entry = externalRepos[requestedSource]?.[0];
    if (!entry) throw new Error(`Unknown source_repo alias: ${requestedSource}`);
    const match = /^(?:(?:https:\/\/)?github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(entry.repoURL ?? '');
    if (!match) throw new Error(`Invalid GitHub repoURL for source_repo alias: ${requestedSource}`);
    sourceRepository = match[1];
    tokenSecret = enabled(entry.use_app_token) && sourceRepository.split('/')[0] === repository.split('/')[0]
      ? ''
      : entry.token ?? '';
    sourceRevision = entry.targetRevision ?? '';
  }
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(sourceRepository)) {
    throw new Error('source_repo must be an owner/repository or a configured external repository alias');
  }
  const revision = stackVersion || data.source_version || sourceRevision || (sourceRepository === repository ? sha : '');
  if (!revision) throw new Error('An external source repository requires source_version or externalRepos.targetRevision');

  const [owner, name] = repository.split('/');
  const basePath = name.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : `${name}/`;
  const siteUrl = normalizeSiteUrl(data.site_url || `https://${owner.toLowerCase()}.github.io/${basePath}`);
  const dryRun = env.dry_run ?? true;
  if (![true, false, 'true', 'false'].includes(dryRun)) throw new Error('dry_run must be a boolean or true/false string');
  const publish = !enabled(dryRun) && !['pull_request', 'pull_request_target'].includes(eventName);
  return {
    'source-repository': sourceRepository,
    'source-version': revision,
    'source-owner': sourceRepository.split('/')[0],
    'source-name': sourceRepository.split('/')[1],
    'token-secret': tokenSecret,
    'source-type': sourceType,
    'site-url': siteUrl,
    'artifact-name': `github-pages-${data.id}-${runId}-${runAttempt}`,
    publish: String(publish),
  };
}
