# stax

Stack framework for GitHub Actions: reusable workflows and actions that deploy stacks (OpenTofu/Terraform, Packer, Docker, static sites, scripts) declared in a deploy config.

## Documentation

The canonical [documentation site](docs/README.md) lives in `docs/`, including its Zensical configuration, locked dependencies, content, and assets.

Preview from the repository root:

```sh
cd docs
uv sync --locked
uv run zensical serve --dev-addr 127.0.0.1:8017
```

Open <http://127.0.0.1:8017/>. To build the static site, run `uv run zensical build --clean` from `docs/`; output goes to `docs/site/`.

## GitHub Pages sites

Use `type: github-pages-site-deploy` to publish a static site to the **calling repository's** GitHub Pages site. The framework builds the site with the existing shared static-site build action, uploads a Pages artifact, and deploys it through the protected `github-pages` environment.

STAX's own documentation has a dedicated configuration, `configs/stax-docs.yaml`, selected by `.github/workflows/docs.yml` through the standard setup → deployment levels → stack dispatcher chain. Pull requests and manual dry runs build and upload the site without publishing. Changes on `main` publish; manual runs from other branches remain build-only.

```yaml
stacks:
  - id: documentation
    name: Documentation
    type: github-pages-site-deploy
    site_source_type: zensical
    docs_path: docs
    depends_on: []
```

| Stack field | Behavior |
| --- | --- |
| `site_source_type` | `mkdocs` (default), `zensical`, or `prebuilt`. Unknown values fail. |
| `docs_path` | Repository-relative generator project directory; defaults to `docs`. |
| `app_location` | Optional repository-relative output directory; defaults to `<docs_path>/site`. For `prebuilt`, this directory must already exist. |
| `site_url` | Optional canonical URL override. Publishing otherwise uses Pages metadata, including its configured custom domain. Dry runs default to the repository's `github.io` URL. |
| `source_repo`, `source_version` | Existing source selection: the caller repository by default, an `owner/repo`, or an `externalRepos` alias. External source repositories need a revision; aliases may supply `targetRevision`. Publishing still targets the caller repository. |

MkDocs projects supply `mkdocs.yml`/`mkdocs.yaml` and `requirements.txt`. Zensical projects supply `zensical.toml`, `pyproject.toml`, and `uv.lock`; the build uses `uv sync --locked`. Both generators apply URL and output overrides without modifying the checked-in configuration. Existing SWA and S3 consumers use the same build action. The Linux runner needs Python/uv installation support; the composite action installs Python 3.12 and installs uv for generator builds.

Only one Pages stack is allowed in a merged deployment configuration: GitHub Pages hosts one site per repository. Publishing jobs serialize by repository. `destroy=true` fails rather than deleting the repository-wide site. No Azure credentials or deployment PAT are required for same-repository publishing; optional private source access uses the existing repository secret/GitHub App token mechanism.

### Caller permissions and repository setup

The complete reusable-workflow chain must allow `pages: write` and `id-token: write`. Existing deploy callers upgrading to this framework version must add `pages: write`; skipped jobs do not bypass GitHub's nested-workflow permission validation. `stax init` generates the updated permissions. The existing dispatcher also contains package-producing jobs, so its callers retain the existing `actions: read`, `contents: read`, and `packages: write` permissions. The Pages build job narrows its own token to read access; only its deployment job gets Pages write and OIDC permissions.

Before the first publish, enable **Settings → Pages → GitHub Actions** in the calling repository. Configure `github-pages` environment branch restrictions and any required reviewers there. STAX does not enable Pages or change domain settings during deployment. The documentation caller uses a separate `docs` environment for configuration/build metadata so production Pages approvals apply only to publishing.

For a custom hostname, verify ownership with GitHub, add the hostname in Pages settings, then point its DNS CNAME to `<owner>.github.io` without a repository path. Enable HTTPS after GitHub provisions the certificate. Actions deployment does not require a source `CNAME` file. An explicit `site_url` is useful when a PR build must use the final custom-domain URL before publishing is enabled.

The reusable Pages workflow is `.github/workflows/a-wf-deploy-stack-github-pages-site.yml`; its `site-url` output is the deployed URL, or the canonical build URL for dry runs. Build artifacts use stack/run/attempt-specific names. No per-PR Pages preview site or cross-repository publishing is created.
