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
