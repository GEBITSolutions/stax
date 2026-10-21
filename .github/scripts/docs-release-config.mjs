import { validateDocsVersion } from './github-pages-config.mjs';

// Release calls supply the prepared commit; manual replays default to a release tag.
export function configureDocsDeployment({ layers, releaseVersion = '', sourceRef = '', sha, eventName, latestRelease }) {
  const preview = ['pull_request', 'pull_request_target'].includes(eventName);
  let version;
  let revision;
  if (preview) {
    version = 'preview';
    revision = sha;
  } else {
    version = releaseVersion || latestRelease?.tag_name;
    if (!version || (!releaseVersion && sourceRef)) {
      throw new Error('Documentation publication requires a release version and source revision or a latest published release');
    }
    validateDocsVersion(version);
    if (version === 'preview') throw new Error('Preview documentation cannot be published as a release');
    revision = sourceRef || version;
  }
  if (!revision) throw new Error('Documentation source revision is required');

  let selected = 0;
  const configured = layers.map(layer => layer.map(stack => {
    if (stack.id !== 'stax-docs') return stack;
    if (stack.type !== 'github-pages-site-deploy' || stack.site_source_type !== 'zensical') {
      throw new Error('The stax-docs stack must use the Zensical GitHub Pages deployment');
    }
    selected++;
    return { ...stack, docs_version: version, source_version: revision };
  }));
  if (selected !== 1) throw new Error('Expected exactly one stax-docs deployment stack');
  return configured;
}
