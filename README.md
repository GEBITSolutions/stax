![STAX Framework](.github/assets/banner.jpg 'STAX Framework')

<p align="center">
  <br/>
  <strong>STAX</strong> is an opinionated GitHub Actions framework &mdash;
  <br/>
  declare your stacks once, deploy cloud infrastructure and services together.
  <br/><br/>
</p>

<div align="center">

[![CLI](https://github.com/GEBITSolutions/stax/actions/workflows/cli.yml/badge.svg?branch=main)](https://github.com/GEBITSolutions/stax/actions/workflows/cli.yml)
[![Documentation](https://github.com/GEBITSolutions/stax/actions/workflows/docs.yml/badge.svg?branch=main)](https://github.com/GEBITSolutions/stax/actions/workflows/docs.yml)
[![License](https://img.shields.io/badge/License-GPL--3.0--only-blue.svg)](LICENSE)

</div>

## Install

The `stax` CLI needs Node.js 24 or later:

```bash
npm install -g @gebit/stax-cli
```

To run it from a checkout instead:

```bash
git clone https://github.com/GEBITSolutions/stax.git
cd stax/cli
npm install && npm run build && npm link
```

Then scaffold a repository, add a stack and check the result:

```bash
stax init
stax add
stax validate config
```

`stax init` writes a Deploy workflow that calls the reusable workflows in this repository, plus `configs/default.yaml` with every required deployment value listed next to its GitHub variable. See the [CLI reference](cli/README.md) for all commands and options.

## Documentation

The canonical [documentation site](docs/README.md) lives in `docs/`, including its Zensical configuration, locked dependencies, content, and assets. Start with [Configuration](docs/docs/configuration.md) and [Supported stack types](docs/docs/stack-types.md).

Preview from the repository root:

```sh
cd docs
uv sync --locked
uv run zensical serve --dev-addr 127.0.0.1:8017
```

Open <http://127.0.0.1:8017/>. To build the static site, run `uv run zensical build --clean` from `docs/`; output goes to `docs/site/`.

## Support

Having trouble? Open an [issue](https://github.com/GEBITSolutions/stax/issues).

## Directory

| Path | Contents |
| --- | --- |
| [cli](cli) | `@gebit/stax-cli`: the `stax` command (`init`, `add`, `validate config`) |
| [schema](schema) | JSON Schema for deploy configs, used by the CLI and by editors for completion |
| [.github/workflows](.github/workflows) | Reusable workflows: `a-wf-setup-ci.yml` reads the deploy config, `a-wf-deploy-levels.yml` deploys stacks level by level |
| [.github/actions](.github/actions) | Actions the workflows build on: deploy-config generation, stack inputs, versioning, static sites, Terraform |
| [configs](configs) | This repository's own deploy configs |
| [docs](docs) | Documentation site sources |

## Links

- [License (GPL-3.0-only)](LICENSE), except [`.github/actions/get-next-version-typescript-action`](.github/actions/get-next-version-typescript-action): a port of the MIT-licensed [thenativeweb/get-next-version](https://github.com/thenativeweb/get-next-version) that stays under the [MIT License](.github/actions/get-next-version-typescript-action/LICENSE).
- [Documentation](docs/README.md)
- [CLI reference](cli/README.md)
- [Deploy config schema](schema/deploy-config.schema.json)
