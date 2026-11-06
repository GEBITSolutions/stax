import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const bundle = fileURLToPath(new URL('../dist/index.js', import.meta.url))

const repository = (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stax-bundled-action-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  let tick = 0
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Release test',
    GIT_AUTHOR_EMAIL: 'release-test@example.invalid',
    GIT_COMMITTER_NAME: 'Release test',
    GIT_COMMITTER_EMAIL: 'release-test@example.invalid'
  }
  const git = (...args) => {
    const date = new Date(Date.UTC(2025, 0, 1, 0, 0, tick++)).toISOString()
    return execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
  }
  git('init', '--initial-branch=main', '--template=')
  const commit = (message) => {
    git('commit', '--allow-empty', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  const importHistory = (input) => {
    const marksFile = path.join(directory, 'import-marks')
    execFileSync(
      'git',
      ['fast-import', '--quiet', `--export-marks=${marksFile}`],
      {
        cwd: directory,
        encoding: 'utf8',
        input,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    return new Map(
      readFileSync(marksFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [mark, hash] = line.split(' ')
          return [Number(mark.slice(1)), hash]
        })
    )
  }
  const run = (inputs = {}, cwd = directory) => {
    const outputFile = path.join(directory, 'action-output')
    writeFileSync(outputFile, '')
    const result = spawnSync(process.execPath, [bundle], {
      cwd,
      encoding: 'utf8',
      env: { ...env, GITHUB_OUTPUT: outputFile, ...inputs }
    })
    assert.equal(result.error, undefined)
    const outputs = Object.fromEntries(
      Array.from(
        readFileSync(outputFile, 'utf8').matchAll(
          /^(\w+)<<([^\n]+)\n([^\n]*)\n\2$/gm
        ),
        ([, key, , value]) => [key, value]
      )
    )
    return { ...result, outputs }
  }
  return { directory, git, commit, importHistory, run }
}

for (const order of ['topological', 'committer-time', '']) {
  test(`bundled action retains merged features (${order || 'default'})`, (t) => {
    const { git, commit, run } = repository(t)
    commit('chore: base')
    git('tag', '1.0.0')
    git('checkout', '-b', 'feature')
    const feature = commit('feat: new capability')
    git('checkout', 'main')
    commit('chore: release 1.1.0')
    git('tag', '1.1.0')
    git('checkout', 'feature')
    git('merge', '--no-ff', 'main', '-m', 'chore: merge main')
    git('checkout', 'main')
    git('merge', '--no-ff', 'feature', '-m', 'chore: merge feature')

    const result = run({ INPUT_LOG_ORDER: order })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(result.outputs, {
      version: '1.2.0',
      hasNextVersion: 'true',
      prevVersion: '1.1.0'
    })
    assert.ok(result.stdout.includes(feature.slice(0, 7)), result.stdout)
  })

  test(`bundled action excludes released hotfixes (${order || 'default'})`, (t) => {
    const { git, commit, run } = repository(t)
    commit('chore: base')
    git('tag', '1.0.0')
    git('branch', 'hotfix')
    commit('chore: release 1.1.0')
    git('tag', '1.1.0')
    git('checkout', 'hotfix')
    const fix = commit('fix: already released')
    git('tag', '1.0.1')
    git('checkout', 'main')
    git('merge', '--no-ff', 'hotfix', '-m', 'chore: merge released hotfix')

    const result = run({ INPUT_LOG_ORDER: order })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(result.outputs, {
      version: '1.1.0',
      hasNextVersion: 'false',
      prevVersion: '1.1.0'
    })
    assert.ok(!result.stdout.includes(fix.slice(0, 7)), result.stdout)
  })
}

test('bundled action preserves raw previous tag and output prefix', (t) => {
  const { git, commit, run } = repository(t)
  commit('chore: release')
  git('tag', '-a', 'v1.2.3', '-m', 'Release')
  commit('fix: patch')
  const result = run({ INPUT_PREFIX: 'v' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.outputs, {
    version: 'v1.2.4',
    hasNextVersion: 'true',
    prevVersion: 'v1.2.3'
  })
})

test('bundled action emits an empty previous tag on its first release', (t) => {
  const { commit, run } = repository(t)
  commit('feat: first feature')
  const result = run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.outputs, {
    version: '0.1.0',
    hasNextVersion: 'true',
    prevVersion: ''
  })
})

test('bundled action fails with an actionable message on shallow history', (t) => {
  const { directory, git, commit, run } = repository(t)
  commit('chore: release')
  git('tag', '1.0.0')
  commit('fix: patch')
  const shallow = path.join(directory, 'shallow')
  git('clone', '--depth', '1', `file://${directory}`, shallow)
  const result = run({}, shallow)
  assert.equal(result.status, 1)
  assert.match(result.stdout, /fetch-depth: 0/)
  assert.deepEqual(result.outputs, {})
})

test('bundled action handles ancestry larger than the default 1 MiB buffer', (t) => {
  const { git, importHistory, run } = repository(t)
  const entries = []
  for (let index = 0; index < 26000; index++) {
    const message = index === 25999 ? 'feat: new feature' : 'chore: history'
    entries.push(
      'commit refs/heads/main',
      `committer Release test <release-test@example.invalid> ${1700000000 + index} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
      ''
    )
  }
  importHistory(entries.join('\n') + 'done\n')
  git('tag', '1.0.0', 'HEAD^')
  const result = run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.outputs, {
    version: '1.1.0',
    hasNextVersion: 'true',
    prevVersion: '1.0.0'
  })
  assert.match(result.stdout, /Unreleased commits: 1\n/)
})

test('bundled action finds reachable releases despite timestamp skew', (t) => {
  const { git, importHistory, run } = repository(t)
  const fixture = JSON.parse(
    readFileSync(
      new URL('../__fixtures__/clock-skew.json', import.meta.url),
      'utf8'
    )
  )
  const entries = []
  for (const { id, parents, timestamp } of fixture.nodes) {
    const message = `chore: housekeeping node-${id}`
    entries.push(
      'commit refs/heads/main',
      `mark :${id + 1}`,
      `committer Release test <release-test@example.invalid> ${timestamp} +0000`,
      `data ${Buffer.byteLength(message)}`,
      message,
      ...parents.map(
        (parent, index) => `${index === 0 ? 'from' : 'merge'} :${parent + 1}`
      ),
      ''
    )
  }
  const marks = importHistory(entries.join('\n') + 'done\n')
  const hashes = new Map(fixture.nodes.map(({ id }) => [id, marks.get(id + 1)]))
  for (const tag of fixture.tags) {
    git(
      'tag',
      ...(tag.annotated ? ['-a', '-m', 'Release'] : []),
      tag.name,
      hashes.get(tag.node)
    )
  }
  const expectedCommits = fixture.unreleased.map((id) =>
    hashes.get(id).slice(0, 7)
  )
  for (const order of ['topological', 'committer-time', '']) {
    const result = run({ INPUT_LOG_ORDER: order })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.deepEqual(result.outputs, {
      version: '4.2.4',
      hasNextVersion: 'false',
      prevVersion: 'v4.2.4'
    })
    const loggedCommits = Array.from(
      result.stdout.matchAll(/^- chore ([0-9a-f]{7}) /gm),
      ([, hash]) => hash
    )
    assert.deepEqual(loggedCommits.sort(), expectedCommits.sort())
  }
})
