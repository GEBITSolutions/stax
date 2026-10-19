# github-action-typescript-template

A template to kickstart github actions written in typescript.

This action runs on Node.js 24. Use Node.js 24 and npm 11 for local development.
Tests mock GitHub workflow warnings so fixture diagnostics do not create Actions
annotations; the deployed action still emits configuration warnings.

## Run Tests

To execute tests install `dependencies` and `prebuild` once before starting the
tests.

```bash
npm ci
npm run prebuild
npm run ci-test
```

## Build local

To execute tests install `dependencies` and `prebuild` once before starting the
`package` build or use `package:watch` to build on changes. Build files will be
located under `/dist`.

```bash
npm ci
npm run prebuild
npm run package # or package:watch
```
