# STAX Framework documentation

The canonical [Zensical](https://zensical.org/) documentation site for **STAX Framework**, a modern open-source opinionated GitHub Workflow Framework to combine and deploy all of your cloud infrastructure and services, developed by [GEBIT Solutions](https://www.gebit.de/). Framework interfaces and examples currently remain illustrative.

## Preview

Install [uv](https://docs.astral.sh/uv/getting-started/installation/), then run from the repository's `docs/` folder:

```sh
uv sync --locked
uv run zensical serve --dev-addr 127.0.0.1:8017
```

Open <http://127.0.0.1:8017/>. Zensical reloads the preview when you edit the documentation.

## Build

```sh
uv run zensical build --clean
```

The static website is written to `site/`.

## Publish to GitHub Pages

The repository's `.github/workflows/docs.yml` selects `configs/stax-docs.yaml` and deploys through STAX's reusable setup, deployment levels, and `github-pages-site-deploy` stack workflow. This is independent of infrastructure and service configurations.

Pull requests build only. Changes on `main` publish automatically; the manual workflow's `dry-run` input builds without publishing, and manual runs on other branches remain build-only. The shared action installs the locked Zensical dependencies and overrides the canonical URL from Pages metadata without changing `zensical.toml`.

Enable repository Pages with **GitHub Actions** as its source before publishing. Configure the custom domain and HTTPS in repository Pages settings and protect the `github-pages` deployment environment. The `docs` environment only carries configuration/build metadata and needs no Azure credentials. Existing callers need `pages: write` and `id-token: write` available through the nested workflow chain; `stax init` generates the updated permissions.

## Files

- `zensical.toml`: site title, navigation, and light/dark themes.
- `docs/`: the existing landing page and supported stack types, plus title-only placeholders for Why STAX?, Installation, Your first config, Configuration, and Backends.
- `pyproject.toml` and `uv.lock`: documentation dependency and locked versions.
- `docs/assets/stax-logo.png` and `docs/assets/stax-favicon.png`: transparent header logo and favicon derived from the supplied Downloads image. The header symbol displays in white in dark mode through `docs/stylesheets/extra.css`.

## Design customization

The Astro-inspired layout uses neutral charcoal surfaces, a white homepage title, muted gray text, teal links, and a neutral gray active-navigation highlight. Dark mode is the initial theme for new visitors; the theme toggle also provides a light palette. `docs/stylesheets/extra.css` controls the header, search sizing, collapsible sidebar sections, indented child links, typography, responsive hero, and feature cards. No template overrides or custom JavaScript are required.

The slim parallelogram Get started button follows the teal theme accent. The transparent project logo remains white in dark mode and black in light mode. The previous red highlights, neon gradients, title backlight, and blue-gray surface overrides have been removed.

The homepage lives in `docs/index.md`; its hero and cards use semantic HTML inside the `stax-home` wrapper, with Markdown admonitions outside it. The supported technology checklist lives in `docs/stack-types.md`. Keep existing content when extending the navigation in `zensical.toml`; new sections currently use heading-only placeholder pages.
